/**
 * The two lists the manager keeps: customers, and vehicle types with rates.
 *
 * Both are pulled by each weighbridge rather than pushed to it, and both use a
 * soft delete — see `catalogue.ts` in @suarza/shared for why removal has to be
 * a field that travels rather than a row that disappears.
 */

import {
  VEHICLE_TYPE_DEFS,
  customerKey,
  vehicleTypeKey,
  type CreateCustomerInput,
  type CustomerRecord,
  type VehicleTypeRecord,
} from '@suarza/shared';
import mongoose from 'mongoose';
import { LedgerCustomerModel } from '../models/ledger.model.js';
import { VehicleTypeModel } from '../models/vehicle-type.model.js';
import { ApiError } from '../errors.js';

const notFound = (what: string, id: string) =>
  new ApiError('NOT_FOUND', `No ${what} with that id.`, { id });

function toCustomer(doc: {
  _id: unknown;
  match_key: string;
  name: string;
  company?: string | null;
  phone?: string | null;
  deleted_at?: Date | null;
  updated_at: Date;
}): CustomerRecord {
  return {
    id: String(doc._id),
    match_key: doc.match_key,
    name: doc.name,
    company: doc.company ?? '',
    phone: doc.phone ?? null,
    deleted_at: doc.deleted_at ? new Date(doc.deleted_at).toISOString() : null,
    updated_at: new Date(doc.updated_at).toISOString(),
  };
}

function toVehicleType(doc: {
  _id: unknown;
  key: string;
  label: string;
  rate_pkr: number;
  deleted_at?: Date | null;
  updated_at: Date;
}): VehicleTypeRecord {
  return {
    id: String(doc._id),
    key: doc.key,
    label: doc.label,
    rate_pkr: doc.rate_pkr,
    deleted_at: doc.deleted_at ? new Date(doc.deleted_at).toISOString() : null,
    updated_at: new Date(doc.updated_at).toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------

export async function listCustomerRecords(options: {
  q?: string;
  includeDeleted?: boolean;
}): Promise<CustomerRecord[]> {
  const filter: Record<string, unknown> = {};
  if (!options.includeDeleted) filter.deleted_at = null;

  if (options.q) {
    // Escaped: a customer called "A+B (Pvt)" must not be read as a pattern.
    const pattern = new RegExp(options.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ name: pattern }, { company: pattern }, { phone: pattern }];
  }

  const docs = await LedgerCustomerModel.find(filter).sort({ name: 1 }).lean();
  return docs.map((doc) => toCustomer(doc as Parameters<typeof toCustomer>[0]));
}

export async function createCustomer(input: CreateCustomerInput): Promise<CustomerRecord> {
  const key = customerKey(input.name, input.company);
  const existing = await LedgerCustomerModel.findOne({ match_key: key });

  if (existing && !existing.deleted_at) {
    throw new ApiError('VALIDATION_ERROR', 'That customer already exists.', {
      field_errors: { name: ['A customer with this name and company is already on file.'] },
    });
  }

  if (existing) {
    // Re-creating someone who was removed brings the same account back, ledger
    // history and all, rather than starting a second one beside it.
    existing.deleted_at = null;
    existing.name = input.name.trim();
    existing.company = input.company.trim();
    if (input.phone) existing.phone = input.phone.trim();
    existing.updated_at = new Date();
    await existing.save();
    return toCustomer(existing.toObject() as Parameters<typeof toCustomer>[0]);
  }

  const doc = await LedgerCustomerModel.create({
    match_key: key,
    name: input.name.trim(),
    company: input.company.trim(),
    phone: input.phone?.trim() || null,
    created_at: new Date(),
    updated_at: new Date(),
  });

  return toCustomer(doc.toObject() as Parameters<typeof toCustomer>[0]);
}

export async function updateCustomer(
  id: string,
  input: { name: string; company: string; phone?: string | null },
): Promise<CustomerRecord> {
  if (!mongoose.isValidObjectId(id)) throw notFound('customer', id);
  const doc = await LedgerCustomerModel.findById(id);
  if (!doc) throw notFound('customer', id);

  const key = customerKey(input.name, input.company);

  // The key is how weighings find this account, so moving it onto one that is
  // already taken would silently merge two customers' money.
  const clash = await LedgerCustomerModel.findOne({ match_key: key, _id: { $ne: doc._id } });
  if (clash) {
    throw new ApiError('VALIDATION_ERROR', 'Another customer already uses that name and company.', {
      field_errors: { name: ['Another customer already uses this name and company.'] },
    });
  }

  doc.match_key = key;
  doc.name = input.name.trim();
  doc.company = input.company.trim();
  if (input.phone !== undefined) doc.phone = input.phone?.trim() || null;
  doc.updated_at = new Date();
  await doc.save();

  return toCustomer(doc.toObject() as Parameters<typeof toCustomer>[0]);
}

export async function deleteCustomer(id: string): Promise<CustomerRecord> {
  if (!mongoose.isValidObjectId(id)) throw notFound('customer', id);
  const doc = await LedgerCustomerModel.findById(id);
  if (!doc) throw notFound('customer', id);

  doc.deleted_at = new Date();
  doc.updated_at = new Date();
  await doc.save();

  return toCustomer(doc.toObject() as Parameters<typeof toCustomer>[0]);
}

// ---------------------------------------------------------------------------
// Vehicle types
// ---------------------------------------------------------------------------

/**
 * Puts the shipped types into a database that has none.
 *
 * Runs at startup. Without it the first weighbridge to sync would pull an empty
 * rate card and the operator would have nothing to choose from.
 */
export async function seedVehicleTypes(): Promise<number> {
  if ((await VehicleTypeModel.countDocuments()) > 0) return 0;

  const now = new Date();
  await VehicleTypeModel.insertMany(
    VEHICLE_TYPE_DEFS.map((def) => ({
      key: def.key,
      label: def.label,
      rate_pkr: def.defaultPrice,
      created_at: now,
      updated_at: now,
    })),
  );
  return VEHICLE_TYPE_DEFS.length;
}

export async function listVehicleTypes(includeDeleted = false): Promise<VehicleTypeRecord[]> {
  const filter = includeDeleted ? {} : { deleted_at: null };
  const docs = await VehicleTypeModel.find(filter).sort({ label: 1 }).lean();
  return docs.map((doc) => toVehicleType(doc as Parameters<typeof toVehicleType>[0]));
}

export async function createVehicleType(input: {
  label: string;
  rate_pkr: number;
}): Promise<VehicleTypeRecord> {
  const key = vehicleTypeKey(input.label);
  if (!key) {
    throw new ApiError('VALIDATION_ERROR', 'That name has no letters or digits to make a key from.', {
      field_errors: { label: ['Use a name with letters or numbers in it.'] },
    });
  }

  const existing = await VehicleTypeModel.findOne({ key });
  if (existing && !existing.deleted_at) {
    throw new ApiError('VALIDATION_ERROR', 'That vehicle type already exists.', {
      field_errors: { label: ['A vehicle type with this name is already on file.'] },
    });
  }

  if (existing) {
    // Same key, so every record that pointed at it lines back up.
    existing.deleted_at = null;
    existing.label = input.label.trim();
    existing.rate_pkr = input.rate_pkr;
    existing.updated_at = new Date();
    await existing.save();
    return toVehicleType(existing.toObject() as Parameters<typeof toVehicleType>[0]);
  }

  const doc = await VehicleTypeModel.create({
    key,
    label: input.label.trim(),
    rate_pkr: input.rate_pkr,
    created_at: new Date(),
    updated_at: new Date(),
  });

  return toVehicleType(doc.toObject() as Parameters<typeof toVehicleType>[0]);
}

export async function updateVehicleType(
  id: string,
  input: { label: string; rate_pkr: number },
): Promise<VehicleTypeRecord> {
  if (!mongoose.isValidObjectId(id)) throw notFound('vehicle type', id);
  const doc = await VehicleTypeModel.findById(id);
  if (!doc) throw notFound('vehicle type', id);

  // The key is deliberately left alone. Renaming "Mazda" to "Shehzore" must
  // keep every slip already weighed as a Mazda pointing at this same type.
  doc.label = input.label.trim();
  doc.rate_pkr = input.rate_pkr;
  doc.updated_at = new Date();
  await doc.save();

  return toVehicleType(doc.toObject() as Parameters<typeof toVehicleType>[0]);
}

export async function deleteVehicleType(id: string): Promise<VehicleTypeRecord> {
  if (!mongoose.isValidObjectId(id)) throw notFound('vehicle type', id);
  const doc = await VehicleTypeModel.findById(id);
  if (!doc) throw notFound('vehicle type', id);

  doc.deleted_at = new Date();
  doc.updated_at = new Date();
  await doc.save();

  return toVehicleType(doc.toObject() as Parameters<typeof toVehicleType>[0]);
}

// ---------------------------------------------------------------------------
// What a weighbridge pulls
// ---------------------------------------------------------------------------

/**
 * Everything, removals included.
 *
 * A bridge cannot be sent only what is live: it would keep a customer the
 * manager deleted for ever, having never been told. At this scale the whole
 * list is a small payload, and sending it whole means a bridge that has been
 * off for a month needs no catch-up logic.
 */
export async function customersForSync(): Promise<CustomerRecord[]> {
  return listCustomerRecords({ includeDeleted: true });
}

export async function vehicleTypesForSync(): Promise<VehicleTypeRecord[]> {
  return listVehicleTypes(true);
}
