/**
 * Weighings the manager has voided from the dashboard, by id.
 *
 * The record itself stays — status VOID, with a reason and a time on it, in
 * the table and in the database as before. This holds only the id and what
 * the status was, and exists for one reason: the weighbridge keeps its own
 * copy and re-sends whenever one changes.
 *
 * WHY THAT MATTERS: the bridge's copy still says COMPLETED. Nothing re-sends
 * a record that has not changed, but plenty changes one — a reprint, a
 * correction — and ingest upserts by id. Without this, a slip voided in the
 * morning would come back as a live weighing the first time anything touched
 * it at the bridge, quietly counting itself back into the day's takings.
 *
 * `previous_status` is what un-voiding restores. Reading it off the record at
 * the time is the only way to know whether a slip was COMPLETED or still
 * OPEN when it was set aside — by then its own status says VOID and the
 * answer has been overwritten.
 */

import mongoose from 'mongoose';
import type { InferSchemaType, Model } from 'mongoose';
import { WEIGHMENT_STATUSES } from '@suarza/shared';

// Mongoose is CommonJS: Node's ESM interop does not expose every named
// export, so the runtime values come off the default export.
const { Schema, model, models } = mongoose;

const managerVoidSchema = new Schema(
  {
    /** The weighment's own id, as the agent minted it. */
    _id: { type: String, required: true },
    slip_number: { type: String, required: true },
    /** What it was before, so un-voiding puts back the right thing. */
    previous_status: { type: String, required: true, enum: [...WEIGHMENT_STATUSES] },
    /* Not required: a manager's reason is optional (the log already names
       who set the slip aside and when), and Mongoose counts '' as missing. */
    reason: { type: String, default: '' },
    voided_at: { type: Date, required: true, default: () => new Date() },
    voided_by: { type: String, required: true },
  },
  { timestamps: false, versionKey: false, _id: false },
);

managerVoidSchema.index({ slip_number: 1 });

export type ManagerVoidDocument = InferSchemaType<typeof managerVoidSchema>;

export const ManagerVoidModel: Model<ManagerVoidDocument> =
  (models.ManagerVoid as Model<ManagerVoidDocument> | undefined) ??
  model<ManagerVoidDocument>('ManagerVoid', managerVoidSchema, 'manager_voids');
