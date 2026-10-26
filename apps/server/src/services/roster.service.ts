/**
 * The people who may sign in at the weighbridge.
 *
 * A list of accounts the manager keeps: a name, a username, a password and
 * whether they may change how the station is set up. The bridge pulls them
 * down so a shift can start with the internet off — which is why the
 * credentials live here rather than with the manager accounts in `users`:
 * they open the weighing screen on one PC in the yard, not the dashboard.
 *
 * There are no shifts here any more. Which hours somebody works is not a
 * fact about their account: a weighing records when it happened, and the
 * shift is read off the clock (see `shiftAt`).
 */

import bcrypt from 'bcryptjs';
import { newId, nowUtc } from '@suarza/shared';
import type { Operator, OperatorRole, Roster, SaveOperatorInput } from '@suarza/shared';
import { OperatorModel, type OperatorDocument } from '../models/operator.model.js';
import { ApiError } from '../errors.js';

/** The same cost the manager accounts use; see auth.service.ts. */
const BCRYPT_ROUNDS = 10;

function toDto(doc: OperatorDocument & { _id: string }): Operator {
  return {
    id: String(doc._id),
    name: doc.name,
    role: (doc.role as OperatorRole | undefined) ?? 'OPERATOR',
    username: doc.username ?? null,
    has_password: Boolean(doc.password_hash),
    created_at: new Date(doc.created_at).toISOString(),
    updated_at: new Date(doc.updated_at).toISOString(),
  };
}

export async function listRoster(): Promise<Roster> {
  const docs = await OperatorModel.find().sort({ name: 1 }).lean();
  return { operators: docs.map((doc) => toDto(doc as OperatorDocument & { _id: string })) };
}

/**
 * Add somebody, or change them.
 *
 * One function for both, because the two differ in one thing — whether an
 * id came with the request — and splitting them would duplicate the username
 * check, the hashing and the shape of the answer.
 *
 * A password given is set; a password omitted leaves whatever was there.
 * That asymmetry is what lets a manager correct a spelling, or hand somebody
 * administrator access, without having to remember a password they set in
 * March.
 */
export async function saveOperator(input: SaveOperatorInput): Promise<Operator> {
  const at = nowUtc();
  const username = input.username.trim().toLowerCase();

  const clash = await OperatorModel.findOne({
    username,
    ...(input.id ? { _id: { $ne: input.id } } : {}),
  }).lean();
  if (clash) {
    throw new ApiError('VALIDATION_ERROR', `The username ${username} is already in use.`);
  }

  const passwordHash = input.password ? await bcrypt.hash(input.password, BCRYPT_ROUNDS) : null;

  if (input.id) {
    const existing = await OperatorModel.findById(input.id).lean();
    if (!existing) throw new ApiError('NOT_FOUND', 'No such person.');

    await OperatorModel.updateOne(
      { _id: input.id },
      {
        $set: {
          name: input.name,
          username,
          role: input.role,
          /* Only when the manager typed one — an edit that leaves the
             password box empty must not take away the one they have. */
          ...(passwordHash ? { password_hash: passwordHash } : {}),
          updated_at: new Date(at),
        },
      },
    );

    const updated = await OperatorModel.findById(input.id).lean();
    return toDto(updated as OperatorDocument & { _id: string });
  }

  if (!passwordHash) {
    // A new account with no password cannot sign in anywhere, and somebody
    // would have to be told why their new username does not work.
    throw new ApiError('VALIDATION_ERROR', 'Give this person a password.');
  }

  const doc = await OperatorModel.create({
    _id: newId(),
    name: input.name,
    username,
    role: input.role,
    password_hash: passwordHash,
    created_at: new Date(at),
    updated_at: new Date(at),
  });

  return toDto(doc.toObject() as OperatorDocument & { _id: string });
}

export async function removeOperator(id: string): Promise<void> {
  const result = await OperatorModel.deleteOne({ _id: id });
  if (result.deletedCount === 0) {
    throw new ApiError('NOT_FOUND', 'No operator with that id.');
  }
}

/**
 * Each account's name, by the username the records are stamped with.
 *
 * What a weighing carries is the username of whoever saved it; this is how
 * a screen turns that into a person.
 */
export async function operatorNamesByUsername(): Promise<Map<string, string>> {
  const docs = await OperatorModel.find().select({ username: 1, name: 1 }).lean();
  return new Map(
    docs
      .filter((doc) => typeof doc.username === 'string')
      .map((doc) => [String(doc.username).toLowerCase(), doc.name]),
  );
}

/**
 * The accounts a weighbridge needs to let somebody start a shift offline.
 *
 * The hash travels, not the password, and only down this route — which is
 * read with the ingest key, by a machine, over the same connection the
 * weighings go up. Accounts with no password are left out: there is nothing
 * to sign in with, and sending them would only invite the bridge to decide
 * what that means.
 */
export async function operatorAccountsForSync(): Promise<
  {
    username: string;
    name: string;
    role: OperatorRole;
    password_hash: string;
    updated_at: string;
  }[]
> {
  const docs = await OperatorModel.find({
    username: { $type: 'string' },
    password_hash: { $type: 'string' },
  }).lean();

  return docs.map((doc) => ({
    username: String(doc.username),
    name: doc.name,
    role: (doc.role as OperatorRole | undefined) ?? 'OPERATOR',
    password_hash: String(doc.password_hash),
    updated_at: new Date(doc.updated_at).toISOString(),
  }));
}
