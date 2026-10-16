/**
 * Who is on which shift, as the manager keeps it.
 *
 * NOT a login — see the Operator contract in @suarza/shared. The weighbridge
 * has one operator account, used by whoever is at the window; this is the
 * manager's note of who that was, so a shift's takings can be read against a
 * name.
 *
 * One person per shift, enforced by a unique index rather than by the code
 * that writes it. Two morning operators is not a state the yard has — and a
 * rule kept in the database is a rule a second writer cannot forget.
 */

import mongoose from 'mongoose';
import type { InferSchemaType, Model } from 'mongoose';
import { SHIFTS } from '@suarza/shared';

// Mongoose is CommonJS: Node's ESM interop does not expose every named
// export, so the runtime values come off the default export.
const { Schema, model, models } = mongoose;

const operatorSchema = new Schema(
  {
    _id: { type: String, required: true },
    name: { type: String, required: true, trim: true },
    shift: { type: String, required: true, enum: [...SHIFTS] },
    created_at: { type: Date, required: true, default: () => new Date() },
    updated_at: { type: Date, required: true, default: () => new Date() },
  },
  { timestamps: false, versionKey: false, _id: false },
);

operatorSchema.index({ shift: 1 }, { unique: true });

export type OperatorDocument = InferSchemaType<typeof operatorSchema>;

export const OperatorModel: Model<OperatorDocument> =
  (models.Operator as Model<OperatorDocument> | undefined) ??
  model<OperatorDocument>('Operator', operatorSchema, 'operators');

/**
 * When the two shifts begin, in one document.
 *
 * A single row with a fixed id rather than a key-value settings collection:
 * there is exactly one yard here, the two numbers are read together on every
 * request that mentions a shift, and a pair that can only be written together
 * cannot be left half-changed.
 */
const shiftTimingsSchema = new Schema(
  {
    _id: { type: String, required: true },
    /** Minutes from midnight, at the bridge's own clock. */
    morning_start_minutes: { type: Number, required: true, min: 0, max: 1439 },
    night_start_minutes: { type: Number, required: true, min: 0, max: 1439 },
    updated_at: { type: Date, required: true, default: () => new Date() },
  },
  { timestamps: false, versionKey: false, _id: false },
);

export type ShiftTimingsDocument = InferSchemaType<typeof shiftTimingsSchema>;

/** The one and only timings document. */
export const SHIFT_TIMINGS_ID = 'shift-timings';

export const ShiftTimingsModel: Model<ShiftTimingsDocument> =
  (models.ShiftTimings as Model<ShiftTimingsDocument> | undefined) ??
  model<ShiftTimingsDocument>('ShiftTimings', shiftTimingsSchema, 'shift_timings');
