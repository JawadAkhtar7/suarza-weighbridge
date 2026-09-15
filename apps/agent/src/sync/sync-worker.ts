/**
 * Outbox sync worker (brief §11).
 *
 * The local database is the source of truth; this drains it upward. Four
 * triggers, each covering a different way the naive version fails:
 *
 *  (a) event-driven on every commit — the normal case, syncs in a second
 *  (b) exponential backoff on failure (5s → 15s → 60s → cap 2min) — so a dead
 *      link is not hammered, and a thousand queued records do not stampede
 *  (c) a sweep the moment a retry succeeds — that IS the reconnect trigger;
 *      Node has no reliable "the internet came back" event, so the retry
 *      doubles as the probe and a success immediately drains the rest
 *  (d) a loose periodic backstop — insurance against a trigger being missed
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

/** Brief §11b. Capped so a long outage still retries every couple of minutes. */
export const BACKOFF_MS = [5_000, 15_000, 60_000, 120_000];

/** Bounded so a week of offline records syncs in batches, not one huge POST. */
export const BATCH_SIZE = 50;

export interface SyncWorkerOptions {
  weighments: WeighmentRepository;
  audit: AuditRepository;
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
  private failureCount = 0;
  private retryTimer: NodeJS.Timeout | null = null;
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
    if (this.retryTimer) this.clearTimeoutFn(this.retryTimer);
    if (this.periodicTimer) this.clearTimeoutFn(this.periodicTimer);
    this.retryTimer = null;
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
        if (!sent) return; // Failure already scheduled a retry.
        drainedSomething = true;
      }

      // A reprint writes an audit entry against a record that is ALREADY
      // synced, so it is never picked up by the weighment drain above. Without
      // this second pass those entries would sit in the outbox forever and the
      // cloud would have no record that a receipt was reprinted.
      const orphans = await this.drainOrphanAudit();
      if (orphans === 'failed') return; // A retry is already scheduled.

      if (drainedSomething || orphans === 'drained') {
        this.markOnline();
        return;
      }

      // Nothing to send. An empty outbox says nothing about the link — the
      // agent must not report "cloud connected" to the operator on the
      // strength of having had nothing to do — so the only honest way to know
      // is to ask.
      if (await this.options.client.ping()) {
        this.markOnline();
      } else if (this.online || this.failureCount === 0) {
        // Only note the drop once; the backoff timer takes it from here.
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
    this.failureCount = 0;
    if (this.retryTimer) {
      this.clearTimeoutFn(this.retryTimer);
      this.retryTimer = null;
    }
  }

  private fail(error: unknown): void {
    this.online = false;
    this.lastError = error instanceof Error ? error.message : String(error);

    const delay = BACKOFF_MS[Math.min(this.failureCount, BACKOFF_MS.length - 1)]!;
    this.failureCount += 1;

    const level = error instanceof CloudError && !error.isServerResponse ? 'info' : 'warn';
    // A missing internet link is the expected state here, not an incident.
    this.options.onLog?.(level, `Sync failed (retrying in ${delay / 1000}s): ${this.lastError}`);

    if (this.retryTimer) this.clearTimeoutFn(this.retryTimer);
    this.retryTimer = this.setTimeoutFn(() => {
      this.retryTimer = null;
      void this.sync();
    }, delay);
    this.retryTimer.unref?.();
  }
}
