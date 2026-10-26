/**
 * One person's account of a stretch of time.
 *
 * Built from three things that are each recorded for their own reasons — the
 * weighings they saved, the money they wrote down, and the shift log — and
 * added up here rather than stored anywhere. A stored total is a total that
 * can disagree with the records it came from, and the whole value of this
 * screen is that it cannot.
 *
 * It replaced a side-by-side view of two shifts that worked out what was
 * left over and said whether a shift balanced. That was arithmetic nobody
 * had asked for, over figures nobody had checked, laid out in a way the
 * client could not read at a glance. This answers plainer questions: how
 * many trucks, how much charged, what money came in and went out, and when.
 */

import { DISPLAY_TIMEZONE } from '@suarza/shared';
import type { OperatorRole, UserReport, UserReportQuery } from '@suarza/shared';
import { LogModel } from '../models/log.model.js';
import { ShiftCashModel, type ShiftCashDocument } from '../models/shift-cash.model.js';
import { toCashEntry } from './shift-cash.service.js';
import { WeighmentModel } from '../models/weighment.model.js';
import { OperatorModel } from '../models/operator.model.js';

/** A day's worth of weighings, as the report's table shows them. */
interface DayRow {
  _id: string;
  weighments: number;
  takings: number;
}

export async function buildUserReport(query: UserReportQuery): Promise<UserReport> {
  const operator = query.operator.trim().toLowerCase();
  const from = new Date(query.from);
  const to = new Date(query.to);
  const window = { $gte: from, $lte: to };

  const [account, days, cash, sessions] = await Promise.all([
    OperatorModel.findOne({ username: operator }).lean(),

    /*
     * Weighings by day, bucketed by the PAKISTAN day rather than the UTC
     * one — otherwise everything before five in the morning lands on the
     * previous line. VOID is excluded, as everywhere else: a voided ticket
     * took no money, and counting it would make every day it happened on
     * read high by exactly that amount.
     */
    WeighmentModel.aggregate<DayRow>([
      {
        $match: { operator_username: operator, status: { $ne: 'VOID' }, first_weight_at: window },
      },
      {
        $group: {
          _id: {
            $dateToString: {
              format: '%Y-%m-%d',
              date: '$first_weight_at',
              timezone: DISPLAY_TIMEZONE,
            },
          },
          weighments: { $sum: 1 },
          takings: { $sum: '$amount_charged' },
        },
      },
      { $sort: { _id: 1 } },
    ]),

    ShiftCashModel.find({ operator, at: window }).sort({ at: 1 }).lean(),

    /* When they were signed in. The end of a shift that began before this
       window is not this window's business; a report is about a stretch of
       time, not about everything that overlaps it. */
    LogModel.find({ kind: 'SHIFT_START', actor: operator, at: window }).sort({ at: 1 }).lean(),
  ]);

  const movements = cash.map((doc) => toCashEntry(doc as ShiftCashDocument & { _id: string }));

  const endBySession = new Map(
    (
      await LogModel.find({
        kind: 'SHIFT_END',
        session_id: { $in: sessions.map((start) => String(start.session_id)) },
      }).lean()
    ).map((end) => [String(end.session_id), end]),
  );

  return {
    operator,
    operator_name: account?.name ?? operator,
    role: (account?.role as OperatorRole | undefined) ?? 'OPERATOR',
    from: from.toISOString(),
    to: to.toISOString(),

    weighments: days.reduce((sum, day) => sum + day.weighments, 0),
    takings: days.reduce((sum, day) => sum + day.takings, 0),

    money_taken: movements.reduce((sum, m) => sum + m.person_taken + m.manager_taken, 0),
    money_given: movements.reduce((sum, m) => sum + m.person_given + m.manager_given, 0),
    movements,

    days: days.map((day) => ({
      date: day._id,
      weighments: day.weighments,
      takings: day.takings,
    })),

    sessions: sessions.map((start) => {
      const end = endBySession.get(String(start.session_id));
      return {
        started_at: new Date(start.at).toISOString(),
        ended_at: end ? new Date(end.at).toISOString() : null,
      };
    }),
  };
}
