/**
 * Who is on which shift, as the manager keeps it — and what they sign in with.
 *
 * It began as a note of names and became the yard's accounts: the manager
 * sets a username and password here, the bridge pulls them down, and the
 * operator starts their shift with them. The password is bcrypt, as every
 * other password in the cloud is, and the hash leaves this collection only
 * on the sync route the bridge reads with its ingest key.
 *
 * One person per slot, enforced by a unique index rather than by the code
 * that writes it. Two morning operators is not a state the yard has — and a
 * rule kept in the database is a rule a second writer cannot forget.
 *
 * THE `shift` COLUMN HOLDS THE SLOT, which is MORNING, NIGHT or ADMIN. The
 * administrator joined the roster after the column was named and works no
 * particular shift; renaming the column would have meant migrating a
 * collection in production to gain a better word for the same thing.
 */

import mongoose from 'mongoose';
import type { InferSchemaType, Model } from 'mongoose';
import { OPERATOR_SLOTS } from '@suarza/shared';

// Mongoose is CommonJS: Node's ESM interop does not expose every named
// export, so the runtime values come off the default export.
const { Schema, model, models } = mongoose;

const operatorSchema = new Schema(
  {
    _id: { type: String, required: true },
    name: { type: String, required: true, trim: true },
    shift: { type: String, required: true, enum: [...OPERATOR_SLOTS] },
    /** Lowercased at the service; null for a slot with no login yet. */
    username: { type: String, default: null },
    /** bcrypt. Never leaves the server except to the bridge, behind its key. */
    password_hash: { type: String, default: null },
    created_at: { type: Date, required: true, default: () => new Date() },
    updated_at: { type: Date, required: true, default: () => new Date() },
  },
  { timestamps: false, versionKey: false, _id: false },
);

operatorSchema.index({ shift: 1 }, { unique: true });
/* Partial rather than sparse: two slots with no username yet are normal, and
   a plain unique index would let only one of them exist. */
operatorSchema.index(
  { username: 1 },
  { unique: true, partialFilterExpression: { username: { $type: 'string' } } },
);

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
