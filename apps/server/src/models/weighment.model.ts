/**
 * Weighment document — the cloud mirror of the agent's SQLite row.
 *
 * `_id` is the record's UUID, taken straight from the agent. That single choice
 * is what makes ingest idempotent (brief §7.4): re-sending a batch after a
 * timeout upserts the same documents rather than duplicating them, with no
 * dedupe logic anywhere.
 */

import mongoose from 'mongoose';
import type { InferSchemaType, Model } from 'mongoose';

// Mongoose is CommonJS: Node's ESM interop does not expose every named
// export, so the runtime values come off the default export.
const { Schema, model, models } = mongoose;
import { VEHICLE_TYPES, WEIGHMENT_STATUSES, WEIGHT_SOURCES } from '@suarza/shared';

const weighmentSchema = new Schema(
  {
    _id: { type: String, required: true },
    slip_number: { type: String, required: true, unique: true },
    status: { type: String, required: true, enum: WEIGHMENT_STATUSES },
    station_id: { type: String, required: true },

    customer_name: { type: String, required: true },
    customer_company: { type: String, required: true },
    customer_phone: { type: String, default: null },
    vehicle_type: { type: String, required: true, enum: VEHICLE_TYPES },
    vehicle_plate: { type: String, required: true },
    container_number: { type: String, default: null },
    product: { type: String, required: true },

    first_weight_kg: { type: Number, required: true },
    first_weight_at: { type: Date, required: true },
    first_weight_src: { type: String, required: true, enum: WEIGHT_SOURCES },
    second_weight_kg: { type: Number, default: null },
    second_weight_at: { type: Date, default: null },
    second_weight_src: { type: String, default: null, enum: [...WEIGHT_SOURCES, null] },
    net_weight_kg: { type: Number, required: true, default: 0 },

    amount_charged: { type: Number, required: true, default: 0 },
    currency: { type: String, required: true, default: 'PKR' },

    operator_username: { type: String, required: true },
    created_at: { type: Date, required: true },
    updated_at: { type: Date, required: true },
    void_reason: { type: String, default: null },
    voided_at: { type: Date, default: null },

    /** When the cloud received it. Never used for reporting — see below. */
    synced_at: { type: Date, required: true, default: () => new Date() },
  },
  {
    // The agent owns the timestamps; Mongoose adding its own would invite
    // someone to report on them by mistake.
    timestamps: false,
    versionKey: false,
    _id: false,
  },
);

// Reports and filters run on first_weight_at — the real event time — so that a
// batch syncing after an outage doesn't collapse into one moment (brief §6).
weighmentSchema.index({ first_weight_at: -1 });
weighmentSchema.index({ status: 1, first_weight_at: -1 });
weighmentSchema.index({ customer_company: 1, first_weight_at: -1 });
weighmentSchema.index({ customer_name: 1, first_weight_at: -1 });
weighmentSchema.index({ vehicle_type: 1, first_weight_at: -1 });

export type WeighmentDocument = InferSchemaType<typeof weighmentSchema>;

// Reuse an already-registered model rather than redefining it. Mongoose keeps
// one global registry, and re-registering throws — which happens whenever this
// module is evaluated twice in a process (test files, or a dev hot reload).
export const WeighmentModel: Model<WeighmentDocument> =
  (models.Weighment as Model<WeighmentDocument> | undefined) ??
  model<WeighmentDocument>('Weighment', weighmentSchema, 'weighments');
