/**
 * The rate card the manager keeps, and every weighbridge pulls.
 *
 * `key` is what a weighment stores and never changes once made — renaming a
 * type must not orphan the records that already point at it. The label and the
 * rate are free to move, and history stays readable because each slip carries
 * the label it was printed with.
 */

import mongoose from 'mongoose';
import type { InferSchemaType, Model } from 'mongoose';

// Mongoose is CommonJS: Node's ESM interop does not expose every named
// export, so the runtime values come off the default export.
const { Schema, model, models } = mongoose;

const vehicleTypeSchema = new Schema(
  {
    /** Lower-case, underscore-separated. Permanent. */
    key: { type: String, required: true, unique: true },
    label: { type: String, required: true },
    /** Rupees. Zero means "the operator types the amount". */
    rate_pkr: { type: Number, required: true, default: 0, min: 0 },
    /** Removal travels rather than deletes, for the same reason customers do. */
    deleted_at: { type: Date, default: null },
    created_at: { type: Date, required: true, default: () => new Date() },
    updated_at: { type: Date, required: true, default: () => new Date() },
  },
  { timestamps: false, versionKey: false },
);

export type VehicleTypeDocument = InferSchemaType<typeof vehicleTypeSchema>;

export const VehicleTypeModel: Model<VehicleTypeDocument> =
  (models.VehicleType as Model<VehicleTypeDocument> | undefined) ??
  model<VehicleTypeDocument>('VehicleType', vehicleTypeSchema, 'vehicle_types');
