/**
 * M1 acceptance: with the simulator on, live weight streams, and a first-weight
 * record persists to SQLite and is fetchable by slip — driven through the real
 * HTTP routes.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { loadConfig } from '../src/config.js';
import { openDatabase, type Db } from '../src/db/connection.js';
import { WeighmentService } from '../src/services/weighment-service.js';
import { createWeightReader, type WeightReader } from '../src/indicator/index.js';
import { buildServer } from '../src/server.js';

let app: FastifyInstance;
let db: Db;
let reader: WeightReader;

const firstWeightBody = (overrides: Record<string, unknown> = {}) => ({
  customer_name: 'Ali Raza',
  customer_company: 'Raza Traders',
  customer_phone: '',
  vehicle_type: 'truck',
  vehicle_plate: 'LES-1234',
  container_number: '',
  product: 'Cement',
  first_weight_kg: 8000,
  first_weight_src: 'SERIAL',
  amount_charged: 300,
  operator_username: 'operator',
  ...overrides,
});

beforeEach(async () => {
  const config = loadConfig({
    USE_SIMULATOR: 'true',
    DATABASE_PATH: ':memory:',
    STATION_ID: 'A',
    LOG_LEVEL: 'fatal',
    NODE_ENV: 'test',
  } as NodeJS.ProcessEnv);

  db = openDatabase({ path: config.DATABASE_PATH });
  const service = new WeighmentService(db, { stationId: config.STATION_ID });
  reader = createWeightReader(config);
  await reader.start();

  // The API suite drives routes directly; serving the PWA build is covered
  // separately in static.test.ts.
  app = await buildServer({ config, reader, service, serveOperatorWeb: false });
});

afterEach(async () => {
  await app.close();
  await reader.stop();
  db.close();
});

describe('GET /live-weight', () => {
  it('streams a connected, simulated reading', async () => {
    const response = await app.inject({ method: 'GET', url: '/live-weight' });
    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(body.connected).toBe(true);
    expect(body.simulated).toBe(true);
    expect(typeof body.weight_kg).toBe('number');
    expect(body.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('changes as the simulator runs', async () => {
    await app.inject({ method: 'POST', url: '/simulator/weight', payload: { weight_kg: 8000 } });
    const first = (await app.inject({ url: '/live-weight' })).json();

    await app.inject({ method: 'POST', url: '/simulator/weight', payload: { weight_kg: 20_000 } });
    const second = (await app.inject({ url: '/live-weight' })).json();

    expect(first.weight_kg).toBe(8000);
    expect(second.weight_kg).toBe(20_000);
    expect(second.stable).toBe(true);
  });
});

describe('POST /weighments', () => {
  it('creates an OPEN record and returns its slip number', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/weighments',
      payload: firstWeightBody(),
    });
    expect(response.statusCode).toBe(201);

    const { weighment, warnings } = response.json();
    expect(weighment.slip_number).toBe('SI-000001');
    expect(weighment.status).toBe('OPEN');
    expect(weighment.net_weight_kg).toBe(0);
    expect(warnings).toEqual([]);
  });

  it('persists to SQLite — the record is there on a fresh query', async () => {
    await app.inject({ method: 'POST', url: '/weighments', payload: firstWeightBody() });

    const row = db.prepare('SELECT slip_number, status, first_weight_kg FROM weighments').get() as {
      slip_number: string;
      status: string;
      first_weight_kg: number;
    };
    expect(row).toEqual({ slip_number: 'SI-000001', status: 'OPEN', first_weight_kg: 8000 });
  });

  it('rejects a form with missing required fields and names them', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/weighments',
      payload: { first_weight_kg: 8000 },
    });

    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(Object.keys(body.error.details.field_errors)).toContain('customer_name');
  });

  it('returns the duplicate-plate warning alongside a successful save', async () => {
    await app.inject({ method: 'POST', url: '/weighments', payload: firstWeightBody() });
    const response = await app.inject({
      method: 'POST',
      url: '/weighments',
      payload: firstWeightBody(),
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().warnings[0].code).toBe('DUPLICATE_OPEN_PLATE');
  });
});

describe('GET /weighments/:slip', () => {
  it('fetches the record by slip number with net in all three units', async () => {
    await app.inject({ method: 'POST', url: '/weighments', payload: firstWeightBody() });

    const response = await app.inject({ url: '/weighments/SI-000001' });
    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(body.weighment.customer_name).toBe('Ali Raza');
    // Nothing to net yet — the second weighing has not happened.
    expect(body.net).toEqual({ kg: 0, ton: 0, maund: 0 });
  });

  it('accepts the slip as the operator types it', async () => {
    await app.inject({ method: 'POST', url: '/weighments', payload: firstWeightBody() });
    expect((await app.inject({ url: '/weighments/si-000001' })).statusCode).toBe(200);
    expect((await app.inject({ url: '/weighments/1' })).statusCode).toBe(200);
  });

  it('404s a slip that does not exist', async () => {
    const response = await app.inject({ url: '/weighments/SI-999999' });
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('SLIP_NOT_FOUND');
  });
});

describe('two-pass transaction over HTTP', () => {
  it('completes and returns net weight in kg, ton and maund', async () => {
    await app.inject({ method: 'POST', url: '/weighments', payload: firstWeightBody() });

    const response = await app.inject({
      method: 'PATCH',
      url: '/weighments/SI-000001/complete',
      payload: { second_weight_kg: 20_000, second_weight_src: 'SERIAL', amount_charged: 300 },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.weighment.status).toBe('COMPLETED');
    expect(body.net).toEqual({ kg: 12_000, ton: 12, maund: 300 });
  });

  it('blocks a second completion with a code the UI turns into a reprint offer', async () => {
    await app.inject({ method: 'POST', url: '/weighments', payload: firstWeightBody() });
    const complete = () =>
      app.inject({
        method: 'PATCH',
        url: '/weighments/SI-000001/complete',
        payload: { second_weight_kg: 20_000, amount_charged: 300 },
      });

    await complete();
    const response = await complete();
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('ALREADY_COMPLETED');
  });
});

describe('void and reprint', () => {
  it('voids an open ticket with a reason', async () => {
    await app.inject({ method: 'POST', url: '/weighments', payload: firstWeightBody() });

    const response = await app.inject({
      method: 'POST',
      url: '/weighments/SI-000001/void',
      payload: { reason: 'Truck never returned' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().weighment.status).toBe('VOID');
  });

  it('demands a reason for a void', async () => {
    await app.inject({ method: 'POST', url: '/weighments', payload: firstWeightBody() });
    const response = await app.inject({
      method: 'POST',
      url: '/weighments/SI-000001/void',
      payload: { reason: '' },
    });
    expect(response.statusCode).toBe(400);
  });

  it('records a reprint in the audit trail', async () => {
    await app.inject({ method: 'POST', url: '/weighments', payload: firstWeightBody() });
    await app.inject({
      method: 'POST',
      url: '/weighments/SI-000001/reprint',
      payload: { receipt: 'FIRST' },
    });

    const trail = (await app.inject({ url: '/weighments/SI-000001/audit' })).json();
    expect(trail.entries.map((e: { action: string }) => e.action)).toEqual([
      'CREATED',
      'REPRINTED',
    ]);
  });
});

describe('GET /sync-status', () => {
  it('reports the pending count and an honest offline state', async () => {
    await app.inject({ method: 'POST', url: '/weighments', payload: firstWeightBody() });

    const body = (await app.inject({ url: '/sync-status' })).json();
    expect(body.pending_count).toBe(1);
    expect(body.online).toBe(false);
    expect(body.last_success_at).toBeNull();
  });
});

describe('GET /customers', () => {
  it('returns customers the station has weighed before', async () => {
    await app.inject({ method: 'POST', url: '/weighments', payload: firstWeightBody() });

    const response = await app.inject({ url: '/customers?q=Ali' });
    expect(response.statusCode).toBe(200);
    expect(response.json().customers[0]).toMatchObject({
      name: 'Ali Raza',
      company: 'Raza Traders',
    });
  });

  it('returns the most recent when nothing is typed', async () => {
    await app.inject({ method: 'POST', url: '/weighments', payload: firstWeightBody() });
    expect((await app.inject({ url: '/customers' })).json().customers).toHaveLength(1);
  });

  it('is empty before anyone has been weighed', async () => {
    expect((await app.inject({ url: '/customers' })).json().customers).toEqual([]);
  });

  it('caps the limit so one request cannot ask for everything', async () => {
    const response = await app.inject({ url: '/customers?limit=100000' });
    expect(response.statusCode).toBe(200);
  });
});

describe('GET /weighments/:slip/pdf', () => {
  it('builds the receipt PDF here on the weighbridge PC', async () => {
    // Built locally, not proxied to the cloud: the operator has to be able to
    // hand a customer a PDF with the internet down.
    await app.inject({ method: 'POST', url: '/weighments', payload: firstWeightBody() });

    const response = await app.inject({ url: '/weighments/SI-000001/pdf' });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('application/pdf');
    expect(response.headers['content-disposition']).toContain('SI-000001-receipt.pdf');
    expect(response.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
    expect(response.rawPayload.byteLength).toBeGreaterThan(1000);
  });

  it('builds one for a completed weighing too', async () => {
    await app.inject({ method: 'POST', url: '/weighments', payload: firstWeightBody() });
    await app.inject({
      method: 'PATCH',
      url: '/weighments/SI-000001/complete',
      payload: { second_weight_kg: 20_000, amount_charged: 300 },
    });

    const response = await app.inject({ url: '/weighments/SI-000001/pdf' });
    expect(response.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('404s a slip that does not exist', async () => {
    const response = await app.inject({ url: '/weighments/SI-999999/pdf' });
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('SLIP_NOT_FOUND');
  });
});
