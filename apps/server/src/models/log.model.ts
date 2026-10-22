/**
 * The log: who was on the bridge, and which slips were set aside.
 *
 * Append-only, like the audit entries beside it, but a different thing and
 * deliberately a separate collection. An audit entry is about one weighment
 * and is keyed to it; these are about people and actions, and the two the
 * manager asked for first — a shift starting, a slip being voided — have no
 * weighment in common to file them under.
 *
 * Ids are supplied by the writer. A shift event is written on the weighbridge
 * PC and pushed up later, possibly twice if a batch half-lands, and an id it
 * chose itself is what makes the second delivery a no-op.
 */

import mongoose from 'mongoose';
import type { InferSchemaType, Model } from 'mongoose';
import { LOG_KINDS, OPERATOR_SLOTS } from '@suarza/shared';

// Mongoose is CommonJS: Node's ESM interop does not expose every named
// export, so the runtime values come off the default export.
const { Schema, model, models } = mongoose;

const logSchema = new Schema(
  {
    _id: { type: String, required: true },
    kind: { type: String, required: true, enum: [...LOG_KINDS] },
    at: { type: Date, required: true },
    actor: { type: String, required: true },
    actor_name: { type: String, required: true, default: '' },
    slot: { type: String, default: null, enum: [...OPERATOR_SLOTS, null] },
    /** The slip number, for the two weighment kinds. */
    subject: { type: String, default: null },
    detail: { type: String, default: null },
    /**
     * Both entries of one shift carry this; null for everything else.
     *
     * The money is NOT here: it is its own collection, because cash changes
     * hands more than twice in a day. See ShiftCashModel.
     */
    session_id: { type: String, default: null },
  },
  { timestamps: false, versionKey: false, _id: false },
);

// The log is read newest-first and nothing else; one index covers the page
// and the per-kind filter both.
logSchema.index({ at: -1 });
logSchema.index({ kind: 1, at: -1 });
/* The audit screen reads a shift's two entries together. */
logSchema.index({ session_id: 1 });

export type LogDocument = InferSchemaType<typeof logSchema>;

export const LogModel: Model<LogDocument> =
  (models.LogEntry as Model<LogDocument> | undefined) ??
  model<LogDocument>('LogEntry', logSchema, 'log_entries');
