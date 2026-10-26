/**
 * The log, and the two ways entries reach it.
 *
 * One of them is the manager voiding a slip here; the other is a bridge
 * pushing up the shifts it has already recorded on its own machine. The
 * second is the one worth pinning hardest: it is delivered over an
 * unreliable link and may arrive twice.
 */

import request from 'supertest';
import type { Express } from 'express';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  TEST_API_KEY,
  completedWeighment,
  createUser,
  startDatabase,
  stopDatabase,
  testApp,
} from './helpers.js';
import { ingest } from '../src/services/ingest.service.js';
import { listLogs } from '../src/services/log.service.js';
import {
  restoreWeighmentBySlip,
  voidWeighmentBySlip,
} from '../src/services/void-weighment.service.js';
import { logQuerySchema } from '@suarza/shared';

let app: Express;
let adminToken: string;

beforeAll(async () => {
  await startDatabase();
  app = testApp();
  await createUser({ username: 'an-admin', password: 'admin-pw', role: 'ADMIN' });
  adminToken = (
    await request(app).post('/auth/login').send({ username: 'an-admin', password: 'admin-pw' })
  ).body.token as string;
});
afterAll(stopDatabase);

/* The accounts stay — clearDatabase removes users, and the token above would
   stop working half way through the file. */
afterEach(async () => {
  const { LogModel } = await import('../src/models/log.model.js');
  const { WeighmentModel } = await import('../src/models/weighment.model.js');
  const { ManagerVoidModel } = await import('../src/models/manager-void.model.js');
  await Promise.all([
    LogModel.deleteMany({}),
    WeighmentModel.deleteMany({}),
    ManagerVoidModel.deleteMany({}),
  ]);
});

const page = () => logQuerySchema.parse({});

const shiftEntry = (overrides: Record<string, unknown> = {}) => ({
  id: 'log-1',
  kind: 'SHIFT_START',
  at: '2026-10-16T03:00:00.000Z',
  username: 'imran',
  name: 'Imran Shah',
  role: 'OPERATOR',
  detail: null,
  ...overrides,
});

describe('what the manager does here', () => {
  it('records a void with its reason, and the restore that undoes it', async () => {
    await ingest([completedWeighment()], []);

    await voidWeighmentBySlip('20261', 'Weighed the wrong truck', 'an-admin');
    await restoreWeighmentBySlip('20261', 'an-admin');

    const { rows } = await listLogs(page());
    // Newest first: the restore, then the void it undid.
    expect(rows.map((row) => row.kind)).toEqual(['WEIGHMENT_RESTORE', 'WEIGHMENT_VOID']);
    expect(rows[1]).toMatchObject({
      actor: 'an-admin',
      subject: '20261',
      detail: 'Weighed the wrong truck',
    });
  });

  it('records a void with no reason at all, because the reason is optional', async () => {
    await ingest([completedWeighment()], []);

    await voidWeighmentBySlip('20261', '', 'an-admin');

    const { rows } = await listLogs(page());
    expect(rows[0]).toMatchObject({ kind: 'WEIGHMENT_VOID', subject: '20261', detail: null });
  });
});

describe('what the bridge pushes up', () => {
  it('takes shift events with the ingest key, and lists them', async () => {
    const response = await request(app)
      .post('/api/sync/operator-logs')
      .set('x-api-key', TEST_API_KEY)
      .send({ entries: [shiftEntry(), shiftEntry({ id: 'log-2', kind: 'SHIFT_END' })] });

    expect(response.status).toBe(200);
    const { rows, total } = await listLogs(page());
    expect(total).toBe(2);
    expect(rows[0]).toMatchObject({
      actor: 'imran',
      actor_name: 'Imran Shah',
      role: 'OPERATOR',
    });
  });

  it('records one shift when the same batch arrives twice', async () => {
    /*
     * The bridge marks an entry synced only on a response, so a batch that
     * lands and then fails to be acknowledged is sent again. The ids are the
     * bridge's own, which is what makes the second delivery a no-op.
     */
    const send = () =>
      request(app)
        .post('/api/sync/operator-logs')
        .set('x-api-key', TEST_API_KEY)
        .send({ entries: [shiftEntry()] });

    await send();
    await send();

    expect((await listLogs(page())).total).toBe(1);
  });

  it('refuses a push with no ingest key', async () => {
    const response = await request(app)
      .post('/api/sync/operator-logs')
      .send({ entries: [shiftEntry()] });

    expect(response.status).toBe(401);
    expect((await listLogs(page())).total).toBe(0);
  });
});

describe('reading it back', () => {
  it('shows one kind at a time when asked', async () => {
    await ingest([completedWeighment()], []);
    await voidWeighmentBySlip('20261', 'Wrong truck', 'an-admin');
    await request(app)
      .post('/api/sync/operator-logs')
      .set('x-api-key', TEST_API_KEY)
      .send({ entries: [shiftEntry()] });

    const shifts = await listLogs(logQuerySchema.parse({ kind: 'SHIFT_START' }));

    expect(shifts.total).toBe(1);
    expect(shifts.rows[0]?.actor).toBe('imran');
  });

  it('is behind the dashboard guard', async () => {
    const anonymous = await request(app).get('/api/logs');
    const signedIn = await request(app)
      .get('/api/logs')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(anonymous.status).toBe(401);
    expect(signedIn.status).toBe(200);
  });
});
