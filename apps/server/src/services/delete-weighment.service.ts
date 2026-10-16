/**
 * Deleting a weighing, and everything joined to it.
 *
 * A real deletion, as asked for: the record goes from `weighments`, its audit
 * entries go, its ledger entry goes, and its photographs go with their files.
 * Nothing is left flagged as hidden for every query in three tiers to
 * remember to exclude.
 *
 * ONE THING IS KEPT, and it is the id. The weighbridge has its own copy of
 * every weighing and syncs whenever one changes — a second weighing, a void,
 * a reprint — and ingest upserts by id. Without a note that this id was
 * deleted, a slip deleted in the morning and reprinted at the bridge in the
 * afternoon would quietly reappear. See the DeletedWeighment model.
 *
 * The ledger needs no recomputing: balances are aggregated from the entries
 * rather than stored on the customer, so removing the entry is the whole of
 * removing its effect.
 */

import { nowUtc } from '@suarza/shared';
import { WeighmentModel } from '../models/weighment.model.js';
import { AuditModel } from '../models/audit.model.js';
import { LedgerEntryModel } from '../models/ledger.model.js';
import { DeletedWeighmentModel } from '../models/deleted-weighment.model.js';
import { removeCapturesFor } from './capture.service.js';
import { ApiError } from '../errors.js';

export interface DeletionSummary {
  slip_number: string;
  audit_entries: number;
  ledger_entries: number;
  photographs: number;
}

/**
 * Delete one weighing by slip number.
 *
 * The tombstone is written FIRST, before anything is removed. A sync landing
 * mid-deletion would otherwise re-add the weighment behind us and leave a
 * record with none of its audit trail, which is worse than either outcome;
 * written first, an interrupted deletion leaves a record that is partly gone
 * and certainly not coming back, and running it again finishes the job.
 */
export async function deleteWeighmentBySlip(
  slipNumber: string,
  deletedBy: string,
): Promise<DeletionSummary> {
  const slip = slipNumber.trim().toUpperCase();
  const weighment = await WeighmentModel.findOne({ slip_number: slip }).lean();
  if (!weighment) throw new ApiError('NOT_FOUND', `No weighment for slip ${slip}.`);

  const id = String(weighment._id);

  await DeletedWeighmentModel.updateOne(
    { _id: id },
    { $set: { slip_number: slip, deleted_at: new Date(nowUtc()), deleted_by: deletedBy } },
    { upsert: true },
  );

  const photographs = await removeCapturesFor(id);
  const [audit, ledger] = await Promise.all([
    AuditModel.deleteMany({ weighment_id: id }),
    LedgerEntryModel.deleteMany({ weighment_id: id }),
  ]);

  await WeighmentModel.deleteOne({ _id: id });

  return {
    slip_number: slip,
    audit_entries: audit.deletedCount ?? 0,
    ledger_entries: ledger.deletedCount ?? 0,
    photographs,
  };
}

/**
 * Which of these ids have been deleted, so ingest can refuse to re-add them.
 *
 * A set rather than a check per record: a batch carries up to two hundred
 * weighings and this is one query for the lot.
 */
export async function deletedIdsAmong(ids: readonly string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await DeletedWeighmentModel.find({ _id: { $in: [...ids] } })
    .select({ _id: 1 })
    .lean();
  return new Set(rows.map((row) => String(row._id)));
}
