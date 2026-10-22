/**
 * One day's shifts, with the money each one took and gave at its two ends.
 *
 * Assembled rather than stored, from three things that are each recorded for
 * their own reasons — the two log entries the bridge writes, and the
 * weighings themselves. Nothing here is a second copy of a figure that lives
 * somewhere else: a stored total is a total that can disagree with the
 * records it came from.
 *
 * A day, not a page. The screen shows the morning beside the night, which is
 * a question about a day; the window arrives as two instants because the
 * manager's own clock decides where a Pakistan day begins.
 */

import type {
  ShiftAudit,
  ShiftAuditPage,
  ShiftAuditQuery,
  ShiftCashEntry,
  ShiftCashPush,
  ShiftCashStage,
} from '@suarza/shared';
import type { OperatorSlot } from '@suarza/shared';
import { LogModel } from '../models/log.model.js';
import { ShiftCashModel, type ShiftCashDocument } from '../models/shift-cash.model.js';
import { WeighmentModel } from '../models/weighment.model.js';

/** How many shifts one window may return. A day has two; this is a fuse. */
const MAX_SHIFTS = 50;

function toEntry(doc: ShiftCashDocument & { _id: string }): ShiftCashEntry {
  return {
    id: String(doc._id),
    session_id: doc.session_id,
    stage: doc.stage as ShiftCashStage,
    at: new Date(doc.at).toISOString(),
    person_name: doc.person_name ?? '',
    person_taken: doc.person_taken ?? 0,
    person_given: doc.person_given ?? 0,
    manager_name: doc.manager_name ?? '',
    manager_taken: doc.manager_taken ?? 0,
    manager_given: doc.manager_given ?? 0,
  };
}

/**
 * Take in the movements a bridge has pushed up.
 *
 * `$setOnInsert` throughout: a movement is a thing that happened, and the
 * second delivery of a batch must leave the first exactly as it was.
 */
export async function recordShiftCash(entries: ShiftCashPush['entries']): Promise<number> {
  for (const entry of entries) {
    await ShiftCashModel.updateOne(
      { _id: entry.id },
      {
        $setOnInsert: {
          session_id: entry.session_id,
          operator: entry.operator,
          stage: entry.stage,
          person_name: entry.person_name,
          person_taken: entry.person_taken,
          person_given: entry.person_given,
          manager_name: entry.manager_name,
          manager_taken: entry.manager_taken,
          manager_given: entry.manager_given,
          at: new Date(entry.at),
        },
      },
      { upsert: true },
    );
  }
  return entries.length;
}

export async function listShiftAudit(query: ShiftAuditQuery): Promise<ShiftAuditPage> {
  /*
   * Shifts that BEGAN in the window.
   *
   * A night shift runs past midnight, and filing it under the day it ended
   * would put the same night on two screens and under the morning that
   * followed it. The day a shift began is the day the yard calls it.
   */
  const at: Record<string, Date> = {};
  if (query.from) at.$gte = new Date(query.from);
  if (query.to) at.$lte = new Date(query.to);

  /* Newest first: the shift a manager opens this screen for is nearly always
     the one that just happened. */
  const starts = await LogModel.find({
    kind: 'SHIFT_START',
    session_id: { $type: 'string' },
    ...(query.from || query.to ? { at } : {}),
  })
    .sort({ at: -1 })
    .limit(MAX_SHIFTS)
    .lean();

  if (starts.length === 0) return { rows: [] };

  const sessionIds = starts.map((start) => String(start.session_id));
  const [ends, cash] = await Promise.all([
    LogModel.find({ kind: 'SHIFT_END', session_id: { $in: sessionIds } }).lean(),
    ShiftCashModel.find({ session_id: { $in: sessionIds } })
      .sort({ at: 1 })
      .lean(),
  ]);
  const endBySession = new Map(ends.map((end) => [String(end.session_id), end]));

  const cashBySession = new Map<string, ShiftCashEntry[]>();
  for (const doc of cash) {
    const entry = toEntry(doc as ShiftCashDocument & { _id: string });
    const kept = cashBySession.get(entry.session_id) ?? [];
    kept.push(entry);
    cashBySession.set(entry.session_id, kept);
  }

  /*
   * What each shift weighed, in one query rather than one per shift.
   *
   * Matched on the operator AND the window, because the same person works
   * again tomorrow and the same hour belongs to somebody else's shift. A
   * shift still running is open-ended, so its window runs to now.
   *
   * VOID is excluded here as everywhere else: a voided ticket took no money.
   */
  const windows = starts.map((start) => ({
    session: String(start.session_id),
    actor: start.actor,
    from: new Date(start.at),
    to: new Date(endBySession.get(String(start.session_id))?.at ?? Date.now()),
  }));

  const counted = await WeighmentModel.aggregate<{
    _id: null;
    rows: { operator_username: string; first_weight_at: Date; amount_charged: number }[];
  }>([
    {
      $match: {
        status: { $ne: 'VOID' },
        $or: windows.map((window) => ({
          operator_username: window.actor,
          first_weight_at: { $gte: window.from, $lte: window.to },
        })),
      },
    },
    { $project: { operator_username: 1, first_weight_at: 1, amount_charged: 1, _id: 0 } },
    { $group: { _id: null, rows: { $push: '$$ROOT' } } },
  ]);

  const weighings = counted[0]?.rows ?? [];

  const rows: ShiftAudit[] = windows.map((window) => {
    const start = starts.find((candidate) => String(candidate.session_id) === window.session)!;
    const end = endBySession.get(window.session) ?? null;

    /* Two operators' windows overlap all the time — a night shift running
       past eight while the morning signs in — so each weighing is tested
       against this window rather than divided up by time alone. */
    const mine = weighings.filter(
      (row) =>
        row.operator_username === window.actor &&
        new Date(row.first_weight_at) >= window.from &&
        new Date(row.first_weight_at) <= window.to,
    );

    return {
      session_id: window.session,
      operator: start.actor,
      operator_name: start.actor_name || start.actor,
      slot: (start.slot as OperatorSlot | null) ?? 'MORNING',
      started_at: new Date(start.at).toISOString(),
      ended_at: end ? new Date(end.at).toISOString() : null,
      cash_entries: cashBySession.get(window.session) ?? [],
      weighments: mine.length,
      takings: mine.reduce((sum, row) => sum + (row.amount_charged ?? 0), 0),
    };
  });

  return { rows };
}
