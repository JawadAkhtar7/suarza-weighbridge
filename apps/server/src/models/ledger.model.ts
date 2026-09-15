/**
 * Ledger storage: one customer account, many entries.
 *
 * The balance is NOT stored on the customer. It is summed from the entries on
 * every read, because a cached total is a second source of truth that goes
 * wrong quietly — a failed write, a voided entry, a retried sync — and a
 * customer's balance being quietly wrong is the one failure this whole module
 * exists to prevent. At this scale (a few thousand entries per customer at
 * most) the aggregation is cheap and always right.
 */

import mongoose from 'mongoose';
import type { InferSchemaType, Model } from 'mongoose';

// Mongoose is CommonJS: Node's ESM interop does not expose every named
// export, so the runtime values come off the default export.
const { Schema, model, models } = mongoose;
import { LEDGER_DIRECTIONS, LEDGER_KINDS } from '@suarza/shared';

const ledgerCustomerSchema = new Schema(
  {
    /** `customerKey(name, company)` — derived, so the same person is one account. */
    _id: { type: String, required: true },
    name: { type: String, required: true },
    company: { type: String, default: '' },
    phone: { type: String, default: null },
    created_at: { type: Date, required: true, default: () => new Date() },
    updated_at: { type: Date, required: true, default: () => new Date() },
  },
  { timestamps: false, versionKey: false, _id: false },
);

// The list page sorts and searches on these.
ledgerCustomerSchema.index({ name: 1 });
ledgerCustomerSchema.index({ company: 1 });

export type LedgerCustomerDocument = InferSchemaType<typeof ledgerCustomerSchema>;

export const LedgerCustomerModel: Model<LedgerCustomerDocument> =
  (models.LedgerCustomer as Model<LedgerCustomerDocument> | undefined) ??
  model<LedgerCustomerDocument>('LedgerCustomer', ledgerCustomerSchema, 'ledger_customers');

const ledgerEntrySchema = new Schema(
  {
    _id: { type: String, required: true },
    customer_id: { type: String, required: true },
    direction: { type: String, required: true, enum: LEDGER_DIRECTIONS },
    kind: { type: String, required: true, enum: LEDGER_KINDS },
    /** Always positive; `direction` carries the sign. */
    amount_pkr: { type: Number, required: true, min: 0 },
    /** When it happened. Statements order by this, not by created_at. */
    at: { type: Date, required: true },
    note: { type: String, default: null },
    /**
     * Set on entries the system posted from a slip. A weighing paid at the gate
     * produces two — the charge and the payment that settled it — so the unique
     * key is (weighment_id, kind) rather than the id alone. That is what stops
     * a re-ingested batch, which happens on every sync retry, from charging a
     * customer twice for one slip.
     */
    weighment_id: { type: String, default: null },
    slip_number: { type: String, default: null },
    created_by: { type: String, required: true },
    created_at: { type: Date, required: true, default: () => new Date() },
    voided: { type: Boolean, required: true, default: false },
    voided_at: { type: Date, default: null },
    voided_by: { type: String, default: null },
    void_reason: { type: String, default: null },
  },
  { timestamps: false, versionKey: false, _id: false },
);

// The statement query: one customer's entries, oldest first.
ledgerEntrySchema.index({ customer_id: 1, at: 1 });
// One entry per weighment per kind. `sparse` so the many manual entries, which
// carry no weighment_id, do not all collide on null.
ledgerEntrySchema.index({ weighment_id: 1, kind: 1 }, { unique: true, sparse: true });

export type LedgerEntryDocument = InferSchemaType<typeof ledgerEntrySchema>;

export const LedgerEntryModel: Model<LedgerEntryDocument> =
  (models.LedgerEntry as Model<LedgerEntryDocument> | undefined) ??
  model<LedgerEntryDocument>('LedgerEntry', ledgerEntrySchema, 'ledger_entries');

/**
 * Brings the collection's indexes in line with the schema above.
 *
 * Mongoose creates new indexes on its own but never drops superseded ones, and
 * that silence is expensive here. This schema once carried a unique index on
 * `weighment_id` alone; when a paid weighing started posting two entries — the
 * charge and its settlement — the stale index rejected the second one with a
 * duplicate key error, so cash customers kept showing up as owing money. The
 * in-memory database used by the tests is built fresh from the current schema
 * every run, so nothing caught it.
 *
 * `syncIndexes` drops what the schema no longer declares. Safe at this scale,
 * and it runs at startup so a deployment cannot forget it.
 */
export async function syncLedgerIndexes(): Promise<void> {
  await Promise.all([LedgerEntryModel.syncIndexes(), LedgerCustomerModel.syncIndexes()]);
}
