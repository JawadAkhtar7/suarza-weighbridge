/**
 * Agent → cloud ingest (brief §7.4, §11).
 *
 * Idempotent by construction: every document is keyed on the record's UUID, so
 * a batch re-sent after a timeout upserts the same documents instead of
 * duplicating them. The agent decides what to send; the cloud never invents or
 * merges data.
 */

import type { AuditEntry, IngestResponse, StationProfile, Weighment } from '@suarza/shared';
import { WeighmentModel } from '../models/weighment.model.js';
import { AuditModel } from '../models/audit.model.js';
import { StationModel } from '../models/station.model.js';
import { postWeighmentCharges } from './ledger.service.js';

/** Fields that come from the agent, with dates parsed for Mongo. */
function toDocument(weighment: Weighment): Record<string, unknown> {
  return {
    slip_number: weighment.slip_number,
    status: weighment.status,
    station_id: weighment.station_id,
    customer_name: weighment.customer_name,
    customer_company: weighment.customer_company,
    customer_phone: weighment.customer_phone ?? null,
    vehicle_type: weighment.vehicle_type,
    vehicle_type_label: weighment.vehicle_type_label,
    vehicle_plate: weighment.vehicle_plate,
    container_number: weighment.container_number ?? null,
    product: weighment.product,
    first_weight_kg: weighment.first_weight_kg,
    first_weight_at: new Date(weighment.first_weight_at),
    first_weight_src: weighment.first_weight_src,
    second_weight_kg: weighment.second_weight_kg,
    second_weight_at: weighment.second_weight_at ? new Date(weighment.second_weight_at) : null,
    second_weight_src: weighment.second_weight_src,
    net_weight_kg: weighment.net_weight_kg,
    amount_charged: weighment.amount_charged,
    currency: weighment.currency,
    payment_status: weighment.payment_status,
    operator_username: weighment.operator_username,
    created_at: new Date(weighment.created_at),
    updated_at: new Date(weighment.updated_at),
    void_reason: weighment.void_reason,
    voided_at: weighment.voided_at ? new Date(weighment.voided_at) : null,
    synced_at: new Date(),
  };
}

/**
 * Mongo error codes that no retry can fix.
 *
 * 11000 is a duplicate key — here, two different records claiming one slip
 * number, which happens when an agent database is restored or rebuilt and the
 * counter restarts over numbers the cloud already holds. 121 is document
 * validation. Both need a human; neither improves by being sent again, and the
 * agent has to be told so rather than left guessing from the message text.
 */
const PERMANENT_ERROR_CODES = new Set([11000, 121]);

function isPermanent(error: { code?: number }): boolean {
  return error.code !== undefined && PERMANENT_ERROR_CODES.has(error.code);
}

export interface IngestResult extends IngestResponse {
  /** Ids skipped because the stored copy is already newer. */
  skipped_ids: string[];
  audit_inserted: number;
}

/**
 * Records what the station says its company details are.
 *
 * Guarded on the station's own edit time: batches can arrive out of order after
 * an outage, and an old one must not undo a correction made since.
 */
async function storeStationProfile(station: StationProfile): Promise<void> {
  await StationModel.updateOne(
    { _id: station.station_id, updated_at: { $lte: new Date(station.updated_at) } },
    {
      $set: {
        company_name: station.company_name,
        company_address: station.company_address,
        company_phone: station.company_phone,
        company_logo_url: station.company_logo_url,
        paper_size: station.paper_size,
        updated_at: new Date(station.updated_at),
        synced_at: new Date(),
      },
    },
    { upsert: false },
  );

  // Separate insert, because the guarded update above matches nothing on a
  // station the cloud has never heard of.
  await StationModel.updateOne(
    { _id: station.station_id },
    {
      $setOnInsert: {
        company_name: station.company_name,
        company_address: station.company_address,
        company_phone: station.company_phone,
        company_logo_url: station.company_logo_url,
        paper_size: station.paper_size,
        updated_at: new Date(station.updated_at),
        synced_at: new Date(),
      },
    },
    { upsert: true },
  );
}

export async function ingest(
  weighments: Weighment[],
  auditEntries: AuditEntry[],
  station?: StationProfile,
): Promise<IngestResult> {
  // Before the weighments: a receipt rendered from this batch should already
  // carry the details the same batch brought.
  if (station) await storeStationProfile(station);

  const acceptedIds: string[] = [];
  const skippedIds: string[] = [];
  const rejected: { id: string; reason: string; permanent: boolean }[] = [];

  if (weighments.length > 0) {
    // One read to find records the cloud already holds a NEWER copy of. Two
    // batches can overlap on a retry, and an older copy arriving second must
    // not undo a completion (brief §11: retries and reconnect sweeps).
    const ids = weighments.map((w) => w.id);
    const existing = await WeighmentModel.find({ _id: { $in: ids } })
      .select({ _id: 1, updated_at: 1 })
      .lean();

    const storedUpdatedAt = new Map(
      existing.map((doc) => [String(doc._id), new Date(doc.updated_at).getTime()]),
    );

    const operations = [];
    for (const weighment of weighments) {
      const stored = storedUpdatedAt.get(weighment.id);
      const incoming = new Date(weighment.updated_at).getTime();

      if (stored !== undefined && stored > incoming) {
        // Already accepted from the agent's point of view — it must stop
        // retrying this record, so it counts as accepted, not rejected.
        skippedIds.push(weighment.id);
        acceptedIds.push(weighment.id);
        continue;
      }

      operations.push({
        updateOne: {
          filter: { _id: weighment.id },
          update: { $set: toDocument(weighment) },
          upsert: true,
        },
      });
    }

    if (operations.length > 0) {
      try {
        await WeighmentModel.bulkWrite(operations, { ordered: false });
        for (const operation of operations) {
          acceptedIds.push(String(operation.updateOne.filter._id));
        }
      } catch (error) {
        // One bad record must not cost the whole batch: with ordered:false the
        // rest were written, so only the failures are reported back.
        const writeErrors = (
          error as { writeErrors?: { index: number; code?: number; errmsg?: string }[] }
        ).writeErrors;
        if (!writeErrors) throw error;

        const failedIndexes = new Set(writeErrors.map((e) => e.index));
        operations.forEach((operation, index) => {
          const id = String(operation.updateOne.filter._id);
          if (failedIndexes.has(index)) {
            const failure = writeErrors.find((e) => e.index === index);
            rejected.push({
              id,
              reason: failure?.errmsg ?? 'Write failed',
              permanent: isPermanent(failure ?? {}),
            });
          } else {
            acceptedIds.push(id);
          }
        });
      }
    }
  }

  // The ledger follows the weighments. Deliberately after the write and inside
  // its own guard: a weighbridge record reaching the cloud matters more than
  // the ledger being instantly current, and the next batch re-posts anyway
  // because the charge is keyed on the weighment id.
  if (weighments.length > 0) {
    try {
      await postWeighmentCharges(weighments);
    } catch (error) {
      console.error('Ledger posting failed for this batch:', (error as Error).message);
    }
  }

  let auditInserted = 0;
  if (auditEntries.length > 0) {
    const auditOperations = auditEntries.map((entry) => ({
      updateOne: {
        filter: { _id: entry.id },
        update: {
          $set: {
            weighment_id: entry.weighment_id,
            action: entry.action,
            actor_username: entry.actor_username,
            detail: entry.detail,
            at: new Date(entry.at),
            synced_at: new Date(),
          },
        },
        upsert: true,
      },
    }));

    const result = await AuditModel.bulkWrite(auditOperations, { ordered: false });
    auditInserted = result.upsertedCount;
  }

  return {
    accepted_ids: acceptedIds,
    skipped_ids: skippedIds,
    rejected,
    audit_inserted: auditInserted,
    received_at: new Date().toISOString(),
  };
}
