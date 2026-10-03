/**
 * What each weighbridge station tells the cloud about itself (brief §8, §14).
 *
 * The operator edits these in the agent's Settings screen, and they arrive here
 * with the sync batches. The cloud keeps them so the public receipt page and
 * the PDF behind the QR code show exactly what the printed slip shows — the
 * alternative, configuring the same address twice, guarantees the two drift and
 * the page behind a QR code is drawn for different paper than the slip.
 */

import mongoose from 'mongoose';
import type { InferSchemaType, Model } from 'mongoose';

// Mongoose is CommonJS: Node's ESM interop does not expose every named
// export, so the runtime values come off the default export.
const { Schema, model, models } = mongoose;

const stationSchema = new Schema(
  {
    /** The station id, e.g. `A`. One document per weighbridge. */
    _id: { type: String, required: true },
    /* The company's details are no longer a station fact: they are the
       same everywhere and live in code. Documents written before that
       may still carry the old fields; nothing reads them. */
    /** What this station prints on; the downloaded PDF follows it. */
    paper_size: { type: String, enum: ['A4', 'A5', 'LETTER'], default: 'A5' },
    /** The station's own edit time, used to ignore a stale batch. */
    updated_at: { type: Date, required: true },
    synced_at: { type: Date, required: true, default: () => new Date() },
  },
  { timestamps: false, versionKey: false, _id: false },
);

export type StationDocument = InferSchemaType<typeof stationSchema>;

// Reuse an already-registered model rather than redefining it. Mongoose keeps
// one global registry, and re-registering throws — which happens whenever this
// module is evaluated twice in a process (test files, or a dev hot reload).
export const StationModel: Model<StationDocument> =
  (models.Station as Model<StationDocument> | undefined) ??
  model<StationDocument>('Station', stationSchema, 'stations');
