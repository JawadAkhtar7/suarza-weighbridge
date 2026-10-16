/**
 * The roster: who is on which shift, and when the shifts begin.
 *
 * Read together on every request that mentions a shift, because neither half
 * answers anything alone — a shift name without timings cannot be matched to a
 * weighing, and timings without names cannot be read back to a manager.
 */

import { newId, nowUtc, DEFAULT_SHIFT_START_MINUTES, SHIFTS } from '@suarza/shared';
import type { CreateOperatorInput, Operator, Roster, Shift, ShiftTimings } from '@suarza/shared';
import {
  OperatorModel,
  ShiftTimingsModel,
  SHIFT_TIMINGS_ID,
  type OperatorDocument,
} from '../models/operator.model.js';
import { ApiError } from '../errors.js';

function toDto(doc: OperatorDocument & { _id: string }): Operator {
  return {
    id: String(doc._id),
    name: doc.name,
    shift: doc.shift as Shift,
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
 * Put somebody on a shift, replacing whoever was on it.
 *
 * Replacing rather than refusing: a yard has one person per shift and the
 * manager's intent in naming a second is plainly that the first has left.
 * Making them delete the old one first would be a rule to explain rather than
 * a job to do.
 */
export async function setOperator(input: CreateOperatorInput): Promise<Operator> {
  const at = nowUtc();
  const existing = await OperatorModel.findOne({ shift: input.shift }).lean();

  if (existing) {
    await OperatorModel.updateOne(
      { _id: existing._id },
      { $set: { name: input.name, updated_at: new Date(at) } },
    );
    const updated = await OperatorModel.findById(existing._id).lean();
    return toDto(updated as OperatorDocument & { _id: string });
  }

  const doc = await OperatorModel.create({
    _id: newId(),
    name: input.name,
    shift: input.shift,
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
 * entry means.
 */
export async function operatorNamesByShift(): Promise<Record<Shift, string | null>> {
  const docs = await OperatorModel.find().lean();
  const out = Object.fromEntries(SHIFTS.map((shift) => [shift, null])) as Record<
    Shift,
    string | null
  >;
  for (const doc of docs) out[doc.shift as Shift] = doc.name;
  return out;
}
