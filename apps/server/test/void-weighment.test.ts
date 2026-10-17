/**
 * Setting a weighing aside, and bringing it back.
 *
 * Three things worth proving and none of them obvious from reading the code:
 * that a voided weighing stops counting towards anything, that it is still
 * there to look at, and that it cannot be brought back to life by the
 * weighbridge syncing its own copy over the top.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { clearDatabase, completedWeighment, startDatabase, stopDatabase } from './helpers.js';
import { ingest } from '../src/services/ingest.service.js';
import {
  restoreWeighmentBySlip,
  voidWeighmentBySlip,
} from '../src/services/void-weighment.service.js';
import { WeighmentModel } from '../src/models/weighment.model.js';
import { LedgerCustomerModel, LedgerEntryModel } from '../src/models/ledger.model.js';
import { getCustomer, listEntries } from '../src/services/ledger.service.js';
import { getAnalytics } from '../src/services/analytics.service.js';
import { weighmentQuerySchema } from '@suarza/shared';

beforeAll(startDatabase);
afterAll(stopDatabase);

/*
 * The ledger too, which clearDatabase leaves alone — it belongs to the cloud
 * rather than to a weighbridge batch, and most suites want it kept. Here it
 * must go between cases: every weighing in this file is for the same customer
 * by default, so one test's entries would be counted by the next.
 */
afterEach(async () => {
  await clearDatabase();
  await Promise.all([LedgerEntryModel.deleteMany({}), LedgerCustomerModel.deleteMany({})]);
});

const everything = () => weighmentQuerySchema.parse({});

describe('voiding a weighing', () => {
  it('takes it out of the takings but leaves it on the record', async () => {
    const record = completedWeighment({ slip_number: '202801', amount_charged: 300 });
    await ingest([record], []);
    expect((await getAnalytics(everything())).total_revenue).toBe(300);

    const voided = await voidWeighmentBySlip('202801', 'Truck never returned', 'admin');

    expect(voided.status).toBe('VOID');
    expect(voided.void_reason).toBe('Truck never returned');
    // Out of the money...
    expect((await getAnalytics(everything())).total_revenue).toBe(0);
    // ...and still there to look at, which is the whole difference from
    // deleting, which this replaced.
    expect(await WeighmentModel.countDocuments({ slip_number: '202801' })).toBe(1);
  });

  it('accepts no reason at all, and leaves the slip saying none was given', async () => {
    /*
     * The reason is optional for a manager: the log already records who set
     * the slip aside and when. What must not happen is an empty string
     * reaching the record, where the statement would print "Voided:" with
     * nothing after it.
     */
    await ingest([completedWeighment({ slip_number: '202810' })], []);

    const voided = await voidWeighmentBySlip('202810', '', 'admin');

    expect(voided.status).toBe('VOID');
    expect(voided.void_reason).toBeNull();
  });

  it('takes its charge off the customer, and puts it back on restoring', async () => {
    const record = completedWeighment({
      slip_number: '202802',
      amount_charged: 500,
      payment_status: 'ON_ACCOUNT',
    });
    await ingest([record], []);

    const id = String((await LedgerCustomerModel.findOne().lean())!._id);
    expect((await getCustomer(id)).balance_pkr).toBe(-500);

    await voidWeighmentBySlip('202802', 'Weighed twice by mistake', 'admin');
    expect((await getCustomer(id)).balance_pkr).toBe(0);

    await restoreWeighmentBySlip('202802', 'admin');
    expect((await getCustomer(id)).balance_pkr).toBe(-500);
  });

  it('leaves the voided charge on the statement rather than hiding it', async () => {
    /*
     * The customer may already have been told about the charge. It stays
     * visible, marked as voided, and simply stops counting — which is what
     * the balance above proves and what this makes sure of.
     */
    const record = completedWeighment({ amount_charged: 500, payment_status: 'ON_ACCOUNT' });
    await ingest([record], []);
    const id = String((await LedgerCustomerModel.findOne().lean())!._id);

    await voidWeighmentBySlip(record.slip_number, 'Weighed twice', 'admin');

    const entries = await listEntries(id);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.voided).toBe(true);
  });

  it('puts back OPEN rather than COMPLETED for a half-finished weighing', async () => {
    // Restoring must not invent a completion that never happened.
    const open = completedWeighment({
      slip_number: '202803',
      status: 'OPEN',
      second_weight_kg: null,
      second_weight_at: null,
      second_weight_src: null,
      net_weight_kg: 0,
    });
    await ingest([open], []);

    await voidWeighmentBySlip('202803', 'Driver left', 'admin');
    const restored = await restoreWeighmentBySlip('202803', 'admin');

    expect(restored.status).toBe('OPEN');
    expect(restored.void_reason).toBeNull();
  });

  it('refuses to void twice, or to restore what is not voided', async () => {
    const record = completedWeighment({ slip_number: '202804' });
    await ingest([record], []);

    await expect(restoreWeighmentBySlip('202804', 'admin')).rejects.toThrow(/not voided/i);
    await voidWeighmentBySlip('202804', 'A reason', 'admin');
    await expect(voidWeighmentBySlip('202804', 'Again', 'admin')).rejects.toThrow(
      /already voided/i,
    );
  });

  it('refuses a slip it does not have', async () => {
    await expect(voidWeighmentBySlip('2026999', 'why', 'admin')).rejects.toThrow(/no weighment/i);
  });
});

describe('a voided weighing and the weighbridge', () => {
  it('stays voided when the bridge syncs its own copy over the top', async () => {
    /*
     * The failure this guards against. The bridge's copy still says
     * COMPLETED and is re-sent whenever anything touches it — a reprint, a
     * correction — and every write is an upsert. Without the note, a slip
     * voided in the morning would quietly count itself back in.
     */
    const record = completedWeighment({ slip_number: '202805', amount_charged: 300 });
    await ingest([record], []);
    await voidWeighmentBySlip('202805', 'Set aside', 'admin');

    await ingest([{ ...record, updated_at: '2026-10-18T10:00:00.000Z' }], []);

    const stored = await WeighmentModel.findOne({ slip_number: '202805' }).lean();
    expect(stored!.status).toBe('VOID');
    expect(stored!.void_reason).toBe('Set aside');
    expect((await getAnalytics(everything())).total_revenue).toBe(0);
  });

  it("accepts the bridge's copy again once it has been restored", async () => {
    const record = completedWeighment({ slip_number: '202806', amount_charged: 300 });
    await ingest([record], []);
    await voidWeighmentBySlip('202806', 'Set aside', 'admin');
    await restoreWeighmentBySlip('202806', 'admin');

    await ingest([{ ...record, updated_at: '2026-10-18T10:00:00.000Z' }], []);

    const stored = await WeighmentModel.findOne({ slip_number: '202806' }).lean();
    expect(stored!.status).toBe('COMPLETED');
    expect((await getAnalytics(everything())).total_revenue).toBe(300);
  });

  it('lets a slip the BRIDGE voided be restored too', async () => {
    // No manager note exists for one voided at the window, so the second
    // weight decides what it goes back to.
    const record = completedWeighment({ slip_number: '202807', status: 'VOID' });
    await ingest([record], []);

    const restored = await restoreWeighmentBySlip('202807', 'admin');
    expect(restored.status).toBe('COMPLETED');
  });
});
