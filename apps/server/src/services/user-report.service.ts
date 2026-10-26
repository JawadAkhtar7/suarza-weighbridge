/**
 * What one person did, in the order they did it.
 *
 * Three sources, each recorded for its own reasons — the weighings they
 * saved, the money they wrote down, and the shift log — read back as one
 * story. The totals are counted here rather than stored anywhere: a stored
 * total is a total that can disagree with the records it came from, and the
 * whole value of a report is that it cannot.
 *
 * It replaced a screen that laid two shifts side by side and pronounced on
 * whether they balanced. That was arithmetic nobody had asked for, over
 * figures nobody had checked.
 */

import type { OperatorRole, ReportActivity, UserReport, UserReportQuery } from '@suarza/shared';
import { LogModel } from '../models/log.model.js';
import { ShiftCashModel } from '../models/shift-cash.model.js';
import { WeighmentModel } from '../models/weighment.model.js';
import { OperatorModel } from '../models/operator.model.js';

/**
 * How many lines one report will draw.
 *
 * A month at a busy bridge is thousands of weighings, and a page nobody can
 * scroll to the end of helps no one. The totals above the table are counted
 * over EVERYTHING in the period regardless — they are aggregates, not a sum
 * of what is listed — so a truncated report still adds up; it just says it
 * has been cut.
 */
const MAX_ACTIVITIES = 500;

/** A name as a Mongo match: exact, case-insensitive, nothing treated as a pattern. */
function sameName(name: string): { $regex: string; $options: string } {
  return { $regex: `^${name.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' };
}

export async function buildUserReport(query: UserReportQuery): Promise<UserReport> {
  const operator = query.operator.trim().toLowerCase();
  const from = new Date(query.from);
  const to = new Date(query.to);
  const window = { $gte: from, $lte: to };

  const account = await OperatorModel.findOne({ username: operator }).lean();

  const [totals, weighings, cash, mirrored, shiftLog, everyone] = await Promise.all([
    /*
     * The headline figures, over the whole period rather than over the
     * lines that fit. VOID is excluded here as everywhere else: a voided
     * ticket took no money, and counting it would read high by its amount.
     */
    WeighmentModel.aggregate<{ _id: null; weighments: number; takings: number }>([
      { $match: { operator_username: operator, status: { $ne: 'VOID' }, first_weight_at: window } },
      {
        $group: {
          _id: null,
          weighments: { $sum: 1 },
          takings: { $sum: '$amount_charged' },
        },
      },
    ]),

    WeighmentModel.find({
      operator_username: operator,
      status: { $ne: 'VOID' },
      first_weight_at: window,
    })
      .select({
        slip_number: 1,
        first_weight_at: 1,
        amount_charged: 1,
        vehicle_type: 1,
        vehicle_type_label: 1,
        vehicle_plate: 1,
      })
      .sort({ first_weight_at: 1 })
      .limit(MAX_ACTIVITIES)
      .lean(),

    ShiftCashModel.find({ operator, at: window }).sort({ at: 1 }).lean(),

    /*
     * The other side of somebody else's handover.
     *
     * A movement is written down by one of the two people it was between,
     * and the other one's report has to show it as well — the other way
     * round. Matched on the NAME, because that is what the person writing
     * it chose from the list; a bridge where somebody typed a nickname
     * instead will not match, which is the honest limit of matching on a
     * name rather than an account.
     */
    account?.name
      ? ShiftCashModel.find({
          operator: { $ne: operator },
          at: window,
          $or: [{ person_name: sameName(account.name) }, { manager_name: sameName(account.name) }],
        })
          .sort({ at: 1 })
          .lean()
      : Promise.resolve([]),

    LogModel.find({
      kind: { $in: ['SHIFT_START', 'SHIFT_END'] },
      actor: operator,
      at: window,
    })
      .sort({ at: 1 })
      .lean(),

    /* Usernames to names, so a mirrored line can say who recorded it. */
    OperatorModel.find().select({ username: 1, name: 1 }).lean(),
  ]);

  const nameFor = new Map(
    everyone
      .filter((person) => typeof person.username === 'string')
      .map((person) => [String(person.username).toLowerCase(), person.name]),
  );

  const activities: ReportActivity[] = [];

  for (const row of weighings) {
    activities.push({
      id: `w-${String(row._id)}`,
      kind: 'WEIGHMENT',
      at: new Date(row.first_weight_at).toISOString(),
      amount: row.amount_charged ?? 0,
      slip_number: row.slip_number,
      vehicle_type: row.vehicle_type ?? null,
      vehicle_type_label: row.vehicle_type_label || null,
      vehicle_plate: row.vehicle_plate ?? null,
      counterpart: null,
      detail: null,
      recorded_by: null,
    });
  }

  for (const entry of shiftLog) {
    activities.push({
      id: `s-${String(entry._id)}`,
      kind: entry.kind === 'SHIFT_END' ? 'SHIFT_END' : 'SHIFT_START',
      at: new Date(entry.at).toISOString(),
      amount: 0,
      slip_number: null,
      vehicle_type: null,
      vehicle_type_label: null,
      vehicle_plate: null,
      counterpart: null,
      /* "Shift lasted 7h 40m", as the bridge worked it out. */
      detail: entry.detail ?? null,
      recorded_by: null,
    });
  }

  /*
   * One movement can be up to four lines: money could pass both ways, with
   * a colleague and with the manager, in the same minute. Each direction is
   * its own line because each is its own fact.
   */
  let moneyTaken = 0;
  let moneyGiven = 0;

  for (const entry of cash) {
    const at = new Date(entry.at).toISOString();
    const pairs = [
      { taken: entry.person_taken ?? 0, given: entry.person_given ?? 0, who: entry.person_name },
      { taken: entry.manager_taken ?? 0, given: entry.manager_given ?? 0, who: entry.manager_name },
    ];

    for (const [index, pair] of pairs.entries()) {
      moneyTaken += pair.taken;
      moneyGiven += pair.given;

      for (const [kind, amount] of [
        ['MONEY_TAKEN', pair.taken],
        ['MONEY_GIVEN', pair.given],
      ] as const) {
        if (amount <= 0) continue;
        activities.push({
          id: `c-${String(entry._id)}-${index}-${kind}`,
          kind,
          at,
          amount,
          slip_number: null,
          vehicle_type: null,
          vehicle_type_label: null,
          vehicle_plate: null,
          counterpart: pair.who || null,
          detail: null,
          recorded_by: null,
        });
      }
    }
  }

  /*
   * The same again, from the other side.
   *
   * Somebody else wrote these down with this person's name on them, so the
   * directions swap: what they took from this person is money this person
   * GAVE. The amounts count towards the totals, because a handover that
   * happened is a handover that happened whoever typed it — and the line
   * says whose record it is, so a figure can always be traced.
   */
  if (account?.name) {
    const theirName = account.name.trim().toLowerCase();

    for (const entry of mirrored) {
      const at = new Date(entry.at).toISOString();
      const writtenBy = nameFor.get(String(entry.operator).toLowerCase()) ?? entry.operator;

      const pairs = [
        { taken: entry.person_taken ?? 0, given: entry.person_given ?? 0, who: entry.person_name },
        {
          taken: entry.manager_taken ?? 0,
          given: entry.manager_given ?? 0,
          who: entry.manager_name,
        },
      ];

      for (const [index, pair] of pairs.entries()) {
        /* Only the half of the entry that names this person: the other
           half was between the writer and somebody else entirely. */
        if ((pair.who ?? '').trim().toLowerCase() !== theirName) continue;

        /* They took from this person, so this person gave. */
        moneyGiven += pair.taken;
        moneyTaken += pair.given;

        for (const [kind, amount] of [
          ['MONEY_GIVEN', pair.taken],
          ['MONEY_TAKEN', pair.given],
        ] as const) {
          if (amount <= 0) continue;
          activities.push({
            id: `m-${String(entry._id)}-${index}-${kind}`,
            kind,
            at,
            amount,
            slip_number: null,
            vehicle_type: null,
            vehicle_type_label: null,
            vehicle_plate: null,
            counterpart: writtenBy,
            detail: null,
            recorded_by: writtenBy,
          });
        }
      }
    }
  }

  /* Oldest first, with a stable tiebreak so two things in the same second
     do not swap places between one reading of the report and the next. */
  activities.sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));

  const headline = totals[0] ?? { weighments: 0, takings: 0 };

  return {
    operator,
    operator_name: account?.name ?? operator,
    role: (account?.role as OperatorRole | undefined) ?? 'OPERATOR',
    from: from.toISOString(),
    to: to.toISOString(),

    weighments: headline.weighments,
    takings: headline.takings,
    money_taken: moneyTaken,
    money_given: moneyGiven,

    activities: activities.slice(0, MAX_ACTIVITIES),
    truncated: activities.length > MAX_ACTIVITIES || weighings.length >= MAX_ACTIVITIES,
  };
}

/** Exported for the tests, which assert the cap rather than guess at it. */
export const REPORT_ACTIVITY_LIMIT = MAX_ACTIVITIES;

/*
 * The activity ids are derived from the records rather than minted, so the
 * same report read twice numbers its lines the same way — which matters for
 * a page a manager may print, compare and print again.
 */
