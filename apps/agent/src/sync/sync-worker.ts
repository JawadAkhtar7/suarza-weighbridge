/**
 * Outbox sync worker (brief §11).
 *
 * The local database is the source of truth; this drains it upward. Two
 * triggers, and deliberately no more:
 *
 *  (a) on every commit — so the operator sees "synced" straight after weighing
 *  (b) every few minutes — which is also how a restored connection is noticed
 *
 * There is no retry schedule. A failed attempt simply waits for the next tick:
 * the dashboard does not need to be fresher than that, and a backoff ladder
 * bought minutes of freshness at the cost of a failure counter, a second timer
 * and the reconnect sweep that existed only to undo it.
 *
 * Each run drains the whole outbox, batch after batch, so a day offline goes up
 * in one pass rather than one batch per tick.
 *
 * A record is marked synced only on a confirmed 2xx that names its id. Marking
 * optimistically would lose weighments permanently on a failure.
 */

import type { SyncStatus } from '@suarza/shared';
import { nowUtc } from '@suarza/shared';
import type { WeighmentRepository } from '../db/weighments.js';
import { toDto } from '../db/weighments.js';
import type { AuditRepository } from '../db/audit.js';
import { CloudError, type CloudClient } from './cloud-client.js';
import type { CaptureRow } from '../db/captures.js';

/** Bounded so a week of offline records syncs in batches, not one huge POST. */
export const BATCH_SIZE = 50;

/* Smaller than the record batch: each still is its own request, so this is
   only how many rows are claimed from the table at a time. */
const CAPTURE_BATCH = 10;

export interface SyncWorkerOptions {
  weighments: WeighmentRepository;
  audit: AuditRepository;
  /**
   * Camera stills, if this bridge has cameras.
   *
   * Absent on a bridge with none, and the drain is then skipped entirely
   * rather than querying an empty table on every tick.
   */
  captures?: {
    unsynced(limit?: number): CaptureRow[];
    markSynced(ids: string[]): void;
    read(row: CaptureRow): Promise<Buffer | null>;
  };
  client: CloudClient;
  /** Backstop interval (brief §11d). */
  periodicMs: number;
  onLog?: (level: 'info' | 'warn' | 'error', message: string) => void;
  /** Injected in tests so backoff can be asserted without real waiting. */
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
}

export interface SyncStatusSnapshot {
  online: boolean;
  lastSuccessAt: string | null;
  lastError: string | null;
  syncing: boolean;
}

export class SyncWorker {
  private running = false;
  /**
   * "Shut down", not "not yet started". A worker that has never been started
   * can still be driven by hand — that is how the agent flushes on demand and
   * how these paths are tested — but nothing runs again after stop().
   */
  private stopped = false;
  private started = false;
  /** Set when a commit lands mid-sync, so the new record isn't left behind. */
  private rerunRequested = false;
  private periodicTimer: NodeJS.Timeout | null = null;

  private online = false;
  private lastSuccessAt: string | null = null;
  private lastError: string | null = null;

  private readonly setTimeoutFn: typeof setTimeout;
  private readonly clearTimeoutFn: typeof clearTimeout;

  constructor(private readonly options: SyncWorkerOptions) {
    this.setTimeoutFn = options.setTimeoutFn ?? setTimeout;
    this.clearTimeoutFn = options.clearTimeoutFn ?? clearTimeout;
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.stopped = false;

    this.periodicTimer = this.setTimeoutFn(() => this.periodicTick(), this.options.periodicMs);
    this.periodicTimer.unref?.();

    // Anything left in the outbox from the last run goes first.
    void this.sync();
  }

  stop(): void {
    this.stopped = true;
    this.started = false;
    if (this.periodicTimer) this.clearTimeoutFn(this.periodicTimer);
    this.periodicTimer = null;
  }

  /** Trigger (a): called after every commit. */
  requestSync(): void {
    if (this.stopped) return;
    void this.sync();
  }

  getStatus(): SyncStatusSnapshot {
    return {
      online: this.online,
      lastSuccessAt: this.lastSuccessAt,
      lastError: this.lastError,
      syncing: this.running,
    };
  }

  /** The shape `/sync-status` returns to the operator UI. */
  toSyncStatus(): SyncStatus {
    return {
      online: this.online,
      pending_count: this.options.weighments.countUnsynced(),
      last_success_at: this.lastSuccessAt,
      last_error: this.lastError,
      syncing: this.running,
      blocked_count: this.options.weighments.countBlocked(),
    };
  }

  private periodicTick(): void {
    if (this.stopped) return;
    void this.sync();
    this.periodicTimer = this.setTimeoutFn(() => this.periodicTick(), this.options.periodicMs);
    this.periodicTimer.unref?.();
  }

  async sync(): Promise<void> {
    if (this.stopped) return;

    // Overlapping runs would send the same records twice. Harmless (ingest is
    // idempotent) but wasteful, so a concurrent request just queues a rerun.
    if (this.running) {
      this.rerunRequested = true;
      return;
    }

    this.running = true;
    try {
      let drainedSomething = false;

      // Loop so a backlog drains in one go rather than one batch per trigger.
      for (;;) {
        if (this.stopped) break;

        const pending = this.options.weighments.listUnsynced(BATCH_SIZE);
        if (pending.length === 0) break;

        const sent = await this.sendBatch(pending);
        if (!sent) return; // Noted as offline; the next tick tries again.
        drainedSomething = true;
      }

      // A reprint writes an audit entry against a record that is ALREADY
      // synced, so it is never picked up by the weighment drain above. Without
      // this second pass those entries would sit in the outbox forever and the
      // cloud would have no record that a receipt was reprinted.
      const orphans = await this.drainOrphanAudit();
      if (orphans === 'failed') return; // Same: wait for the next tick.

      /*
       * Pictures go up AFTER the records they belong to.
       *
       * A still names its weighment, and the cloud rejects one for a record
       * it has never seen. The weighment drain above has just run, so by here
       * the record is there.
       */
      const images = await this.drainCaptures();
      if (images === 'failed') return;

      if (drainedSomething || orphans === 'drained' || images === 'drained') {
        this.markOnline();
        return;
      }

      // Nothing to send. An empty outbox says nothing about the link — the
      // agent must not report "cloud connected" to the operator on the
      // strength of having had nothing to do — so the only honest way to know
      // is to ask.
      if (await this.options.client.ping()) {
        this.markOnline();
      } else {
        this.fail(new CloudError('Cloud is not reachable', null, false));
      }
    } finally {
      this.running = false;
      if (this.rerunRequested && !this.stopped) {
        this.rerunRequested = false;
        void this.sync();
      }
    }
  }

  /**
   * Sends camera stills one at a time.
   *
   * Marked synced individually rather than as a batch: each upload is its own
   * request, and a run that dies half way should keep the pictures it managed
   * to send rather than offering them all again.
   */
  private async drainCaptures(): Promise<'drained' | 'empty' | 'failed'> {
    const store = this.options.captures;
    if (!store) return 'empty';

    let sentAny = false;
    for (;;) {
      if (this.stopped) break;

      const pending = store.unsynced(CAPTURE_BATCH);
      if (pending.length === 0) break;

      for (const row of pending) {
        const body = await store.read(row);
        if (!body) {
          /*
           * The row is there and the file is not — pruned by hand, or a disk
           * that filled. Mark it synced anyway: nothing can ever send it, and
           * leaving it unsynced would make this drain retry it forever and
           * block every picture behind it.
           */
          store.markSynced([row.id]);
          this.options.onLog?.('warn', `Camera image missing on disk, skipped: ${row.path}`);
          continue;
        }

        try {
          await this.options.client.uploadCapture({
            id: row.id,
            weighmentId: row.weighment_id,
            slipNumber: row.slip_number,
            pass: row.pass,
            view: row.view,
            takenAt: row.taken_at,
            body,
          });
          store.markSynced([row.id]);
          sentAny = true;
        } catch (error) {
          this.fail(error);
          return 'failed';
        }
      }
    }

    if (sentAny) this.options.onLog?.('info', 'Camera images sent');
    return sentAny ? 'drained' : 'empty';
  }

  /**
   * Sends audit entries whose weighment is already in the cloud.
   *
   * The three outcomes are named rather than booleans: "nothing to send" and
   * "the send failed" are opposite situations and conflating them would make
   * an empty outbox look like an outage.
   */
  private async drainOrphanAudit(): Promise<'drained' | 'empty' | 'failed'> {
    let drainedAny = false;

    for (;;) {
      if (this.stopped) return drainedAny ? 'drained' : 'empty';

      const entries = this.options.audit.listUnsynced(BATCH_SIZE * 4);
      if (entries.length === 0) return drainedAny ? 'drained' : 'empty';

      try {
        // No weighments in this batch — the server upserts audit entries on
        // their own id, so it needs nothing else.
        await this.options.client.ingest([], entries);
        this.options.audit.markSynced(entries.map((entry) => entry.id));
        this.options.onLog?.('info', `Synced ${entries.length} audit entr(ies) to the cloud`);
        drainedAny = true;
      } catch (error) {
        this.fail(error);
        return 'failed';
      }
    }
  }

  /** Returns false when the batch failed and a retry has been scheduled. */
  private async sendBatch(
    pending: ReturnType<WeighmentRepository['listUnsynced']>,
  ): Promise<boolean> {
    const ids = pending.map((record) => record.id);
    const auditEntries = this.options.audit.listUnsyncedForWeighments(ids);

    this.options.weighments.recordSyncAttempt(ids, nowUtc());

    try {
      const response = await this.options.client.ingest(pending.map(toDto), auditEntries);

      // Only ids the cloud confirms are marked synced. Anything it rejected
      // stays in the outbox and is retried, rather than silently vanishing.
      const accepted = new Set(response.accepted_ids);
      const acceptedIds = ids.filter((id) => accepted.has(id));
      this.options.weighments.markSynced(acceptedIds);
      this.options.audit.markSynced(
        auditEntries.filter((entry) => accepted.has(entry.weighment_id)).map((entry) => entry.id),
      );

      // A permanent rejection — a duplicate slip number, a document the cloud
      // refuses — cannot come right on a retry. Quarantined, it stops costing a
      // request every couple of minutes and stops blocking the records behind
      // it. Transient rejections stay in the outbox and are retried as before.
      const permanent = response.rejected.filter((r) => r.permanent);
      const transient = response.rejected.filter((r) => !r.permanent);

      if (permanent.length > 0) {
        this.options.weighments.markBlocked(
          permanent.map((r) => ({ id: r.id, reason: r.reason })),
          nowUtc(),
        );
        this.options.onLog?.(
          'error',
          `Cloud permanently refused ${permanent.length} record(s); they will NOT be retried ` +
            `until the conflict is resolved: ${permanent
              .map((r) => `${r.id}: ${r.reason}`)
              .join('; ')
              .slice(0, 500)}`,
        );
      }

      if (transient.length > 0) {
        this.options.onLog?.(
          'error',
          `Cloud rejected ${transient.length} record(s): ${transient
            .map((r) => `${r.id}: ${r.reason}`)
            .join('; ')
            .slice(0, 500)}`,
        );
      }

      // "Moved" means the outbox is smaller than it was: stored, or quarantined.
      // Anything else — including a cloud that confirms nothing and refuses
      // nothing — would hand back the same batch on the next pass and spin.
      const moved = acceptedIds.length > 0 || permanent.length > 0;
      if (!moved && pending.length > 0) {
        this.fail(new CloudError('Cloud accepted none of the batch', null, true));
        return false;
      }

      // Reaching here means the cloud answered and the outbox moved — either
      // records were stored, or the poison ones were quarantined. Both are
      // proof the link is up, so the operator must not be shown "offline".
      this.markOnline();
      if (acceptedIds.length > 0) {
        this.options.onLog?.('info', `Synced ${acceptedIds.length} record(s) to the cloud`);
      }
      return true;
    } catch (error) {
      this.fail(error);
      return false;
    }
  }

  private markOnline(): void {
    this.online = true;
    this.lastError = null;
    this.lastSuccessAt = nowUtc();
  }

  private fail(error: unknown): void {
    this.online = false;
    this.lastError = error instanceof Error ? error.message : String(error);

    // A missing internet link is the expected state at a weighbridge, not an
    // incident. Nothing is scheduled here: the periodic tick is the retry.
    const level = error instanceof CloudError && !error.isServerResponse ? 'info' : 'warn';
    this.options.onLog?.(level, `Sync failed, will try again shortly: ${this.lastError}`);
  }
}
