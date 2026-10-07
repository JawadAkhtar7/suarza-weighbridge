/**
 * Camera stills: the index. The JPEGs themselves are files on the droplet.
 *
 * Deliberately not stored in Mongo. The cluster is a free M0 with 512 MB in
 * total, and a year of weighings is several gigabytes of pictures — it would
 * fill in a fortnight. The droplet's disk holds the bytes and this collection
 * holds the paths, which is also what makes a year's retention a directory
 * delete rather than a database sweep.
 */

import mongoose from 'mongoose';
import type { InferSchemaType, Model } from 'mongoose';

// Mongoose is CommonJS: the runtime values come off the default export.
const { Schema, model, models } = mongoose;

const captureSchema = new Schema(
  {
    /* The agent's own id for the picture, so an upload retried after a lost
       response replaces rather than duplicates. */
    _id: { type: String, required: true },
    weighment_id: { type: String, required: true },
    slip_number: { type: String, required: true },
    pass: { type: String, required: true, enum: ['FIRST', 'SECOND'] },
    view: { type: String, required: true, enum: ['FRONT', 'SIDE'] },
    /** Relative to the capture root, so moving the folder rewrites no rows. */
    path: { type: String, required: true },
    bytes: { type: Number, required: true },
    taken_at: { type: Date, required: true },
    received_at: { type: Date, required: true, default: () => new Date() },
  },
  { timestamps: false, versionKey: false, _id: false },
);

/* The slip asks "what pictures belong to this weighing" on every render of
   the public page, which is the one query that has to be quick. */
captureSchema.index({ weighment_id: 1, taken_at: 1 });
/* The retention sweep walks by age. */
captureSchema.index({ taken_at: 1 });

export type CaptureDocument = InferSchemaType<typeof captureSchema>;

export const CaptureModel: Model<CaptureDocument> =
  (models.Capture as Model<CaptureDocument> | undefined) ??
  model<CaptureDocument>('Capture', captureSchema, 'captures');
