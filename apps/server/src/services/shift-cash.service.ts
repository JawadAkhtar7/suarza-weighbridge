/**
 * Taking in the money a bridge has written down.
 *
 * One document per handing-over, with the id the bridge gave it — which is
 * what makes a batch delivered twice record one movement. Nothing here is
 * ever updated: a movement is a thing that happened.
 */

import type { ShiftCashEntry, ShiftCashPush } from '@suarza/shared';
import { ShiftCashModel, type ShiftCashDocument } from '../models/shift-cash.model.js';

export function toCashEntry(doc: ShiftCashDocument & { _id: string }): ShiftCashEntry {
  return {
    id: String(doc._id),
    session_id: doc.session_id,
    stage: doc.stage as ShiftCashEntry['stage'],
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
 * `$setOnInsert` throughout: the second delivery of a batch must leave the
 * first exactly as it was.
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
