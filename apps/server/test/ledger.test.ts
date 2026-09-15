/**
 * The ledger, where the arithmetic has to be right.
 *
 * These tests are about money moving in the right direction and exactly once.
 * The sync retries batches as a matter of course, so "exactly once" is not a
 * theoretical concern here — it is the normal path.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
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
import { customerKey } from '@suarza/shared';
import {
  LedgerCustomerModel,
  LedgerEntryModel,
  syncLedgerIndexes,
} from '../src/models/ledger.model.js';
import { ingest } from '../src/services/ingest.service.js';
import { getCustomer, listEntries, summary } from '../src/services/ledger.service.js';

let app: Express;
let managerToken: string;

beforeAll(async () => {
  await startDatabase();
  app = testApp();
  await seedUsers();
  // Signed in once for the whole file: /auth/login is rate limited, and a
  // sign-in per test starts returning 429 part way through.
  managerToken = await signIn();
});
afterAll(stopDatabase);

// Records and ledgers are cleared between tests; the accounts stay, or the
// token signed in above stops being usable.
afterEach(async () => {
  await clearWeighments();
  await LedgerCustomerModel.deleteMany({});
  await LedgerEntryModel.deleteMany({});
});

async function signIn(): Promise<string> {
  const response = await request(app)
    .post('/auth/login')
    .send({ username: 'manager', password: 'manager' });
  return response.body.token as string;
}

const auth = () => ({ Authorization: `Bearer ${managerToken}` });
const ALI = customerKey('Ali Raza', 'Raza Traders');

describe('charges from weighings', () => {
  it('debits the customer when a weighing completes', async () => {
    await ingest([completedWeighment({ amount_charged: 300, payment_status: 'ON_ACCOUNT' })], []);

    const customer = await getCustomer(ALI);
    // Negative: the customer owes the business.
    expect(customer.balance_pkr).toBe(-300);
    expect(customer.total_charged_pkr).toBe(300);
  });

  it('leaves nothing owing when the customer paid at the gate', async () => {
    // The case that was wrong at first: every weighing was booked as a debt,
    // so cash customers showed up under "total owed to you".
    await ingest([completedWeighment({ amount_charged: 300, payment_status: 'PAID' })], []);

    const customer = await getCustomer(ALI);
    expect(customer.balance_pkr).toBe(0);
    // Both sides are on the statement, so the weighing is still visible.
    expect(customer.total_charged_pkr).toBe(300);
    expect(customer.total_paid_pkr).toBe(300);
    expect(await LedgerEntryModel.countDocuments({ weighment_id: { $ne: null } })).toBe(2);
  });

  it('keeps a paid weighing out of the receivable total', async () => {
    await ingest([completedWeighment({ amount_charged: 300, payment_status: 'PAID' })], []);
    const totals = await summary();
    expect(totals.total_receivable_pkr).toBe(0);
    expect(totals.customers_owing).toBe(0);
  });

  it('books a debt only when the weighing goes on account', async () => {
    await ingest([completedWeighment({ amount_charged: 300, payment_status: 'ON_ACCOUNT' })], []);
    expect((await getCustomer(ALI)).balance_pkr).toBe(-300);
  });

  it('clears the debt when a slip is corrected from on-account to paid', async () => {
    const record = completedWeighment({ amount_charged: 300, payment_status: 'ON_ACCOUNT' });
    await ingest([record], []);
    expect((await getCustomer(ALI)).balance_pkr).toBe(-300);

    await ingest([{ ...record, payment_status: 'PAID', updated_at: '2026-09-14T12:00:00.000Z' }], []);
    expect((await getCustomer(ALI)).balance_pkr).toBe(0);
  });

  it('restores the debt when a paid slip is corrected to on-account', async () => {
    const record = completedWeighment({ amount_charged: 300, payment_status: 'PAID' });
    await ingest([record], []);
    await ingest(
      [{ ...record, payment_status: 'ON_ACCOUNT', updated_at: '2026-09-14T12:00:00.000Z' }],
      [],
    );

    expect((await getCustomer(ALI)).balance_pkr).toBe(-300);
    // The gate payment is voided, not deleted.
    const entries = await listEntries(ALI);
    expect(entries.find((e) => e.kind === 'PAYMENT')?.voided).toBe(true);
  });

  it('voids both lines when a paid weighing is voided', async () => {
    const record = completedWeighment({ amount_charged: 300, payment_status: 'PAID' });
    await ingest([record], []);
    await ingest(
      [{ ...record, status: 'VOID', void_reason: 'Truck left', updated_at: '2026-09-14T12:00:00.000Z' }],
      [],
    );

    const entries = await listEntries(ALI);
    expect(entries).toHaveLength(2);
    expect(entries.every((e) => e.voided)).toBe(true);
    expect((await getCustomer(ALI)).balance_pkr).toBe(0);
  });

  it('posts a paid weighing once however many times the batch is re-sent', async () => {
    const record = completedWeighment({ amount_charged: 300, payment_status: 'PAID' });
    await ingest([record], []);
    await ingest([record], []);

    expect(await LedgerEntryModel.countDocuments({ weighment_id: record.id })).toBe(2);
    expect((await getCustomer(ALI)).balance_pkr).toBe(0);
  });

  it('posts nothing for a weighing that is still open', async () => {
    await ingest([weighment({ amount_charged: 300 })], []);
    await expect(getCustomer(ALI)).rejects.toThrow();
  });

  it('charges once however many times the batch is re-sent', async () => {
    // The sync worker re-sends on every retry; this is the normal path, not an
    // edge case, and charging twice would be money out of a customer's pocket.
    const record = completedWeighment({ amount_charged: 300, payment_status: 'ON_ACCOUNT' });
    await ingest([record], []);
    await ingest([record], []);
    await ingest([record], []);

    expect(await LedgerEntryModel.countDocuments({ kind: 'WEIGHING' })).toBe(1);
    expect((await getCustomer(ALI)).balance_pkr).toBe(-300);
  });

  it('follows a corrected amount rather than adding a second charge', async () => {
    const record = completedWeighment({ amount_charged: 300, payment_status: 'ON_ACCOUNT' });
    await ingest([record], []);
    await ingest([{ ...record, amount_charged: 450, updated_at: '2026-09-14T12:00:00.000Z' }], []);

    expect(await LedgerEntryModel.countDocuments({ kind: 'WEIGHING' })).toBe(1);
    expect((await getCustomer(ALI)).balance_pkr).toBe(-450);
  });

  it('drops the charge when the weighing is voided', async () => {
    const record = completedWeighment({ amount_charged: 300, payment_status: 'ON_ACCOUNT' });
    await ingest([record], []);
    await ingest(
      [{ ...record, status: 'VOID', void_reason: 'Truck left', updated_at: '2026-09-14T12:00:00.000Z' }],
      [],
    );

    expect((await getCustomer(ALI)).balance_pkr).toBe(0);
    // Still there, still visible — voiding is not deleting.
    const entries = await listEntries(ALI);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.voided).toBe(true);
  });

  it('treats one customer typed two ways as one account', async () => {
    await ingest([completedWeighment({ amount_charged: 300, payment_status: 'ON_ACCOUNT' })], []);
    await ingest(
      [
        completedWeighment({
          slip_number: 'SI-000002',
          customer_name: 'ALI  RAZA',
          customer_company: 'raza traders',
          amount_charged: 200,
          payment_status: 'ON_ACCOUNT',
        }),
      ],
      [],
    );

    expect(await LedgerCustomerModel.countDocuments()).toBe(1);
    expect((await getCustomer(ALI)).balance_pkr).toBe(-500);
  });
});

describe('payments and adjustments', () => {
  it('clears what a customer owes when they pay', async () => {
    await ingest([completedWeighment({ amount_charged: 300, payment_status: 'ON_ACCOUNT' })], []);

    const response = await request(app)
      .post(`/api/ledger/customers/${encodeURIComponent(ALI)}/entries`)
      .set(auth())
      .send({ direction: 'CREDIT', kind: 'PAYMENT', amount_pkr: 300 });

    expect(response.status).toBe(201);
    expect(response.body.customer.balance_pkr).toBe(0);
  });

  it('leaves the customer in credit when they pay more than they owe', async () => {
    await ingest([completedWeighment({ amount_charged: 300, payment_status: 'ON_ACCOUNT' })], []);
    await request(app)
      .post(`/api/ledger/customers/${encodeURIComponent(ALI)}/entries`)
      .set(auth())
      .send({ direction: 'CREDIT', kind: 'PAYMENT', amount_pkr: 500 });

    expect((await getCustomer(ALI)).balance_pkr).toBe(200);
  });

  it('takes an advance from a customer who has never been weighed', async () => {
    const created = await request(app)
      .post('/api/ledger/customers')
      .set(auth())
      .send({ name: 'New Customer', company: 'New Co' });
    expect(created.status).toBe(201);

    const id = created.body.customer.id as string;
    await request(app)
      .post(`/api/ledger/customers/${encodeURIComponent(id)}/entries`)
      .set(auth())
      .send({ direction: 'CREDIT', kind: 'PAYMENT', amount_pkr: 1000 });

    expect((await getCustomer(id)).balance_pkr).toBe(1000);
  });

  it('spends an advance as the customer is weighed', async () => {
    const created = await request(app)
      .post('/api/ledger/customers')
      .set(auth())
      .send({ name: 'Ali Raza', company: 'Raza Traders' });
    expect(created.status).toBe(201);

    await request(app)
      .post(`/api/ledger/customers/${encodeURIComponent(ALI)}/entries`)
      .set(auth())
      .send({ direction: 'CREDIT', kind: 'PAYMENT', amount_pkr: 1000 });

    await ingest([completedWeighment({ amount_charged: 300, payment_status: 'ON_ACCOUNT' })], []);

    expect((await getCustomer(ALI)).balance_pkr).toBe(700);
  });

  it('stops a voided entry counting, without removing it', async () => {
    const posted = await request(app)
      .post(`/api/ledger/customers/${encodeURIComponent(await openAli())}/entries`)
      .set(auth())
      .send({ direction: 'CREDIT', kind: 'PAYMENT', amount_pkr: 500 });

    const entryId = posted.body.entry.id as string;
    const voided = await request(app)
      .post(`/api/ledger/customers/${encodeURIComponent(ALI)}/entries/${entryId}/void`)
      .set(auth())
      .send({ reason: 'Entered twice' });

    expect(voided.status).toBe(200);
    expect(voided.body.customer.balance_pkr).toBe(0);
    expect(await LedgerEntryModel.countDocuments()).toBe(1);
  });

  it('refuses to void a weighing charge from the ledger', async () => {
    // Voiding it here would leave the slip standing with no charge behind it.
    await ingest([completedWeighment({ amount_charged: 300, payment_status: 'ON_ACCOUNT' })], []);
    const entries = await listEntries(ALI);

    const response = await request(app)
      .post(`/api/ledger/customers/${encodeURIComponent(ALI)}/entries/${entries[0]!.id}/void`)
      .set(auth())
      .send({ reason: 'Mistake' });

    expect(response.status).toBe(400);
    expect((await getCustomer(ALI)).balance_pkr).toBe(-300);
  });
});

describe('the statement', () => {
  it('shows the balance as it stood after each entry', async () => {
    await ingest([completedWeighment({ amount_charged: 300, payment_status: 'ON_ACCOUNT' })], []);
    await request(app)
      .post(`/api/ledger/customers/${encodeURIComponent(ALI)}/entries`)
      .set(auth())
      .send({
        direction: 'CREDIT',
        kind: 'PAYMENT',
        amount_pkr: 100,
        at: '2026-09-15T09:00:00.000Z',
      });

    const entries = await listEntries(ALI);
    expect(entries.map((e) => e.balance_after_pkr)).toEqual([-300, -200]);
  });

  it('orders by when it happened, not when it was typed in', async () => {
    // A payment taken yesterday, recorded today, belongs before today's charge.
    await request(app)
      .post('/api/ledger/customers')
      .set(auth())
      .send({ name: 'Ali Raza', company: 'Raza Traders' });
    await request(app)
      .post(`/api/ledger/customers/${encodeURIComponent(ALI)}/entries`)
      .set(auth())
      .send({
        direction: 'CREDIT',
        kind: 'PAYMENT',
        amount_pkr: 100,
        at: '2026-09-13T09:00:00.000Z',
      });
    await ingest([completedWeighment({ amount_charged: 300, payment_status: 'ON_ACCOUNT' })], []);

    const entries = await listEntries(ALI);
    expect(entries.map((e) => e.kind)).toEqual(['PAYMENT', 'WEIGHING']);
    expect(entries.map((e) => e.balance_after_pkr)).toEqual([100, -200]);
  });
});

describe('the summary', () => {
  it('separates what is owed from what is held in advance', async () => {
    await ingest([completedWeighment({ amount_charged: 300, payment_status: 'ON_ACCOUNT' })], []);
    await request(app)
      .post('/api/ledger/customers')
      .set(auth())
      .send({ name: 'Payer', company: 'Payer Co' });
    await request(app)
      .post(`/api/ledger/customers/${encodeURIComponent(customerKey('Payer', 'Payer Co'))}/entries`)
      .set(auth())
      .send({ direction: 'CREDIT', kind: 'PAYMENT', amount_pkr: 500 });

    const totals = await summary();
    // Receivable is reported positive: "you are owed 300", not "-300".
    expect(totals.total_receivable_pkr).toBe(300);
    expect(totals.total_advance_pkr).toBe(500);
    expect(totals.customers_owing).toBe(1);
    expect(totals.customers_in_credit).toBe(1);
  });
});

describe('index drift', () => {
  it('posts both lines even when an older unique index is still in place', async () => {
    // The bug this guards: the schema once had a unique index on weighment_id
    // alone. Mongoose adds new indexes but never drops superseded ones, so on a
    // real database the settlement line was rejected with a duplicate key and
    // every cash customer showed up as owing money. Nothing caught it because
    // the in-memory database here is built fresh from the current schema.
    await LedgerEntryModel.collection.createIndex(
      { weighment_id: 1 },
      { unique: true, sparse: true, name: 'weighment_id_1' },
    );

    await syncLedgerIndexes();

    await ingest([completedWeighment({ amount_charged: 300, payment_status: 'PAID' })], []);
    expect((await getCustomer(ALI)).balance_pkr).toBe(0);
    expect(await LedgerEntryModel.countDocuments({ weighment_id: { $ne: null } })).toBe(2);
  });
});

describe('who can see the ledger', () => {
  it('refuses a request with no token', async () => {
    expect((await request(app).get('/api/ledger/customers')).status).toBe(401);
  });

  it('refuses an operator — the ledger is the manager\'s', async () => {
    const operator = await request(app)
      .post('/auth/login')
      .send({ username: 'operator', password: 'operator' });

    const response = await request(app)
      .get('/api/ledger/customers')
      .set({ Authorization: `Bearer ${operator.body.token}` });

    expect(response.status).toBe(403);
  });
});

/** Opens Ali's account without weighing him, for payment-only cases. */
async function openAli(): Promise<string> {
  await request(app)
    .post('/api/ledger/customers')
    .set(auth())
    .send({ name: 'Ali Raza', company: 'Raza Traders' });
  return ALI;
}
