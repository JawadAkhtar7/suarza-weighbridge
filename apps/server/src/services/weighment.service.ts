/** Manager queries over the synced records (brief §9, §13-M5). */

import type { FilterQuery } from 'mongoose';
import type { PaginatedWeighments, Weighment, WeighmentQuery } from '@suarza/shared';
import { DISPLAY_TIMEZONE, customerKey } from '@suarza/shared';
import { WeighmentModel, type WeighmentDocument } from '../models/weighment.model.js';
import { LedgerCustomerModel } from '../models/ledger.model.js';
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

  const [rows, total] = await Promise.all([
    WeighmentModel.find(filter)
      .sort({ [query.sort_by]: query.sort_dir === 'asc' ? 1 : -1 })
      .skip(skip)
      .limit(query.page_size)
      .lean(),
    WeighmentModel.countDocuments(filter),
  ]);

  const dtos = rows.map((row) => toDto(row as WeighmentDocument & { _id: string }));

  // One query for the whole page rather than one per row. The weighbridge does
  // not know about ledger accounts — it works offline and has no ledger — so
  // the link is made here, from the same name+company the ledger matches on.
  const keys = [...new Set(dtos.map((w) => customerKey(w.customer_name, w.customer_company)))];
  const accounts = await LedgerCustomerModel.find({ match_key: { $in: keys } })
    .select({ _id: 1, match_key: 1 })
    .lean();
  const idByKey = new Map(accounts.map((doc) => [doc.match_key, String(doc._id)]));

  return {
    rows: dtos.map((weighment) => ({
      ...weighment,
      customer_id:
        idByKey.get(customerKey(weighment.customer_name, weighment.customer_company)) ?? null,
    })),
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
