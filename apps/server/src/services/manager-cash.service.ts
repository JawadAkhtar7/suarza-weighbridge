/**
 * The manager's own pocket.
 *
 * A manager is a party to the same handovers the operators write down — the
 * day's takings come in, a float goes out — so this is not a second ledger.
 * It is the one ledger read from the manager's side: every movement that
 * names them, whoever recorded it, plus the ones they record here.
 *
 * WHAT COUNTS AS "THEM" is two things, because a movement can arrive two
 * ways. One they wrote themselves, where they are the `operator`. One an
 * operator wrote naming them, where they are the counterpart — matched on
 * the name, which is what the person writing it chose or typed.
 *
 * Nothing is stored as a balance. `net` is counted from the movements every
 * time it is asked for, so a figure on the screen cannot drift from the
 * records behind it.
 */

import { newId, nowUtc } from '@suarza/shared';
import type { ManagerCashInput, ManagerPocket, ReportActivity } from '@suarza/shared';
import { ShiftCashModel, type ShiftCashDocument } from '../models/shift-cash.model.js';
import { OperatorModel } from '../models/operator.model.js';

/** A name as a Mongo match: exact, case-insensitive, nothing is a pattern. */
function sameName(name: string): { $regex: string; $options: string } {
  return { $regex: `^${name.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' };
}

/**
 * Who counts as "the manager".
 *
 * The signed-in dashboard user, AND every administrator account at the
 * bridge. The yard has one manager who both runs the office and works the
 * window under an admin account, so money handed to that account is money
 * handed to the manager — and a pocket that ignored it would be missing the
 * half of the takings that arrive at the bridge.
 */
interface Identities {
  usernames: Set<string>;
  names: Set<string>;
}

async function managerIdentities(who: ManagerIdentity): Promise<Identities> {
  const admins = await OperatorModel.find({ role: 'ADMIN' })
    .select({ username: 1, name: 1 })
    .lean();

  const usernames = new Set<string>([who.username.trim().toLowerCase()]);
  const names = new Set<string>();
  if (who.displayName.trim()) names.add(who.displayName.trim().toLowerCase());

  for (const admin of admins) {
    if (typeof admin.username === 'string') usernames.add(admin.username.toLowerCase());
    if (admin.name) names.add(admin.name.trim().toLowerCase());
  }

  return { usernames, names };
}

/** Everything the manager is a party to, however it was written down. */
function partyTo(who: Identities): Record<string, unknown> {
  const named = [...who.names].map((name) => sameName(name));

  return {
    $or: [
      { operator: { $in: [...who.usernames] } },
      ...named.map((match) => ({ person_name: match })),
      /* Entries from when the form asked about "the manager" separately. */
      ...named.map((match) => ({ manager_name: match })),
    ],
  };
}

/**
 * Which way the money went, from the manager's side.
 *
 * The same document reads in opposite directions depending on who wrote it:
 * an operator recording "took 4,000 from the manager" is money the MANAGER
 * gave. Getting this backwards would be a pocket that fills as it empties.
 */
function fromManagersSide(
  doc: ShiftCashDocument & { _id: string },
  who: Identities,
): { taken: number; given: number; counterpart: string; theirs: boolean } {
  const theirs = who.usernames.has(String(doc.operator).toLowerCase());

  if (theirs) {
    return {
      taken: (doc.person_taken ?? 0) + (doc.manager_taken ?? 0),
      given: (doc.person_given ?? 0) + (doc.manager_given ?? 0),
      counterpart: doc.person_name || doc.manager_name || '',
      theirs: true,
    };
  }

  const named = (value: string | null | undefined) =>
    who.names.has(
      String(value ?? '')
        .trim()
        .toLowerCase(),
    );

  /* Somebody else's record: their "taken" is the manager's "given". */
  let taken = 0;
  let given = 0;
  if (named(doc.person_name)) {
    given += doc.person_taken ?? 0;
    taken += doc.person_given ?? 0;
  }
  if (named(doc.manager_name)) {
    given += doc.manager_taken ?? 0;
    taken += doc.manager_given ?? 0;
  }

  return { taken, given, counterpart: doc.operator, theirs: false };
}

export interface ManagerIdentity {
  /** The signed-in manager's username, as their records carry it. */
  username: string;
  /** Their name, as an operator would have chosen it from a list. */
  displayName: string;
}

/** Write down a movement from the manager's own side. */
export async function recordManagerCash(
  who: ManagerIdentity,
  input: ManagerCashInput,
): Promise<void> {
  await ShiftCashModel.create({
    _id: newId(),
    /* No shift: a manager keeps no shift, and the id is what pairs a
       bridge's two log entries rather than anything this needs. */
    session_id: `manager:${who.username}`,
    operator: who.username,
    stage: 'START',
    person_name: input.person_name.trim(),
    person_taken: input.taken,
    person_given: input.given,
    manager_name: '',
    manager_taken: 0,
    manager_given: 0,
    at: new Date(nowUtc()),
  });
}

export async function managerPocket(
  who: ManagerIdentity,
  from: Date,
  to: Date,
): Promise<ManagerPocket> {
  const identities = await managerIdentities(who);
  const mine = partyTo(identities);

  const [everything, inRange] = await Promise.all([
    ShiftCashModel.find(mine).lean(),
    ShiftCashModel.find({ ...mine, at: { $gte: from, $lte: to } })
      .sort({ at: -1 })
      .lean(),
  ]);

  let allTaken = 0;
  let allGiven = 0;
  for (const doc of everything) {
    const side = fromManagersSide(doc as ShiftCashDocument & { _id: string }, identities);
    allTaken += side.taken;
    allGiven += side.given;
  }

  let rangeTaken = 0;
  let rangeGiven = 0;
  const movements: ReportActivity[] = [];

  for (const doc of inRange) {
    const entry = doc as ShiftCashDocument & { _id: string };
    const side = fromManagersSide(entry, identities);
    rangeTaken += side.taken;
    rangeGiven += side.given;

    const at = new Date(entry.at).toISOString();
    for (const [kind, amount] of [
      ['MONEY_TAKEN', side.taken],
      ['MONEY_GIVEN', side.given],
    ] as const) {
      if (amount <= 0) continue;
      movements.push({
        id: `${String(entry._id)}-${kind}`,
        kind,
        at,
        amount,
        slip_number: null,
        vehicle_type: null,
        vehicle_type_label: null,
        vehicle_plate: null,
        counterpart: side.counterpart || null,
        detail: null,
        /* Whose record it is, when it is not the manager's own. */
        recorded_by: side.theirs ? null : side.counterpart || null,
      });
    }
  }

  return {
    manager: who.username,
    manager_name: who.displayName,

    all_time_taken: allTaken,
    all_time_given: allGiven,
    all_time_net: allTaken - allGiven,

    from: from.toISOString(),
    to: to.toISOString(),
    range_taken: rangeTaken,
    range_given: rangeGiven,
    range_net: rangeTaken - rangeGiven,

    movements,
  };
}
