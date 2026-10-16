/**
 * Weighings the manager has deleted, by id.
 *
 * The record itself is gone — properly gone, from `weighments`, its audit
 * entries, its ledger entry and its photographs, files and all. This holds
 * only the id, so it cannot come back.
 *
 * WHY IT WOULD COME BACK: the weighbridge keeps its own copy and syncs on
 * `updated_at`. Nothing re-sends a record that has not changed, but plenty
 * changes one — a second weighing, a void, a reprint — and ingest upserts by
 * id. Without this, deleting a slip in the morning and reprinting it at the
 * bridge in the afternoon would put it straight back, with no indication to
 * anybody that it had ever gone.
 *
 * A dozen bytes a row against a record that cannot be undeleted, which is
 * what was asked for. The alternative — a `deleted_at` on the weighment
 * itself — keeps the whole record and leaves every query in three tiers to
 * remember to exclude it.
 */

import mongoose from 'mongoose';
import type { InferSchemaType, Model } from 'mongoose';

// Mongoose is CommonJS: Node's ESM interop does not expose every named
// export, so the runtime values come off the default export.
const { Schema, model, models } = mongoose;

const deletedWeighmentSchema = new Schema(
  {
    /** The weighment's own id, as the agent minted it. */
    _id: { type: String, required: true },
    slip_number: { type: String, required: true },
    deleted_at: { type: Date, required: true, default: () => new Date() },
    deleted_by: { type: String, required: true },
  },
  { timestamps: false, versionKey: false, _id: false },
);

deletedWeighmentSchema.index({ slip_number: 1 });

export type DeletedWeighmentDocument = InferSchemaType<typeof deletedWeighmentSchema>;

export const DeletedWeighmentModel: Model<DeletedWeighmentDocument> =
  (models.DeletedWeighment as Model<DeletedWeighmentDocument> | undefined) ??
  model<DeletedWeighmentDocument>('DeletedWeighment', deletedWeighmentSchema, 'deleted_weighments');
