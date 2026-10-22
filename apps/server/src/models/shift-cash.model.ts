/**
 * The money that changed hands during a shift.
 *
 * One document per handing-over, not one per shift: cash moves more than
 * twice in a day — the manager collects at noon, a colleague covers an hour,
 * the float is topped up — and a document per shift could only ever hold the
 * last thing that happened.
 *
 * Ids come from the weighbridge, which is what makes a batch delivered twice
 * record one movement. Nothing here is ever updated: a movement is a thing
 * that happened.
 */

import mongoose from 'mongoose';
import type { InferSchemaType, Model } from 'mongoose';
import { SHIFT_CASH_STAGES } from '@suarza/shared';

// Mongoose is CommonJS: Node's ESM interop does not expose every named
// export, so the runtime values come off the default export.
const { Schema, model, models } = mongoose;

const shiftCashSchema = new Schema(
  {
    _id: { type: String, required: true },
    /** The shift this belongs to, as the bridge numbered it. */
    session_id: { type: String, required: true },
    /** The operator who wrote it down. */
    operator: { type: String, required: true },
    stage: { type: String, required: true, enum: [...SHIFT_CASH_STAGES] },
    person_name: { type: String, default: '' },
    person_taken: { type: Number, default: 0 },
    person_given: { type: Number, default: 0 },
    manager_name: { type: String, default: '' },
    manager_taken: { type: Number, default: 0 },
    manager_given: { type: Number, default: 0 },
    at: { type: Date, required: true },
  },
  { timestamps: false, versionKey: false, _id: false },
);

// Read a shift at a time, oldest movement first.
shiftCashSchema.index({ session_id: 1, at: 1 });

export type ShiftCashDocument = InferSchemaType<typeof shiftCashSchema>;

export const ShiftCashModel: Model<ShiftCashDocument> =
  (models.ShiftCashEntry as Model<ShiftCashDocument> | undefined) ??
  model<ShiftCashDocument>('ShiftCashEntry', shiftCashSchema, 'shift_cash_entries');
