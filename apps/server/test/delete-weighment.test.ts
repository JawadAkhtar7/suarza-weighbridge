/**
 * Deleting a weighing, and the one thing that is kept.
 *
 * Two questions worth testing and not obvious from reading the code: that
 * everything joined to the record really goes, and that the record cannot
 * walk back in the next time the weighbridge syncs — which it would, because
 * the bridge keeps its own copy and ingest upserts by id.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  clearDatabase,
  completedWeighment,
  auditEntry,
  startDatabase,
  stopDatabase,
} from './helpers.js';
import { ingest } from '../src/services/ingest.service.js';
import {
  deleteWeighmentBySlip,
  deletedIdsAmong,
} from '../src/services/delete-weighment.service.js';
import { WeighmentModel } from '../src/models/weighment.model.js';
import { AuditModel } from '../src/models/audit.model.js';
import { LedgerEntryModel } from '../src/models/ledger.model.js';
import { LedgerCustomerModel } from '../src/models/ledger.model.js';
import { getCustomer } from '../src/services/ledger.service.js';

beforeAll(startDatabase);
afterAll(stopDatabase);
afterEach(clearDatabase);

describe('deleting a weighing', () => {
  it('takes the record, its audit trail and its ledger entry with it', async () => {
    const record = completedWeighment({
      slip_number: '202701',
      amount_charged: 300,
      payment_status: 'ON_ACCOUNT',
    });
    await ingest([record], [auditEntry(record.id)]);

    // The charge reached the ledger, or the rest of this proves nothing.
    const account = await LedgerCustomerModel.findOne().lean();
    expect(account).not.toBeNull();
    expect((await getCustomer(String(account!._id))).balance_pkr).toBe(-300);

    const summary = await deleteWeighmentBySlip('202701', 'admin');

    expect(summary.slip_number).toBe('202701');
    expect(summary.audit_entries).toBeGreaterThan(0);
    expect(summary.ledger_entries).toBe(1);

    expect(await WeighmentModel.countDocuments({ slip_number: '202701' })).toBe(0);
    expect(await AuditModel.countDocuments({ weighment_id: record.id })).toBe(0);
    expect(await LedgerEntryModel.countDocuments({ weighment_id: record.id })).toBe(0);
  });

  it('undoes what it had done to the balance', async () => {
    /*
     * Nothing recomputes a stored total here, and that is the point: balances
     * are aggregated from the entries, so removing the entry IS removing its
     * effect. Worth pinning, because a cached balance somewhere would make
     * this quietly wrong.
     */
    const record = completedWeighment({ amount_charged: 500, payment_status: 'ON_ACCOUNT' });
    await ingest([record], []);

    const id = String((await LedgerCustomerModel.findOne().lean())!._id);
    expect((await getCustomer(id)).balance_pkr).toBe(-500);

    await deleteWeighmentBySlip(record.slip_number, 'admin');

    expect((await getCustomer(id)).balance_pkr).toBe(0);
  });

  it('refuses a slip it does not have', async () => {
    await expect(deleteWeighmentBySlip('2026999', 'admin')).rejects.toThrow(/no weighment/i);
  });
});

describe('a deleted weighing and the weighbridge', () => {
  it('does not come back when the bridge syncs it again', async () => {
    /*
     * The failure this guards against. The bridge re-sends a weighing
     * whenever it changes — a void, a reprint, a second weighing — and every
     * write is an upsert. Deleting a slip in the morning and reprinting it at
     * the bridge in the afternoon would otherwise put it straight back.
     */
    const record = completedWeighment({ slip_number: '202702' });
    await ingest([record], []);
    await deleteWeighmentBySlip('202702', 'admin');

    const result = await ingest(
      [{ ...record, updated_at: '2026-10-17T10:00:00.000Z' }],
      [auditEntry(record.id)],
    );

    expect(await WeighmentModel.countDocuments({ slip_number: '202702' })).toBe(0);
    // Accepted, not rejected: the agent must stop offering it. Rejecting would
    // have it retry this record for ever, and it is not wrong — it is gone.
    expect(result.accepted_ids).toContain(record.id);
    expect(result.rejected.map((r) => r.id)).not.toContain(record.id);
  });

  it('lets every other weighing in the same batch through', async () => {
    const gone = completedWeighment({ slip_number: '202703' });
    const kept = completedWeighment({ slip_number: '202704' });
    await ingest([gone], []);
    await deleteWeighmentBySlip('202703', 'admin');

    await ingest([{ ...gone, updated_at: '2026-10-17T10:00:00.000Z' }, kept], []);

    expect(await WeighmentModel.countDocuments({ slip_number: '202703' })).toBe(0);
    expect(await WeighmentModel.countDocuments({ slip_number: '202704' })).toBe(1);
  });

  it('knows which of a batch of ids have gone', async () => {
    const record = completedWeighment({ slip_number: '202705' });
    await ingest([record], []);
    await deleteWeighmentBySlip('202705', 'admin');

    const deleted = await deletedIdsAmong([record.id, 'never-existed']);
    expect([...deleted]).toEqual([record.id]);
    expect(await deletedIdsAmong([])).toEqual(new Set());
  });
});
