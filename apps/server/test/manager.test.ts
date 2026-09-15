/**
 * M5 acceptance, second half: manager endpoints return filtered, paginated data
 * and analytics that exclude VOID.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import {
  clearWeighments,
  completedWeighment,
  startDatabase,
  stopDatabase,
  testApp,
  weighment,
} from './helpers.js';
import { seedUsers } from '../src/services/auth.service.js';
import { ingest } from '../src/services/ingest.service.js';

let app: Express;
let token: string;

beforeAll(async () => {
  await startDatabase();
  app = testApp();
  await seedUsers();

  // Signed in ONCE for the whole file. /auth/login is rate-limited to 20
  // attempts per window — correct for a public endpoint guarding every record
  // — so a login per test starts returning 429 part way through and every
  // later assertion fails as "unauthorized".
  const response = await request(app)
    .post('/auth/login')
    .send({ username: 'manager', password: 'manager' });
  token = response.body.token;
});

afterAll(stopDatabase);
// Records are cleared between tests; the accounts stay.
afterEach(clearWeighments);

const authed = (path: string) => request(app).get(path).set('authorization', `Bearer ${token}`);

async function seedRecords() {
  await ingest(
    [
      completedWeighment({
        slip_number: 'SI-000001',
        customer_name: 'Ali Raza',
        customer_company: 'Raza Traders',
        vehicle_type: 'truck',
        amount_charged: 300,
        net_weight_kg: 12_000,
        first_weight_at: '2026-09-10T06:00:00.000Z',
      }),
      completedWeighment({
        slip_number: 'SI-000002',
        customer_name: 'Bilal Khan',
        customer_company: 'Khan Brothers',
        vehicle_type: 'container',
        amount_charged: 500,
        net_weight_kg: 18_000,
        first_weight_at: '2026-09-11T06:00:00.000Z',
      }),
      completedWeighment({
        slip_number: 'SI-000003',
        customer_name: 'Ali Raza',
        customer_company: 'Raza Traders',
        vehicle_type: 'truck',
        amount_charged: 300,
        net_weight_kg: 9000,
        first_weight_at: '2026-09-12T06:00:00.000Z',
      }),
      weighment({
        slip_number: 'SI-000004',
        customer_name: 'Open Ticket',
        customer_company: 'Pending Co',
        vehicle_type: 'dumper',
        amount_charged: 400,
        first_weight_at: '2026-09-13T06:00:00.000Z',
      }),
      weighment({
        slip_number: 'SI-000005',
        status: 'VOID',
        customer_name: 'Abandoned',
        customer_company: 'Gone Co',
        vehicle_type: 'trailer',
        // A large amount that must NOT appear in revenue.
        amount_charged: 9999,
        void_reason: 'Truck never returned',
        first_weight_at: '2026-09-13T07:00:00.000Z',
      }),
    ],
    [],
  );
}

describe('GET /weighments', () => {
  beforeEach(seedRecords);

  it('returns every record, newest event first', async () => {
    const { body } = await authed('/weighments');
    expect(body.total).toBe(5);
    expect(body.rows[0].slip_number).toBe('SI-000005');
  });

  it('paginates', async () => {
    const page1 = await authed('/weighments?page=1&page_size=2');
    const page2 = await authed('/weighments?page=2&page_size=2');

    expect(page1.body.rows).toHaveLength(2);
    expect(page1.body.total).toBe(5);
    expect(page2.body.rows).toHaveLength(2);
    expect(page2.body.rows[0].slip_number).not.toBe(page1.body.rows[0].slip_number);
  });

  it('filters by customer name, partially and case-insensitively', async () => {
    const { body } = await authed('/weighments?customer_name=ali');
    expect(body.total).toBe(2);
    expect(body.rows.every((r: { customer_name: string }) => r.customer_name === 'Ali Raza')).toBe(
      true,
    );
  });

  it('filters by company', async () => {
    const { body } = await authed('/weighments?customer_company=Khan');
    expect(body.total).toBe(1);
    expect(body.rows[0].slip_number).toBe('SI-000002');
  });

  it('filters by vehicle type', async () => {
    const { body } = await authed('/weighments?vehicle_type=truck');
    expect(body.total).toBe(2);
  });

  it('filters by status', async () => {
    expect((await authed('/weighments?status=VOID')).body.total).toBe(1);
    expect((await authed('/weighments?status=OPEN')).body.total).toBe(1);
  });

  it('filters on the event time, not when the record synced', async () => {
    // All five synced just now; only their weighing times differ.
    const { body } = await authed(
      '/weighments?from=2026-09-11T00:00:00.000Z&to=2026-09-12T23:59:59.000Z',
    );
    expect(body.total).toBe(2);
    expect(body.rows.map((r: { slip_number: string }) => r.slip_number).sort()).toEqual([
      'SI-000002',
      'SI-000003',
    ]);
  });

  it('treats a regex metacharacter in a name as text, not a pattern', async () => {
    const { body } = await authed('/weighments?customer_name=' + encodeURIComponent('Ali.*'));
    expect(body.total).toBe(0);
  });

  it('rejects a nonsense page size rather than trying to serve it', async () => {
    expect((await authed('/weighments?page_size=100000')).status).toBe(400);
  });
});

describe('GET /weighments/:slip', () => {
  beforeEach(seedRecords);

  it('returns one record', async () => {
    const { body } = await authed('/weighments/SI-000002');
    expect(body.weighment.customer_name).toBe('Bilal Khan');
    expect(body.weighment.net_weight_kg).toBe(18_000);
  });

  it('404s an unknown slip', async () => {
    const response = await authed('/weighments/SI-999999');
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
  });
});

describe('GET /analytics', () => {
  beforeEach(seedRecords);

  it('excludes voided tickets from revenue', async () => {
    const { body } = await authed('/analytics');
    // 300 + 500 + 300 + 400 = 1500. The voided 9999 must not appear.
    expect(body.total_revenue).toBe(1500);
    expect(body.total_weighments).toBe(4);
  });

  it('excludes voided tickets from total net weight', async () => {
    const { body } = await authed('/analytics');
    expect(body.total_net_weight_kg).toBe(39_000);
  });

  it('counts completed and open separately', async () => {
    const { body } = await authed('/analytics');
    expect(body.completed_weighments).toBe(3);
    expect(body.open_weighments).toBe(1);
  });

  it('breaks revenue down by vehicle type, highest first', async () => {
    const { body } = await authed('/analytics');
    const truck = body.revenue_by_vehicle_type.find(
      (r: { vehicle_type: string }) => r.vehicle_type === 'truck',
    );
    expect(truck).toMatchObject({ revenue: 600, count: 2 });
    expect(
      body.revenue_by_vehicle_type.some(
        (r: { vehicle_type: string }) => r.vehicle_type === 'trailer',
      ),
    ).toBe(false);
  });

  it('buckets weighments by Pakistan local day', async () => {
    const { body } = await authed('/analytics');
    const dates = body.weighments_over_time.map((r: { date: string }) => r.date);
    expect(dates).toEqual(['2026-09-10', '2026-09-11', '2026-09-12', '2026-09-13']);
  });

  it('ranks top customers and companies by revenue', async () => {
    const { body } = await authed('/analytics');
    expect(body.top_customers[0]).toMatchObject({
      customer_name: 'Ali Raza',
      count: 2,
      revenue: 600,
    });
    expect(body.top_companies[0]).toMatchObject({ customer_company: 'Raza Traders', revenue: 600 });
  });

  it('respects the active filters', async () => {
    const { body } = await authed('/analytics?vehicle_type=truck');
    expect(body.total_revenue).toBe(600);
    expect(body.total_weighments).toBe(2);
  });

  it('returns zeros rather than failing when nothing matches', async () => {
    const { body } = await authed('/analytics?customer_name=nobody-at-all');
    expect(body.total_revenue).toBe(0);
    expect(body.total_weighments).toBe(0);
    expect(body.weighments_over_time).toEqual([]);
  });
});

describe('GET /suggestions', () => {
  beforeEach(seedRecords);

  it('suggests customer names already in the records', async () => {
    const { body } = await authed('/suggestions?field=customer_name&q=ali');
    expect(body.values).toEqual(['Ali Raza']);
  });

  it('suggests company names', async () => {
    const { body } = await authed('/suggestions?field=customer_company&q=kh');
    expect(body.values).toEqual(['Khan Brothers']);
  });

  it('is case-insensitive', async () => {
    expect((await authed('/suggestions?field=customer_name&q=ALI')).body.values).toEqual([
      'Ali Raza',
    ]);
  });

  it('puts the most frequent names first', async () => {
    // Ali Raza appears twice in the seed, the others once.
    const { body } = await authed('/suggestions?field=customer_name');
    expect(body.values[0]).toBe('Ali Raza');
  });

  it('never suggests a name that only appears on a voided ticket', async () => {
    // Suggesting it would offer a filter that shows nothing in the figures.
    const { body } = await authed('/suggestions?field=customer_name&q=Abandoned');
    expect(body.values).toEqual([]);
  });

  it('treats a regex metacharacter as text', async () => {
    expect(
      (await authed('/suggestions?field=customer_name&q=' + encodeURIComponent('Ali.*'))).body
        .values,
    ).toEqual([]);
  });

  it('returns an empty list rather than failing when nothing matches', async () => {
    expect((await authed('/suggestions?field=customer_name&q=zzzz')).body.values).toEqual([]);
  });

  it('rejects a field that is not suggestible', async () => {
    // Otherwise the endpoint would happily enumerate any column.
    const response = await request(app)
      .get('/suggestions?field=amount_charged')
      .set('authorization', `Bearer ${token}`);
    expect(response.status).toBe(400);
  });

  it('needs a signed-in manager', async () => {
    expect((await request(app).get('/suggestions?field=customer_name')).status).toBe(401);
  });
});
