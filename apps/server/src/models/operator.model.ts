/**
 * The people who may sign in at a weighbridge.
 *
 * A plain list of accounts: a name, what they sign in with, and whether they
 * may change how the station is set up. The password is bcrypt, as every
 * other password in the cloud is, and the hash leaves this collection only
 * on the sync route the bridge reads with its ingest key.
 *
 * IT BEGAN AS A ROSTER of two shifts and an administrator, one person in
 * each, enforced by a unique index on the slot. The yard turned out to have
 * more people than slots — relief drivers, a third operator, somebody
 * covering a week — and which hours a person works is not a thing an account
 * should decide anyway: a weighing records when it happened and the shift is
 * read off the clock. The old `shift` column and its unique index are
 * retired in `migrateOperators`, which also gives every existing account the
 * role its slot implied.
 */

import mongoose from 'mongoose';
import type { InferSchemaType, Model } from 'mongoose';
import { OPERATOR_ROLES } from '@suarza/shared';

// Mongoose is CommonJS: Node's ESM interop does not expose every named
// export, so the runtime values come off the default export.
const { Schema, model, models } = mongoose;

const operatorSchema = new Schema(
  {
    _id: { type: String, required: true },
    name: { type: String, required: true, trim: true },
    role: { type: String, required: true, enum: [...OPERATOR_ROLES], default: 'OPERATOR' },
    /** Lowercased at the service. */
    username: { type: String, required: true },
    /** bcrypt. Never leaves the server except to the bridge, behind its key. */
    password_hash: { type: String, default: null },
    created_at: { type: Date, required: true, default: () => new Date() },
    updated_at: { type: Date, required: true, default: () => new Date() },
  },
  { timestamps: false, versionKey: false, _id: false },
);

operatorSchema.index({ username: 1 }, { unique: true });

export type OperatorDocument = InferSchemaType<typeof operatorSchema>;

export const OperatorModel: Model<OperatorDocument> =
  (models.Operator as Model<OperatorDocument> | undefined) ??
  model<OperatorDocument>('Operator', operatorSchema, 'operators');

/**
 * Retire the roster, once, on a database that still has one.
 *
 * Two things, both of which must happen before a second account can be
 * saved: the unique index on `shift` has to go — with the field gone from
 * the schema every new account would have no shift, and the second one would
 * collide with the first — and the accounts already there need the role
 * their slot implied.
 *
 * Safe to run on every boot: both steps are no-ops once they have happened.
 */
export async function migrateOperators(): Promise<void> {
  const collection = OperatorModel.collection;

  try {
    const indexes = await collection.indexes();
    if (indexes.some((index) => index.name === 'shift_1')) {
      await collection.dropIndex('shift_1');
    }
  } catch {
    // A collection that does not exist yet has no index to drop, and a
    // failure here must not stop the server from starting.
  }

  try {
    /* ADMIN kept its meaning; the two shift slots were operators. */
    await collection.updateMany(
      { shift: 'ADMIN' },
      { $set: { role: 'ADMIN' }, $unset: { shift: '' } },
    );
    await collection.updateMany(
      { shift: { $in: ['MORNING', 'NIGHT'] } },
      { $set: { role: 'OPERATOR' }, $unset: { shift: '' } },
    );
    /* An account with neither — written between the two deploys — is an
       ordinary operator. */
    await collection.updateMany({ role: { $exists: false } }, { $set: { role: 'OPERATOR' } });
  } catch {
    // Same: a fresh database has nothing to migrate.
  }
}
