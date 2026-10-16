/** Manager queries over the synced records (brief §9, §13-M5). */

import type { FilterQuery } from 'mongoose';
import type { PaginatedWeighments, ShiftTimings, Weighment, WeighmentQuery } from '@suarza/shared';
import {
  DEFAULT_FRONT_VIEW_FRAME,
  DEFAULT_SIDE_VIEW_FRAME,
  DISPLAY_TIMEZONE,
  customerKey,
  shiftAt,
} from '@suarza/shared';
import { WeighmentModel, type WeighmentDocument } from '../models/weighment.model.js';
import { LedgerCustomerModel } from '../models/ledger.model.js';
import { imagesForWeighments } from './capture.service.js';
import { cameraFramingForStations } from './station.service.js';
import { operatorNamesByShift, shiftTimings } from './roster.service.js';

/**
 * How many records a shift filter will sort through.
 *
 * The filter cannot be pushed into Mongo — see listWeighments — so the
 * matching records are read and divided here. The dashboard filters by date
 * as well and a weighbridge does a few dozen trucks a day, so this is a
 * ceiling nobody reaches in practice; it is here so that a year-wide query
 * cannot ask a 1 GB droplet to sort a hundred thousand records in memory.
 */
const SHIFT_SCAN_LIMIT = 5_000;
import { ApiError } from '../errors.js';

/** Regex metacharacters in a customer's name must not become a pattern. */
function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function toDto(doc: WeighmentDocument & { _id: string }): Weighment {
  return {
    id: String(doc._id),
    slip_number: doc.slip_number,
    status: doc.status as Weighment['status'],
    station_id: doc.station_id,
    customer_name: doc.customer_name,
    customer_company: doc.customer_company,
    customer_phone: doc.customer_phone ?? undefined,
    vehicle_type: doc.vehicle_type,
    vehicle_type_label: doc.vehicle_type_label ?? '',
    vehicle_plate: doc.vehicle_plate,
    container_number: doc.container_number ?? undefined,
    product: doc.product,
    first_weight_kg: doc.first_weight_kg,
    first_weight_at: new Date(doc.first_weight_at).toISOString(),
    first_weight_src: doc.first_weight_src as Weighment['first_weight_src'],
    second_weight_kg: doc.second_weight_kg ?? null,
    second_weight_at: doc.second_weight_at ? new Date(doc.second_weight_at).toISOString() : null,
    second_weight_src: (doc.second_weight_src ?? null) as Weighment['second_weight_src'],
    net_weight_kg: doc.net_weight_kg,
    amount_charged: doc.amount_charged,
    currency: doc.currency,
    payment_status: (doc.payment_status ?? 'PAID') as Weighment['payment_status'],
    operator_username: doc.operator_username,
    created_at: new Date(doc.created_at).toISOString(),
    updated_at: new Date(doc.updated_at).toISOString(),
    void_reason: doc.void_reason ?? null,
    voided_at: doc.voided_at ? new Date(doc.voided_at).toISOString() : null,
  };
}

/**
 * Builds the Mongo filter from the dashboard's controls.
 *
 * Dates filter on `first_weight_at` — the real event time — never on when the
 * record reached the cloud, so a week's worth of records that sync after an
 * outage still land on the days they happened (brief §6).
 */
export function buildFilter(query: WeighmentQuery): FilterQuery<WeighmentDocument> {
  const filter: FilterQuery<WeighmentDocument> = {};

  if (query.status) filter.status = query.status;
  if (query.vehicle_type) filter.vehicle_type = query.vehicle_type;
  if (query.slip_number) filter.slip_number = query.slip_number.trim().toUpperCase();

  // Partial, case-insensitive: the manager types a few letters of a name.
  if (query.customer_name) {
    filter.customer_name = { $regex: escapeRegex(query.customer_name.trim()), $options: 'i' };
  }
  if (query.customer_company) {
    filter.customer_company = { $regex: escapeRegex(query.customer_company.trim()), $options: 'i' };
  }

  if (query.from || query.to) {
    filter.first_weight_at = {};
    if (query.from) filter.first_weight_at.$gte = new Date(query.from);
    if (query.to) filter.first_weight_at.$lte = new Date(query.to);
  }

  return filter;
}

export async function listWeighments(query: WeighmentQuery): Promise<PaginatedWeighments> {
  const filter = buildFilter(query);
  const skip = (query.page - 1) * query.page_size;

  /*
   * A shift is a range of hours at the bridge, not a field on the record, so
   * it cannot be put into the Mongo filter: a night shift crosses midnight,
   * the hours are the manager's to change, and the bridge keeps a different
   * clock from this server. See shiftAt.
   *
   * So the page is sliced after the shift is worked out, which means reading
   * the matching records rather than one page of them. Bounded on purpose:
   * the dashboard filters by date as well, and a weighbridge does a few dozen
   * trucks a day. The cap is what stops a year-wide query being asked to sort
   * a hundred thousand records in memory.
   */
  const timings = query.shift ? await shiftTimings() : null;

  if (timings) {
    const matching = await WeighmentModel.find(filter)
      .sort({ [query.sort_by]: query.sort_dir === 'asc' ? 1 : -1 })
      .limit(SHIFT_SCAN_LIMIT)
      .lean();

    const inShift = matching.filter(
      (row) => shiftAt(new Date(row.first_weight_at), timings) === query.shift,
    );

    return annotate(
      inShift
        .slice(skip, skip + query.page_size)
        .map((row) => toDto(row as WeighmentDocument & { _id: string })),
      inShift.length,
      query,
      timings,
    );
  }

  const [rows, total] = await Promise.all([
    WeighmentModel.find(filter)
      .sort({ [query.sort_by]: query.sort_dir === 'asc' ? 1 : -1 })
      .skip(skip)
      .limit(query.page_size)
      .lean(),
    WeighmentModel.countDocuments(filter),
  ]);

  return annotate(
    rows.map((row) => toDto(row as WeighmentDocument & { _id: string })),
    total,
    query,
    null,
  );
}

/**
 * Everything a row needs that is not on the weighment itself.
 *
 * Its own function because two paths arrive here — one page read from Mongo,
 * or one page sliced out of a shift — and the ledger account, the pictures
 * and the shift all have to be attached the same way whichever did.
 */
async function annotate(
  dtos: Weighment[],
  total: number,
  query: WeighmentQuery,
  timings: ShiftTimings | null,
): Promise<PaginatedWeighments> {
  // One query for the whole page rather than one per row. The weighbridge does
  // not know about ledger accounts — it works offline and has no ledger — so
  // the link is made here, from the same name+company the ledger matches on.
  const keys = [...new Set(dtos.map((w) => customerKey(w.customer_name, w.customer_company)))];

  /*
   * The pictures come down with the list, two queries for the whole page.
   *
   * Not because the list shows them — it shows none — but because opening a
   * slip used to mean asking which pictures it had and only then starting to
   * fetch them. That round trip was half a second of the placeholder, before
   * the first byte of a real photograph moved. The ids are a hundred bytes a
   * row and the dialog has them the moment it opens.
   */
  const [accounts, images, framings, hours, names] = await Promise.all([
    LedgerCustomerModel.find({ match_key: { $in: keys } })
      .select({ _id: 1, match_key: 1 })
      .lean(),
    imagesForWeighments(dtos.map((w) => w.id)),
    cameraFramingForStations(dtos.map((w) => w.station_id)),
    timings ? Promise.resolve(timings) : shiftTimings(),
    operatorNamesByShift(),
  ]);

  const idByKey = new Map(accounts.map((doc) => [doc.match_key, String(doc._id)]));
  const defaultFraming = { front: DEFAULT_FRONT_VIEW_FRAME, side: DEFAULT_SIDE_VIEW_FRAME };

  return {
    rows: dtos.map((weighment) => {
      const framing = framings.get(weighment.station_id) ?? defaultFraming;
      /* Worked out, not stored: the hours are the manager's to change and
         every past record must re-read correctly when they do. */
      const shift = shiftAt(new Date(weighment.first_weight_at), hours);

      return {
        ...weighment,
        customer_id:
          idByKey.get(customerKey(weighment.customer_name, weighment.customer_company)) ?? null,
        shift,
        /* Whoever holds that shift NOW — the weighbridge has one login used by
           whoever is at the window, so there is nothing on the record itself
           to name. Null when nobody is rostered to it. */
        operator_name: names[shift],
        captures: {
          // A weighing with no pictures is a pair of nulls, not an absence:
          // the dialog must be able to tell "this bridge has no cameras" from
          // "nobody has told me yet", and only the second is worth waiting on.
          ...(images.get(weighment.id) ?? { front: null, side: null }),
          front_view_frame: framing.front,
          side_view_frame: framing.side,
          /* For a dashboard build that predates front framing. */
          front_view_zoom: framing.front.zoom,
        },
      };
    }),
    total,
    page: query.page,
    page_size: query.page_size,
  };
}

export async function findBySlip(slipNumber: string): Promise<Weighment | null> {
  const doc = await WeighmentModel.findOne({ slip_number: slipNumber.trim().toUpperCase() }).lean();
  return doc ? toDto(doc as WeighmentDocument & { _id: string }) : null;
}

export async function requireBySlip(slipNumber: string): Promise<Weighment> {
  const weighment = await findBySlip(slipNumber);
  if (!weighment) {
    throw new ApiError('NOT_FOUND', `No weighment found for slip ${slipNumber}.`);
  }
  return weighment;
}

export { DISPLAY_TIMEZONE };

/**
 * Distinct customer or company names for the dashboard's filter suggestions.
 *
 * Read from the weighments themselves rather than a separate list, so a name
 * can be suggested the moment it has been used once and can never drift out of
 * step with the records it filters.
 */
export async function suggestValues(
  field: 'customer_name' | 'customer_company',
  query: string,
  limit = 10,
): Promise<string[]> {
  const trimmed = query.trim();

  const match: FilterQuery<WeighmentDocument> = trimmed
    ? { [field]: { $regex: escapeRegex(trimmed), $options: 'i' } }
    : {};

  // An aggregation rather than `distinct`: it can sort by how often a name
  // appears, so the customers who actually use the bridge come first.
  const rows = await WeighmentModel.aggregate<{ _id: string; count: number }>([
    { $match: { ...match, status: { $ne: 'VOID' } } },
    { $group: { _id: `$${field}`, count: { $sum: 1 } } },
    { $sort: { count: -1, _id: 1 } },
    { $limit: limit },
  ]);

  return rows.map((row) => row._id).filter((value) => typeof value === 'string' && value !== '');
}
