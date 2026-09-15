/**
 * Audit entries (brief §6, §12). Append-only here too: the ingest route only
 * ever inserts, and nothing in the server updates or deletes one.
 */

import mongoose from 'mongoose';
import type { InferSchemaType, Model } from 'mongoose';

// Mongoose is CommonJS: Node's ESM interop does not expose every named
// export, so the runtime values come off the default export.
const { Schema, model, models } = mongoose;
import { AUDIT_ACTIONS } from '@suarza/shared';

const auditSchema = new Schema(
  {
    _id: { type: String, required: true },
    weighment_id: { type: String, required: true },
    action: { type: String, required: true, enum: AUDIT_ACTIONS },
    actor_username: { type: String, required: true },
    detail: { type: Schema.Types.Mixed, default: {} },
    at: { type: Date, required: true },
    synced_at: { type: Date, required: true, default: () => new Date() },
  },
  { timestamps: false, versionKey: false, _id: false },
);

auditSchema.index({ weighment_id: 1, at: 1 });
auditSchema.index({ at: -1 });

export type AuditDocument = InferSchemaType<typeof auditSchema>;

// Reuse an already-registered model rather than redefining it. Mongoose keeps
// one global registry, and re-registering throws — which happens whenever this
// module is evaluated twice in a process (test files, or a dev hot reload).
export const AuditModel: Model<AuditDocument> =
  (models.AuditEntry as Model<AuditDocument> | undefined) ??
  model<AuditDocument>('AuditEntry', auditSchema, 'audit_entries');
