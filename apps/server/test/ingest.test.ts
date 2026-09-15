/**
 * M5 acceptance, first half: posting a record twice yields one document.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import {
  TEST_API_KEY,
  auditEntry,
  clearDatabase,
  completedWeighment,
  startDatabase,
  stopDatabase,
  testApp,
  weighment,
} from './helpers.js';
import { WeighmentModel } from '../src/models/weighment.model.js';
import { AuditModel } from '../src/models/audit.model.js';

let app: Express;

beforeAll(async () => {
  await startDatabase();
  app = testApp();
});
afterAll(stopDatabase);
afterEach(clearDatabase);

const post = (body: unknown, key: string | null = TEST_API_KEY) => {
  const req = request(app).post('/ingest');
  if (key) req.set('x-api-key', key);
  return req.send(body as object);
};

describe('POST /ingest — authentication', () => {
  it('refuses a request with no API key', async () => {
    const response = await post({ station_id: 'A', weighments: [] }, null);
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHORIZED');
  });

  it('refuses a wrong API key', async () => {
    const response = await post({ station_id: 'A', weighments: [] }, 'not-the-key');
    expect(response.status).toBe(401);
  });

  it('accepts the configured key', async () => {
    expect((await post({ station_id: 'A', weighments: [] })).status).toBe(200);
  });
});

describe('POST /ingest — idempotency', () => {
  it('stores a weighment', async () => {
    const record = weighment();
    const response = await post({ station_id: 'A', weighments: [record] });

    expect(response.status).toBe(200);
    expect(response.body.accepted_ids).toEqual([record.id]);
    expect(await WeighmentModel.countDocuments()).toBe(1);
  });

  it('posting the same record twice yields ONE document', async () => {
    const record = weighment();
    await post({ station_id: 'A', weighments: [record] });
    await post({ station_id: 'A', weighments: [record] });

    expect(await WeighmentModel.countDocuments()).toBe(1);
  });

  it('survives the same record being sent ten times', async () => {
    // What a flaky link actually produces: the agent never saw the 2xx, so it
    // retried, repeatedly.
    const record = weighment();
    for (let i = 0; i < 10; i++) {
      const response = await post({ station_id: 'A', weighments: [record] });
      expect(response.body.accepted_ids).toContain(record.id);
    }
    expect(await WeighmentModel.countDocuments()).toBe(1);
  });

  it('updates the stored copy when the record moves on', async () => {
    const first = weighment();
    await post({ station_id: 'A', weighments: [first] });

    const completed = completedWeighment({ id: first.id, slip_number: first.slip_number });
    await post({ station_id: 'A', weighments: [completed] });

    expect(await WeighmentModel.countDocuments()).toBe(1);
    const stored = await WeighmentModel.findById(first.id).lean();
    expect(stored?.status).toBe('COMPLETED');
    expect(stored?.net_weight_kg).toBe(12_000);
  });

  it('does NOT let an older copy overwrite a newer one', async () => {
    // Two batches can overlap on a reconnect sweep; an out-of-order delivery
    // must not resurrect an OPEN ticket over a completed one.
    const first = weighment();
    const completed = completedWeighment({ id: first.id, slip_number: first.slip_number });

    await post({ station_id: 'A', weighments: [completed] });
    const response = await post({ station_id: 'A', weighments: [first] });

    const stored = await WeighmentModel.findById(first.id).lean();
    expect(stored?.status).toBe('COMPLETED');
    expect(response.body.skipped_ids).toContain(first.id);
    // Still "accepted", so the agent stops retrying it.
    expect(response.body.accepted_ids).toContain(first.id);
  });

  it('accepts a batch of many records at once', async () => {
    const records = Array.from({ length: 25 }, (_, i) =>
      weighment({ slip_number: `SI-${String(i + 1).padStart(6, '0')}` }),
    );
    const response = await post({ station_id: 'A', weighments: records });

    expect(response.body.accepted_ids).toHaveLength(25);
    expect(await WeighmentModel.countDocuments()).toBe(25);
  });
});

describe('POST /ingest — audit entries', () => {
  it('stores audit entries alongside their weighment', async () => {
    const record = weighment();
    await post({
      station_id: 'A',
      weighments: [record],
      audit_entries: [auditEntry(record.id), auditEntry(record.id, { action: 'COMPLETED' })],
    });

    expect(await AuditModel.countDocuments()).toBe(2);
  });

  it('does not duplicate audit entries on a re-send', async () => {
    const record = weighment();
    const entries = [auditEntry(record.id)];
    await post({ station_id: 'A', weighments: [record], audit_entries: entries });
    await post({ station_id: 'A', weighments: [record], audit_entries: entries });

    expect(await AuditModel.countDocuments()).toBe(1);
  });
});

describe('POST /ingest — validation', () => {
  it('rejects a malformed weighment rather than storing half of it', async () => {
    const response = await post({
      station_id: 'A',
      weighments: [{ ...weighment(), first_weight_kg: -100 }],
    });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(await WeighmentModel.countDocuments()).toBe(0);
  });

  it('rejects a payload with no station id', async () => {
    expect((await post({ weighments: [] })).status).toBe(400);
  });
});
