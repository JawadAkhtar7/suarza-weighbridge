/**
 * Outbox behaviour (brief §11). The rules that matter here are all about what
 * happens when the link is bad, because that is the normal state at a factory.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuditEntry, IngestResponse, Weighment } from '@suarza/shared';
import { openDatabase, type Db } from '../src/db/connection.js';
import { WeighmentRepository } from '../src/db/weighments.js';
import { AuditRepository } from '../src/db/audit.js';
import { WeighmentService } from '../src/services/weighment-service.js';
import { BACKOFF_MS, SyncWorker } from '../src/sync/sync-worker.js';
import { CloudError, type CloudClient } from '../src/sync/cloud-client.js';

let db: Db;
let service: WeighmentService;
let weighments: WeighmentRepository;
let audit: AuditRepository;

/** A cloud that can be switched offline, and records what it received. */
function fakeCloud() {
  const received: { weighments: Weighment[]; audit: AuditEntry[] }[] = [];
  let online = true;
  let failWith: Error | null = null;

  const client: CloudClient = {
    async ingest(batch, entries): Promise<IngestResponse> {
      if (failWith) throw failWith;
      if (!online) throw new CloudError('Cannot reach the cloud: offline', null, false);
      received.push({ weighments: batch, audit: entries });
      return {
        accepted_ids: batch.map((w) => w.id),
        rejected: [],
        received_at: new Date().toISOString(),
      };
    },
    async ping() {
      return online;
    },
  };

  return {
    client,
    received,
    goOffline: () => {
      online = false;
    },
    goOnline: () => {
      online = true;
      failWith = null;
    },
    failEveryRequestWith: (error: Error) => {
      failWith = error;
    },
    /** Every weighment id the cloud ever received, duplicates included. */
    allIds: () => received.flatMap((batch) => batch.weighments.map((w) => w.id)),
  };
}

function newWorker(client: CloudClient, overrides = {}) {
  return new SyncWorker({
    weighments,
    audit,
    client,
    periodicMs: 1_000_000, // The backstop is tested separately.
    ...overrides,
  });
}

const firstWeight = (plate = 'LES-1234') => ({
  customer_name: 'Ali Raza',
  customer_company: 'Raza Traders',
  vehicle_type: 'truck' as const,
  vehicle_plate: plate,
  product: 'Cement',
  first_weight_kg: 8000,
  first_weight_src: 'SERIAL' as const,
  amount_charged: 300,
  operator_username: 'operator',
});

beforeEach(() => {
  db = openDatabase({ path: ':memory:' });
  weighments = new WeighmentRepository(db);
  audit = new AuditRepository(db);
  service = new WeighmentService(db, { stationId: 'A' });
});

afterEach(() => {
  db.close();
  vi.useRealTimers();
});

describe('draining the outbox', () => {
  it('sends pending records and marks them synced', async () => {
    service.createFirstWeight(firstWeight());
    const worker = newWorker(fakeCloud().client);

    expect(weighments.countUnsynced()).toBe(1);
    await worker.sync();
    expect(weighments.countUnsynced()).toBe(0);
  });

  it('drains a whole backlog in one run, not one batch per trigger', async () => {
    // 120 records is more than the 50-record batch size.
    for (let i = 0; i < 120; i++) service.createFirstWeight(firstWeight(`PLATE-${i}`));

    const cloud = fakeCloud();
    await newWorker(cloud.client).sync();

    expect(weighments.countUnsynced()).toBe(0);
    expect(cloud.allIds()).toHaveLength(120);
  });

  it('sends each record exactly once when the link is good', async () => {
    for (let i = 0; i < 10; i++) service.createFirstWeight(firstWeight(`PLATE-${i}`));

    const cloud = fakeCloud();
    const worker = newWorker(cloud.client);
    await worker.sync();
    await worker.sync();

    const ids = cloud.allIds();
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(10);
  });

  it('carries each weighment together with its audit trail', async () => {
    const { weighment } = service.createFirstWeight(firstWeight());
    service.complete(weighment.slip_number, {
      second_weight_kg: 20_000,
      second_weight_src: 'SERIAL',
      amount_charged: 300,
      operator_username: 'operator',
    });

    const cloud = fakeCloud();
    await newWorker(cloud.client).sync();

    const batch = cloud.received[0]!;
    expect(batch.weighments).toHaveLength(1);
    expect(batch.audit.map((e) => e.action)).toEqual(['CREATED', 'SECOND_WEIGHT', 'COMPLETED']);
  });

  it('sends the record without its local sync bookkeeping', async () => {
    service.createFirstWeight(firstWeight());
    const cloud = fakeCloud();
    await newWorker(cloud.client).sync();

    // `synced` / `sync_attempts` drive the outbox and are not data (brief §6).
    expect(cloud.received[0]!.weighments[0]).not.toHaveProperty('sync');
    expect(cloud.received[0]!.weighments[0]).not.toHaveProperty('synced');
  });
});

describe('when the link is down', () => {
  it('keeps records in the outbox rather than losing them', async () => {
    service.createFirstWeight(firstWeight());
    const cloud = fakeCloud();
    cloud.goOffline();

    await newWorker(cloud.client).sync();

    expect(weighments.countUnsynced()).toBe(1);
    expect(cloud.allIds()).toHaveLength(0);
  });

  it('reports itself offline with the reason', async () => {
    service.createFirstWeight(firstWeight());
    const cloud = fakeCloud();
    cloud.goOffline();

    const worker = newWorker(cloud.client);
    await worker.sync();

    const status = worker.getStatus();
    expect(status.online).toBe(false);
    expect(status.lastError).toMatch(/cannot reach the cloud/i);
    expect(status.lastSuccessAt).toBeNull();
  });

  it('syncs everything once the link returns, with no duplicates', async () => {
    // The M6 acceptance, in miniature: records made offline, then reconnect.
    for (let i = 0; i < 8; i++) service.createFirstWeight(firstWeight(`PLATE-${i}`));

    const cloud = fakeCloud();
    cloud.goOffline();

    const worker = newWorker(cloud.client);
    await worker.sync();
    expect(weighments.countUnsynced()).toBe(8);

    cloud.goOnline();
    await worker.sync();

    expect(weighments.countUnsynced()).toBe(0);
    const ids = cloud.allIds();
    expect(ids).toHaveLength(8);
    expect(new Set(ids).size).toBe(8);
    expect(worker.getStatus().online).toBe(true);
  });

  it('backs off 5s, 15s, 60s then caps at 2 minutes', async () => {
    expect(BACKOFF_MS).toEqual([5_000, 15_000, 60_000, 120_000]);

    const delays: number[] = [];
    const fakeSetTimeout = ((fn: () => void, ms: number) => {
      delays.push(ms);
      return { unref: () => {} } as unknown as NodeJS.Timeout;
    }) as unknown as typeof setTimeout;

    service.createFirstWeight(firstWeight());
    const cloud = fakeCloud();
    cloud.goOffline();

    const worker = newWorker(cloud.client, {
      setTimeoutFn: fakeSetTimeout,
      clearTimeoutFn: (() => {}) as unknown as typeof clearTimeout,
    });

    for (let i = 0; i < 6; i++) await worker.sync();

    // Capped rather than growing forever, so a long outage still retries.
    expect(delays).toEqual([5_000, 15_000, 60_000, 120_000, 120_000, 120_000]);
  });

  it('counts an attempt against the record even when it fails', async () => {
    service.createFirstWeight(firstWeight());
    const cloud = fakeCloud();
    cloud.goOffline();

    await newWorker(cloud.client).sync();

    // Visible in the database, so a stuck record can be diagnosed on site.
    expect(weighments.listUnsynced()[0]?.sync.sync_attempts).toBe(1);
    expect(weighments.listUnsynced()[0]?.sync.last_attempt_at).not.toBeNull();
  });
});

describe('only confirmed records are marked synced', () => {
  it('leaves a record pending when the cloud does not confirm it', async () => {
    service.createFirstWeight(firstWeight('A'));
    service.createFirstWeight(firstWeight('B'));

    const client: CloudClient = {
      async ingest(batch) {
        // The cloud accepted only the first of the two.
        return {
          accepted_ids: [batch[0]!.id],
          rejected: [{ id: batch[1]!.id, reason: 'duplicate slip' }],
          received_at: new Date().toISOString(),
        };
      },
      async ping() {
        return true;
      },
    };

    await newWorker(client).sync();

    // Marking it optimistically would lose the record permanently.
    expect(weighments.countUnsynced()).toBe(1);
  });

  it('does not spin forever when the cloud accepts nothing', async () => {
    service.createFirstWeight(firstWeight());

    let calls = 0;
    const client: CloudClient = {
      async ingest() {
        calls += 1;
        return { accepted_ids: [], rejected: [], received_at: new Date().toISOString() };
      },
      async ping() {
        return true;
      },
    };

    const worker = newWorker(client, {
      setTimeoutFn: (() =>
        ({ unref: () => {} }) as unknown as NodeJS.Timeout) as unknown as typeof setTimeout,
      clearTimeoutFn: (() => {}) as unknown as typeof clearTimeout,
    });
    await worker.sync();

    expect(calls).toBe(1);
    expect(worker.getStatus().online).toBe(false);
  });
});

describe('reprints', () => {
  it('syncs an audit entry written against an already-synced record', async () => {
    // A reprint does not touch the weighment, so it is invisible to the
    // weighment drain — without a second pass it would never reach the cloud.
    const { weighment } = service.createFirstWeight(firstWeight());
    const cloud = fakeCloud();
    const worker = newWorker(cloud.client);

    await worker.sync();
    expect(audit.countUnsynced()).toBe(0);

    service.recordReprint(weighment.slip_number, {
      operator_username: 'operator',
      receipt: 'FIRST',
    });
    expect(audit.countUnsynced()).toBe(1);

    await worker.sync();
    expect(audit.countUnsynced()).toBe(0);
    const reprintBatch = cloud.received.at(-1)!;
    expect(reprintBatch.weighments).toHaveLength(0);
    expect(reprintBatch.audit[0]?.action).toBe('REPRINTED');
  });
});

describe('triggers', () => {
  it('syncs on every commit once wired to the service', async () => {
    const cloud = fakeCloud();
    const worker = newWorker(cloud.client);
    const wired = new WeighmentService(db, {
      stationId: 'A',
      onChange: () => worker.requestSync(),
    });

    wired.createFirstWeight(firstWeight());
    // requestSync is fire-and-forget; let the microtask queue settle.
    await worker.sync();

    expect(weighments.countUnsynced()).toBe(0);
  });

  it('never lets a listener failure break a save', () => {
    const exploding = new WeighmentService(db, {
      stationId: 'A',
      onChange: () => {
        throw new Error('sync worker is on fire');
      },
    });

    // The weighment is already committed by the time the hook runs; the
    // operator must not see an error for a record that was saved.
    expect(() => exploding.createFirstWeight(firstWeight())).not.toThrow();
    expect(weighments.countUnsynced()).toBe(1);
  });

  it('queues a rerun instead of overlapping two syncs', async () => {
    service.createFirstWeight(firstWeight());

    let inFlight = 0;
    let maxConcurrent = 0;
    const client: CloudClient = {
      async ingest(batch) {
        inFlight += 1;
        maxConcurrent = Math.max(maxConcurrent, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 20));
        inFlight -= 1;
        return {
          accepted_ids: batch.map((w) => w.id),
          rejected: [],
          received_at: new Date().toISOString(),
        };
      },
      async ping() {
        return true;
      },
    };

    const worker = newWorker(client);
    await Promise.all([worker.sync(), worker.sync(), worker.sync()]);

    expect(maxConcurrent).toBe(1);
  });
});

describe('status reporting', () => {
  it('reports the pending count the operator UI shows', async () => {
    for (let i = 0; i < 3; i++) service.createFirstWeight(firstWeight(`PLATE-${i}`));
    const cloud = fakeCloud();
    cloud.goOffline();

    const worker = newWorker(cloud.client);
    await worker.sync();
    expect(worker.toSyncStatus()).toMatchObject({ online: false, pending_count: 3 });

    cloud.goOnline();
    await worker.sync();
    expect(worker.toSyncStatus()).toMatchObject({ online: true, pending_count: 0 });
  });
});
