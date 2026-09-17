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
import { WeighmentModel } from '../src/models/weighment.model.js';
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
const ALI_KEY = customerKey('Ali Raza', 'Raza Traders');

/**
 * The account's generated id, looked up by the key a weighing matches on.
 *
 * The id is the database's now, not `name|company`, so a test has to ask for it
 * the same way the app does rather than being able to construct it.
 */
async function idFor(matchKey: string): Promise<string> {
  const doc = await LedgerCustomerModel.findOne({ match_key: matchKey }).lean();
  if (!doc) throw new Error(`No ledger account for ${matchKey}`);
  return String(doc._id);
}

const aliId = () => idFor(ALI_KEY);

describe('charges from weighings', () => {
  it('debits the customer when a weighing completes', async () => {
    await ingest([completedWeighment({ amount_charged: 300, payment_status: 'ON_ACCOUNT' })], []);

    const customer = await getCustomer(await aliId());
    // Negative: the customer owes the business.
    expect(customer.balance_pkr).toBe(-300);
    expect(customer.total_charged_pkr).toBe(300);
  });

  it('leaves nothing owing when the customer paid at the gate', async () => {
    // The case that was wrong at first: every weighing was booked as a debt,
    // so cash customers showed up under "total owed to you".
    await ingest([completedWeighment({ amount_charged: 300, payment_status: 'PAID' })], []);

    const customer = await getCustomer(await aliId());
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
    expect((await getCustomer(await aliId())).balance_pkr).toBe(-300);
  });

  it('clears the debt when a slip is corrected from on-account to paid', async () => {
    const record = completedWeighment({ amount_charged: 300, payment_status: 'ON_ACCOUNT' });
    await ingest([record], []);
    expect((await getCustomer(await aliId())).balance_pkr).toBe(-300);

    await ingest([{ ...record, payment_status: 'PAID', updated_at: '2026-09-14T12:00:00.000Z' }], []);
    expect((await getCustomer(await aliId())).balance_pkr).toBe(0);
  });

  it('restores the debt when a paid slip is corrected to on-account', async () => {
    const record = completedWeighment({ amount_charged: 300, payment_status: 'PAID' });
    await ingest([record], []);
    await ingest(
      [{ ...record, payment_status: 'ON_ACCOUNT', updated_at: '2026-09-14T12:00:00.000Z' }],
      [],
    );

    expect((await getCustomer(await aliId())).balance_pkr).toBe(-300);
    // The gate payment is voided, not deleted.
    const entries = await listEntries(await aliId());
    expect(entries.find((e) => e.kind === 'PAYMENT')?.voided).toBe(true);
  });

  it('voids both lines when a paid weighing is voided', async () => {
    const record = completedWeighment({ amount_charged: 300, payment_status: 'PAID' });
    await ingest([record], []);
    await ingest(
      [{ ...record, status: 'VOID', void_reason: 'Truck left', updated_at: '2026-09-14T12:00:00.000Z' }],
      [],
    );

    const entries = await listEntries(await aliId());
    expect(entries).toHaveLength(2);
    expect(entries.every((e) => e.voided)).toBe(true);
    expect((await getCustomer(await aliId())).balance_pkr).toBe(0);
  });

  it('posts a paid weighing once however many times the batch is re-sent', async () => {
    const record = completedWeighment({ amount_charged: 300, payment_status: 'PAID' });
    await ingest([record], []);
    await ingest([record], []);

    expect(await LedgerEntryModel.countDocuments({ weighment_id: record.id })).toBe(2);
    expect((await getCustomer(await aliId())).balance_pkr).toBe(0);
  });

  it('opens no account for a weighing with no customer name', async () => {
    // Option A, as the client chose: no name, no ledger. Every unnamed
    // weighing would otherwise share one key and pool into a single balance
    // belonging to nobody.
    await ingest(
      [completedWeighment({ customer_name: '', amount_charged: 300, payment_status: 'ON_ACCOUNT' })],
      [],
    );

    expect(await LedgerCustomerModel.countDocuments()).toBe(0);
    expect(await LedgerEntryModel.countDocuments()).toBe(0);
  });

  it('keeps unnamed weighings out of what you are owed', async () => {
    await ingest(
      [completedWeighment({ customer_name: '', amount_charged: 300, payment_status: 'ON_ACCOUNT' })],
      [],
    );

    const totals = await summary();
    expect(totals.total_receivable_pkr).toBe(0);
    expect(totals.customers_owing).toBe(0);
  });

  it('still records the weighing itself', async () => {
    // The ledger skips it; the weighbridge record is untouched and still shows
    // up in reports and searches.
    await ingest([completedWeighment({ customer_name: '', amount_charged: 300 })], []);
    expect(await WeighmentModel.countDocuments()).toBe(1);
  });

  it('posts nothing for a weighing that is still open', async () => {
    await ingest([weighment({ amount_charged: 300 })], []);
    // No charge, so no account was opened either — accounts exist because a
    // customer was charged, not because they were weighed.
    expect(await LedgerCustomerModel.countDocuments({ match_key: ALI_KEY })).toBe(0);
  });

  it('charges once however many times the batch is re-sent', async () => {
    // The sync worker re-sends on every retry; this is the normal path, not an
    // edge case, and charging twice would be money out of a customer's pocket.
    const record = completedWeighment({ amount_charged: 300, payment_status: 'ON_ACCOUNT' });
    await ingest([record], []);
    await ingest([record], []);
    await ingest([record], []);

    expect(await LedgerEntryModel.countDocuments({ kind: 'WEIGHING' })).toBe(1);
    expect((await getCustomer(await aliId())).balance_pkr).toBe(-300);
  });

  it('follows a corrected amount rather than adding a second charge', async () => {
    const record = completedWeighment({ amount_charged: 300, payment_status: 'ON_ACCOUNT' });
    await ingest([record], []);
    await ingest([{ ...record, amount_charged: 450, updated_at: '2026-09-14T12:00:00.000Z' }], []);

    expect(await LedgerEntryModel.countDocuments({ kind: 'WEIGHING' })).toBe(1);
    expect((await getCustomer(await aliId())).balance_pkr).toBe(-450);
  });

  it('drops the charge when the weighing is voided', async () => {
    const record = completedWeighment({ amount_charged: 300, payment_status: 'ON_ACCOUNT' });
    await ingest([record], []);
    await ingest(
      [{ ...record, status: 'VOID', void_reason: 'Truck left', updated_at: '2026-09-14T12:00:00.000Z' }],
      [],
    );

    expect((await getCustomer(await aliId())).balance_pkr).toBe(0);
    // Still there, still visible — voiding is not deleting.
    const entries = await listEntries(await aliId());
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
    expect((await getCustomer(await aliId())).balance_pkr).toBe(-500);
  });
});

describe('payments and adjustments', () => {
  it('clears what a customer owes when they pay', async () => {
    await ingest([completedWeighment({ amount_charged: 300, payment_status: 'ON_ACCOUNT' })], []);

    const response = await request(app)
      .post(`/api/ledger/customers/${encodeURIComponent(await aliId())}/entries`)
      .set(auth())
      .send({ direction: 'CREDIT', kind: 'PAYMENT', amount_pkr: 300 });

    expect(response.status).toBe(201);
    expect(response.body.customer.balance_pkr).toBe(0);
  });

  it('leaves the customer in credit when they pay more than they owe', async () => {
    await ingest([completedWeighment({ amount_charged: 300, payment_status: 'ON_ACCOUNT' })], []);
    await request(app)
      .post(`/api/ledger/customers/${encodeURIComponent(await aliId())}/entries`)
      .set(auth())
      .send({ direction: 'CREDIT', kind: 'PAYMENT', amount_pkr: 500 });

    expect((await getCustomer(await aliId())).balance_pkr).toBe(200);
  });

  it('spends an advance on the customer\'s next weighing', async () => {
    // Accounts exist because a customer has been weighed, so an advance is
    // taken against an account that already exists.
    await ingest([completedWeighment({ amount_charged: 300, payment_status: 'PAID' })], []);
    await request(app)
      .post(`/api/ledger/customers/${encodeURIComponent(await aliId())}/entries`)
      .set(auth())
      .send({ direction: 'CREDIT', kind: 'PAYMENT', amount_pkr: 1000 });

    expect((await getCustomer(await aliId())).balance_pkr).toBe(1000);

    await ingest(
      [
        completedWeighment({
          slip_number: 'SI-000002',
          amount_charged: 300,
          payment_status: 'ON_ACCOUNT',
        }),
      ],
      [],
    );

    expect((await getCustomer(await aliId())).balance_pkr).toBe(700);
  });

  it('stops a voided entry counting, without removing it', async () => {
    await ingest([completedWeighment({ amount_charged: 300, payment_status: 'ON_ACCOUNT' })], []);
    const posted = await request(app)
      .post(`/api/ledger/customers/${encodeURIComponent(await aliId())}/entries`)
      .set(auth())
      .send({ direction: 'CREDIT', kind: 'PAYMENT', amount_pkr: 500 });

    const entryId = posted.body.entry.id as string;
    const voided = await request(app)
      .post(`/api/ledger/customers/${encodeURIComponent(await aliId())}/entries/${entryId}/void`)
      .set(auth())
      .send({ reason: 'Entered twice' });

    expect(voided.status).toBe(200);
    // Back to just the weighing charge.
    expect(voided.body.customer.balance_pkr).toBe(-300);
    expect(await LedgerEntryModel.countDocuments()).toBe(2);
  });

  it('refuses to void a weighing charge from the ledger', async () => {
    // Voiding it here would leave the slip standing with no charge behind it.
    await ingest([completedWeighment({ amount_charged: 300, payment_status: 'ON_ACCOUNT' })], []);
    const entries = await listEntries(await aliId());

    const response = await request(app)
      .post(`/api/ledger/customers/${encodeURIComponent(await aliId())}/entries/${entries[0]!.id}/void`)
      .set(auth())
      .send({ reason: 'Mistake' });

    expect(response.status).toBe(400);
    expect((await getCustomer(await aliId())).balance_pkr).toBe(-300);
  });
});

describe('the statement', () => {
  it('shows the balance as it stood after each entry', async () => {
    await ingest([completedWeighment({ amount_charged: 300, payment_status: 'ON_ACCOUNT' })], []);
    await request(app)
      .post(`/api/ledger/customers/${encodeURIComponent(await aliId())}/entries`)
      .set(auth())
      .send({
        direction: 'CREDIT',
        kind: 'PAYMENT',
        amount_pkr: 100,
        at: '2026-09-15T09:00:00.000Z',
      });

    const entries = await listEntries(await aliId());
    expect(entries.map((e) => e.balance_after_pkr)).toEqual([-300, -200]);
  });

  it('orders by when it happened, not when it was typed in', async () => {
    // A payment taken before today's charge belongs before it on the statement.
    await ingest([completedWeighment({ amount_charged: 300, payment_status: 'ON_ACCOUNT' })], []);
    await request(app)
      .post(`/api/ledger/customers/${encodeURIComponent(await aliId())}/entries`)
      .set(auth())
      .send({
        direction: 'CREDIT',
        kind: 'PAYMENT',
        amount_pkr: 100,
        at: '2026-09-13T09:00:00.000Z',
      });

    const entries = await listEntries(await aliId());
    expect(entries.map((e) => e.kind)).toEqual(['PAYMENT', 'WEIGHING']);
    expect(entries.map((e) => e.balance_after_pkr)).toEqual([100, -200]);
  });
});

describe('the summary', () => {
  it('separates what is owed from what is held in advance', async () => {
    await ingest([completedWeighment({ amount_charged: 300, payment_status: 'ON_ACCOUNT' })], []);
    // A second customer, weighed and then overpaid, so they sit in credit.
    await ingest(
      [
        completedWeighment({
          slip_number: 'SI-000009',
          customer_name: 'Payer',
          customer_company: 'Payer Co',
          amount_charged: 100,
          payment_status: 'PAID',
        }),
      ],
      [],
    );
    await request(app)
      .post(
        `/api/ledger/customers/${encodeURIComponent(await idFor(customerKey('Payer', 'Payer Co')))}/entries`,
      )
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
    expect((await getCustomer(await aliId())).balance_pkr).toBe(0);
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
