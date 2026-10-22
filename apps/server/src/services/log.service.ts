/**
 * Writing to the log, and reading it back.
 *
 * Writing never throws into the caller. A void that worked must not be
 * reported as failed because the note about it could not be filed — the
 * manager would press the button again, and the second press would refuse
 * because the slip is already voided, which reads as a broken feature rather
 * than a missing line in a log nobody was looking at yet.
 */

import { newId, nowUtc, type LogEntry, type LogQuery, type PaginatedLogs } from '@suarza/shared';
import type { LogKind, OperatorSlot } from '@suarza/shared';
import { LogModel, type LogDocument } from '../models/log.model.js';

export interface RecordLogInput {
  kind: LogKind;
  actor: string;
  actor_name?: string;
  slot?: OperatorSlot | null;
  subject?: string | null;
  detail?: string | null;
  /** Supplied by the bridge, whose events may be delivered twice. */
  id?: string;
  at?: Date | string;
  /** Both entries of one shift share this. */
  session_id?: string | null;
}

function toDto(doc: LogDocument & { _id: string }): LogEntry {
  return {
    id: String(doc._id),
    kind: doc.kind as LogKind,
    at: new Date(doc.at).toISOString(),
    actor: doc.actor,
    actor_name: doc.actor_name ?? '',
    slot: (doc.slot as OperatorSlot | null) ?? null,
    subject: doc.subject ?? null,
    detail: doc.detail ?? null,
    session_id: doc.session_id ?? null,
  };
}

/** Write one line. Never throws; a failure is logged and swallowed. */
export async function recordLog(input: RecordLogInput): Promise<void> {
  try {
    /*
     * Written once, never updated: a log entry is a thing that happened, and
     * the second delivery of a batch must leave the first exactly as it was.
     * The money is a list of its own — see ShiftCashModel — because cash
     * changes hands more than twice in a day.
     */
    await LogModel.updateOne(
      { _id: input.id ?? newId() },
      {
        $setOnInsert: {
          kind: input.kind,
          at: new Date(input.at ?? nowUtc()),
          actor: input.actor,
          actor_name: input.actor_name ?? input.actor,
          slot: input.slot ?? null,
          subject: input.subject ?? null,
          detail: input.detail ?? null,
          session_id: input.session_id ?? null,
        },
      },
      { upsert: true },
    );
  } catch (error) {
    console.error('Could not write a log entry:', error);
  }
}

/** Several at once, from a bridge pushing up a day of shift events. */
export async function recordLogs(inputs: readonly RecordLogInput[]): Promise<number> {
  let written = 0;
  for (const input of inputs) {
    await recordLog(input);
    written += 1;
  }
  return written;
}

export async function listLogs(query: LogQuery): Promise<PaginatedLogs> {
  const filter = query.kind ? { kind: query.kind } : {};
  const skip = (query.page - 1) * query.page_size;

  const [docs, total] = await Promise.all([
    LogModel.find(filter).sort({ at: -1 }).skip(skip).limit(query.page_size).lean(),
    LogModel.countDocuments(filter),
  ]);

  return {
    rows: docs.map((doc) => toDto(doc as LogDocument & { _id: string })),
    total,
    page: query.page,
    page_size: query.page_size,
  };
}
