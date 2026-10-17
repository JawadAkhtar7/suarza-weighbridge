/**
 * The roster: who is in which slot, when the shifts begin, and what the
 * people in them sign in to the weighbridge with.
 *
 * Read together on every request that mentions a shift, because neither half
 * answers anything alone — a shift name without timings cannot be matched to a
 * weighing, and timings without names cannot be read back to a manager.
 *
 * The credentials live here rather than with the manager accounts in `users`
 * because they are not manager accounts: they open the weighbridge screen on
 * one PC in the yard, not the dashboard, and the bridge pulls them down so a
 * shift can start with the internet off.
 */

import bcrypt from 'bcryptjs';
import { newId, nowUtc, DEFAULT_SHIFT_START_MINUTES, SHIFTS, shiftForSlot } from '@suarza/shared';
import type {
  CreateOperatorInput,
  Operator,
  OperatorSlot,
  Roster,
  Shift,
  ShiftTimings,
} from '@suarza/shared';
import {
  OperatorModel,
  ShiftTimingsModel,
  SHIFT_TIMINGS_ID,
  type OperatorDocument,
} from '../models/operator.model.js';
import { ApiError } from '../errors.js';

/** The same cost the manager accounts use; see auth.service.ts. */
const BCRYPT_ROUNDS = 10;

function toDto(doc: OperatorDocument & { _id: string }): Operator {
  // The column is named `shift` and holds the slot — see the model.
  const slot = doc.shift as OperatorSlot;
  return {
    id: String(doc._id),
    name: doc.name,
    slot,
    shift: shiftForSlot(slot),
    username: doc.username ?? null,
    has_password: Boolean(doc.password_hash),
    created_at: new Date(doc.created_at).toISOString(),
    updated_at: new Date(doc.updated_at).toISOString(),
  };
}

/** The configured start times, or the client's defaults until they are set. */
export async function shiftTimings(): Promise<ShiftTimings> {
  const doc = await ShiftTimingsModel.findById(SHIFT_TIMINGS_ID).lean();
  if (!doc) return { ...DEFAULT_SHIFT_START_MINUTES };

  return {
    MORNING: doc.morning_start_minutes,
    NIGHT: doc.night_start_minutes,
  };
}

export async function setShiftTimings(timings: ShiftTimings): Promise<ShiftTimings> {
  if (timings.MORNING === timings.NIGHT) {
    // Equal starts leave one shift nothing and the other the whole day, which
    // is not a roster so much as a way to make every filter answer the same.
    throw new ApiError('VALIDATION_ERROR', 'The two shifts cannot start at the same time.');
  }

  await ShiftTimingsModel.updateOne(
    { _id: SHIFT_TIMINGS_ID },
    {
      $set: {
        morning_start_minutes: timings.MORNING,
        night_start_minutes: timings.NIGHT,
        updated_at: new Date(),
      },
    },
    { upsert: true },
  );

  return timings;
}

export async function listRoster(): Promise<Roster> {
  const [docs, timings] = await Promise.all([
    OperatorModel.find().sort({ shift: 1 }).lean(),
    shiftTimings(),
  ]);

  return {
    operators: docs.map((doc) => toDto(doc as OperatorDocument & { _id: string })),
    shift_timings: timings,
  };
}

/**
 * Put somebody in a slot, replacing whoever was in it.
 *
 * Replacing rather than refusing: a yard has one person per shift and the
 * manager's intent in naming a second is plainly that the first has left.
 * Making them delete the old one first would be a rule to explain rather than
 * a job to do.
 *
 * A password given is set; a password omitted leaves whatever was there. That
 * asymmetry is what lets the manager correct a spelling without having to
 * remember a password they set in March.
 */
export async function setOperator(input: CreateOperatorInput): Promise<Operator> {
  const at = nowUtc();
  const username = input.username?.trim().toLowerCase() || null;

  if (username) {
    const clash = await OperatorModel.findOne({ username, shift: { $ne: input.slot } }).lean();
    if (clash) {
      throw new ApiError('VALIDATION_ERROR', `The username ${username} is already in use.`);
    }
  }

  // A password with no username to go with it cannot be signed in with, and
  // saying so here beats an operator finding out at the start of a shift.
  const existing = await OperatorModel.findOne({ shift: input.slot }).lean();
  if (input.password && !username && !existing?.username) {
    throw new ApiError('VALIDATION_ERROR', 'Give a username as well as a password.');
  }

  const passwordHash = input.password ? await bcrypt.hash(input.password, BCRYPT_ROUNDS) : null;

  if (existing) {
    await OperatorModel.updateOne(
      { _id: existing._id },
      {
        $set: {
          name: input.name,
          /* Only when the manager typed one: an edit that leaves the username
             box untouched must not unname the account the bridge knows. */
          ...(username !== null ? { username } : {}),
          ...(passwordHash ? { password_hash: passwordHash } : {}),
          updated_at: new Date(at),
        },
      },
    );
    const updated = await OperatorModel.findById(existing._id).lean();
    return toDto(updated as OperatorDocument & { _id: string });
  }

  const doc = await OperatorModel.create({
    _id: newId(),
    name: input.name,
    shift: input.slot,
    username,
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
 * The name on each shift, for labelling records.
 *
 * Every shift is present whether or not somebody is on it, so a caller can
 * say "Night shift" with no name rather than having to decide what a missing
 * entry means. The administrator is not a shift and is not here.
 */
export async function operatorNamesByShift(): Promise<Record<Shift, string | null>> {
  const docs = await OperatorModel.find().lean();
  const out = Object.fromEntries(SHIFTS.map((shift) => [shift, null])) as Record<
    Shift,
    string | null
  >;
  for (const doc of docs) {
    const shift = shiftForSlot(doc.shift as OperatorSlot);
    if (shift) out[shift] = doc.name;
  }
  return out;
}

/**
 * Each account's name, by the username the records are stamped with.
 *
 * The roster says who is on a shift NOW; this says who actually saved a
 * given weighing. Since the operators sign in at the bridge, the record
 * carries their username, and that is a better answer than the roster for
 * any weighing older than the last rota change.
 */
export async function operatorNamesByUsername(): Promise<Map<string, string>> {
  const docs = await OperatorModel.find({ username: { $type: 'string' } })
    .select({ username: 1, name: 1 })
    .lean();
  return new Map(docs.map((doc) => [String(doc.username).toLowerCase(), doc.name]));
}

/**
 * The accounts a weighbridge needs to let somebody start a shift offline.
 *
 * The hash travels, not the password, and only down this route — which is
 * read with the ingest key, by a machine, over the same connection the
 * weighings go up. Slots with no credentials are left out: there is nothing
 * to sign in with, and sending them would only invite the bridge to decide
 * what a passwordless account means.
 */
export async function operatorAccountsForSync(): Promise<
  {
    username: string;
    name: string;
    slot: OperatorSlot;
    password_hash: string;
    updated_at: string;
  }[]
> {
  const docs = await OperatorModel.find({
    username: { $type: 'string' },
    password_hash: { $type: 'string' },
  }).lean();

  return docs.map((doc) => ({
    username: doc.username as string,
    name: doc.name,
    slot: doc.shift as OperatorSlot,
    password_hash: doc.password_hash as string,
    updated_at: new Date(doc.updated_at).toISOString(),
  }));
}
