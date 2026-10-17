/**
 * Setting a weighing aside, and bringing it back.
 *
 * A voided weighing stays — in the table, in the statement, in the database.
 * What it stops doing is counting: it is out of the revenue, out of the
 * analytics, and its ledger charge is voided so the customer's balance no
 * longer carries it. Deleting was built first and replaced at the client's
 * request, for the reason that usually wins: a record that was wrong is
 * itself a thing worth being able to look at.
 *
 * Almost all of the counting was already right. Analytics has excluded VOID
 * since the brief, and the ledger already follows a weighment's status in
 * both directions — a voided slip voids its charge, an un-voided one brings
 * it back. So this does two things: it moves the status, and it re-posts the
 * charges so the ledger catches up at once rather than at the next sync.
 *
 * ONE THING IS REMEMBERED beyond the record: that the manager was the one who
 * voided it. The bridge's copy still says COMPLETED and re-sends whenever
 * anything touches it, so without that note a slip voided here would quietly
 * come back as a live weighing. See the ManagerVoid model.
 */

import { nowUtc, type Weighment, type WeighmentStatus } from '@suarza/shared';
import { recordLog } from './log.service.js';
import { WeighmentModel, type WeighmentDocument } from '../models/weighment.model.js';
import { ManagerVoidModel } from '../models/manager-void.model.js';
import { postWeighmentCharges } from './ledger.service.js';
import { toDto } from './weighment.service.js';
import { ApiError } from '../errors.js';

/** What a slip goes back to when it is restored, if nothing says otherwise. */
function statusWithoutVoid(weighment: { second_weight_kg?: number | null }): WeighmentStatus {
  return weighment.second_weight_kg === null || weighment.second_weight_kg === undefined
    ? 'OPEN'
    : 'COMPLETED';
}

export async function voidWeighmentBySlip(
  slipNumber: string,
  reason: string,
  actor: string,
): Promise<Weighment> {
  const slip = slipNumber.trim().toUpperCase();
  const doc = await WeighmentModel.findOne({ slip_number: slip });
  if (!doc) throw new ApiError('NOT_FOUND', `No weighment for slip ${slip}.`);
  if (doc.status === 'VOID') {
    throw new ApiError('VALIDATION_ERROR', `Slip ${slip} is already voided.`);
  }

  const at = new Date(nowUtc());
  const previous = doc.status as WeighmentStatus;

  doc.status = 'VOID';
  /* Empty means none given — the column is nullable and the slip should not
     show an empty "Voided:" line on the statement. */
  doc.void_reason = reason || null;
  doc.voided_at = at;
  doc.updated_at = at;
  await doc.save();

  /*
   * Written after the record, not before.
   *
   * Unlike a deletion, a void that half-happened is harmless: the status is
   * the thing that counts, and a note saying "the manager voided this" about
   * a record that is already VOID changes nothing. Writing it first would
   * instead leave a live weighing marked as manager-voided if the save
   * failed, which reads as a bug the next time anything syncs.
   */
  await ManagerVoidModel.updateOne(
    { _id: String(doc._id) },
    {
      $set: {
        slip_number: slip,
        previous_status: previous,
        reason: reason || '',
        voided_at: at,
        voided_by: actor,
      },
    },
    { upsert: true },
  );

  const dto = toDto(doc.toObject() as WeighmentDocument & { _id: string });
  // At once rather than at the next sync: a manager who voids a slip and
  // looks at the ledger expects the charge to have gone from it.
  await postWeighmentCharges([dto]);

  await recordLog({
    kind: 'WEIGHMENT_VOID',
    actor,
    at,
    subject: slip,
    detail: reason || null,
  });

  return dto;
}

export async function restoreWeighmentBySlip(
  slipNumber: string,
  actor: string,
): Promise<Weighment> {
  const slip = slipNumber.trim().toUpperCase();
  const doc = await WeighmentModel.findOne({ slip_number: slip });
  if (!doc) throw new ApiError('NOT_FOUND', `No weighment for slip ${slip}.`);
  if (doc.status !== 'VOID') {
    throw new ApiError('VALIDATION_ERROR', `Slip ${slip} is not voided.`);
  }

  const note = await ManagerVoidModel.findById(String(doc._id)).lean();

  const at = new Date(nowUtc());
  /*
   * Back to what it was, or to what the figures say it must be.
   *
   * The note is the better answer and is there whenever the manager did the
   * voiding. A slip voided at the BRIDGE has no note, and then the second
   * weight decides: a weighing with both figures is complete, one without is
   * still open. Either way this cannot put back a status the record could
   * not support.
   */
  doc.status = (note?.previous_status as WeighmentStatus | undefined) ?? statusWithoutVoid(doc);
  doc.void_reason = null;
  doc.voided_at = null;
  doc.updated_at = at;
  await doc.save();

  await ManagerVoidModel.deleteOne({ _id: String(doc._id) });

  const dto = toDto(doc.toObject() as WeighmentDocument & { _id: string });
  // The ledger un-voids the charge it had voided; see postWeighmentCharges.
  await postWeighmentCharges([dto]);

  await recordLog({
    kind: 'WEIGHMENT_RESTORE',
    actor,
    at,
    subject: slip,
    detail: note?.reason ? `Was voided: ${note.reason}` : null,
  });

  return dto;
}

/**
 * Which of these ids the manager has voided, so ingest can hold them there.
 *
 * A map rather than a set: the reason and the time are put back onto the
 * incoming record too, or the bridge's copy would arrive as VOID with no
 * explanation of why.
 */
export async function managerVoidsAmong(
  ids: readonly string[],
): Promise<Map<string, { reason: string; voided_at: Date }>> {
  if (ids.length === 0) return new Map();
  const rows = await ManagerVoidModel.find({ _id: { $in: [...ids] } }).lean();
  return new Map(
    rows.map((row) => [String(row._id), { reason: row.reason, voided_at: row.voided_at }]),
  );
}
