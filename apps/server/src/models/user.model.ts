/**
 * Manager/admin users (brief §6, §10).
 *
 * No registration — the list is seeded from `@suarza/shared` on boot and stored
 * hashed even for the dummy accounts, so nothing changes structurally when real
 * credentials replace them.
 */

import mongoose from 'mongoose';
import type { InferSchemaType, Model } from 'mongoose';

// Mongoose is CommonJS: Node's ESM interop does not expose every named
// export, so the runtime values come off the default export.
const { Schema, model, models } = mongoose;
import { USER_ROLES } from '@suarza/shared';

const userSchema = new Schema(
  {
    username: { type: String, required: true, unique: true },
    password_hash: { type: String, required: true },
    display_name: { type: String, required: true },
    role: { type: String, required: true, enum: USER_ROLES },
    created_at: { type: Date, required: true, default: () => new Date() },
  },
  { timestamps: false, versionKey: false },
);

export type UserDocument = InferSchemaType<typeof userSchema>;

// Reuse an already-registered model rather than redefining it. Mongoose keeps
// one global registry, and re-registering throws — which happens whenever this
// module is evaluated twice in a process (test files, or a dev hot reload).
export const UserModel: Model<UserDocument> =
  (models.User as Model<UserDocument> | undefined) ??
  model<UserDocument>('User', userSchema, 'users');
