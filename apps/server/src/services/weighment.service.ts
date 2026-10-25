/** Manager queries over the synced records (brief §9, §13-M5). */

import type { FilterQuery } from 'mongoose';
import type {
  PaginatedWeighments,
  Shift,
  ShiftTimings,
  Weighment,
  WeighmentQuery,
} from '@suarza/shared';
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
import { operatorNamesByShift, operatorNamesByUsername, shiftTimings } from './roster.service.js';

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
    /* Records that predate the container re-weigh have no such field. */
    owner_declared: doc.owner_declared === true,
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

  /*
   * A plate, matched on any part of it and without its punctuation.
   *
   * `LES-1234`, `LES 1234` and `les1234` are one truck as far as the yard is
   * concerned, and which of the three reached the record depends on who
   * typed it. So the separators are dropped from what was typed and allowed
   * to be anything between the characters that remain — which is what makes
   * searching `1234` find the truck as readily as the whole plate does.
   */
  if (query.vehicle_plate) {
    const characters = [...query.vehicle_plate.replace(/[^a-z0-9]/gi, '')];
    if (characters.length > 0) {
      filter.vehicle_plate = {
        $regex: characters.map((character) => escapeRegex(character)).join('[^a-z0-9]*'),
        $options: 'i',
      };
    }
  }

  if (query.from || query.to) {
    filter.first_weight_at = {};
    if (query.from) filter.first_weight_at.$gte = new Date(query.from);
    if (query.to) filter.first_weight_at.$lte = new Date(query.to);
  }

  return filter;
}

/**
 * "Was this weighed during that shift?", asked of Mongo rather than of Node.
 *
 * A shift is a range of hours at the BRIDGE, not a field on the record: the
 * night shift crosses midnight, the hours are the manager's to change, and
 * the server keeps a different clock from the yard. So it is computed — the
 * weighing's hour and minute in Pakistan, compared against the two starts.
 *
 * It is computed in the database on purpose. This used to read the matching
 * records into memory and divide them there, which meant a cap on how many
 * could be read, a page count that counted only as far as the cap, and —
 * once the dashboard's figures were asked to follow the shift filter too —
 * the same rule written twice in two languages. One expression, used by the
 * table and by every figure above it, cannot disagree with itself.
 *
 * The cost is that no index covers it; the date filter above it is what keeps
 * the scan small, and a weighbridge does a few dozen trucks a day.
 */
export function shiftMatch(shift: Shift, timings: ShiftTimings): FilterQuery<WeighmentDocument> {
  const morning = ((timings.MORNING % 1440) + 1440) % 1440;
  const night = ((timings.NIGHT % 1440) + 1440) % 1440;

  // Equal starts are refused when they are set; if one ever reached the
  // database anyway, shiftAt calls the whole day MORNING and so does this.
  if (morning === night) {
    return shift === 'MORNING' ? {} : { _id: { $in: [] } };
  }

  const minuteOfDay = {
    $add: [
      { $multiply: [{ $hour: { date: '$first_weight_at', timezone: DISPLAY_TIMEZONE } }, 60] },
      { $minute: { date: '$first_weight_at', timezone: DISPLAY_TIMEZONE } },
    ],
  };

  // Half-open, exactly as shiftAt has it: a weighing taken at the moment the
  // night begins is night, not both.
  const inMorning =
    morning < night
      ? { $and: [{ $gte: [minuteOfDay, morning] }, { $lt: [minuteOfDay, night] }] }
      : // The MORNING is the one crossing midnight in this configuration.
        { $or: [{ $gte: [minuteOfDay, morning] }, { $lt: [minuteOfDay, night] }] };

  return { $expr: shift === 'MORNING' ? inMorning : { $not: inMorning } };
}

/**
 * The whole filter, shift included.
 *
 * Async where `buildFilter` is not, because a shift cannot be read off the
 * query alone — it needs the hours the manager has set. Every caller that
 * honours the dashboard's filters uses this one; `buildFilter` remains for
 * what can be decided without a round trip.
 */
export async function buildQueryFilter(
  query: WeighmentQuery,
): Promise<{ filter: FilterQuery<WeighmentDocument>; timings: ShiftTimings | null }> {
  const filter = buildFilter(query);
  if (!query.shift) return { filter, timings: null };

  const timings = await shiftTimings();
  return { filter: { ...filter, ...shiftMatch(query.shift, timings) }, timings };
}

export async function listWeighments(query: WeighmentQuery): Promise<PaginatedWeighments> {
  const { filter, timings } = await buildQueryFilter(query);
  const skip = (query.page - 1) * query.page_size;

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
    timings,
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
  const [accounts, images, framings, hours, names, namesByUsername] = await Promise.all([
    LedgerCustomerModel.find({ match_key: { $in: keys } })
      .select({ _id: 1, match_key: 1 })
      .lean(),
    imagesForWeighments(dtos.map((w) => w.id)),
    cameraFramingForStations(dtos.map((w) => w.station_id)),
    timings ? Promise.resolve(timings) : shiftTimings(),
    operatorNamesByShift(),
    operatorNamesByUsername(),
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
        /*
         * Whoever SAVED it, by the username they signed in with.
         *
         * The roster is the fallback, not the answer. It says who holds a
         * shift now, which was all there was before the operators signed in
         * at the bridge — and it reads wrong in the two cases that matter:
         * a weighing saved by the administrator, or by whoever covered the
         * night, was labelled with the name of the person rostered to the
         * hour it happened to fall in. Null only when neither knows.
         */
        operator_name:
          namesByUsername.get(weighment.operator_username.trim().toLowerCase()) ?? names[shift],
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
 * Distinct customer names, companies or plates for the filter suggestions.
 *
 * Read from the weighments themselves rather than a separate list, so a name
 * can be suggested the moment it has been used once and can never drift out of
 * step with the records it filters.
 */
export async function suggestValues(
  field: 'customer_name' | 'customer_company' | 'vehicle_plate',
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
