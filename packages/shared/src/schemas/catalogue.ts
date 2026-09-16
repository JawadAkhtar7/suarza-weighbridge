/**
 * The two lists the manager keeps and the weighbridge pulls down: customers,
 * and vehicle types with their rates.
 *
 * Before this, both lived only on the weighbridge PC — customers appeared by
 * being weighed, and rates were typed into the operator's Settings. The client
 * wants them managed centrally, so the cloud owns them and each weighbridge
 * syncs a copy. The copy is what the operator works from, which is what keeps
 * the bridge working when the line is down.
 *
 * Sync is a PULL, on a button, not a push. A weighbridge that has been offline
 * for a week must not have a list changed under the operator mid-weighing, and
 * an operator who has just been told "the new rate is live" needs to be able to
 * make that true without waiting for a timer.
 *
 * Nothing is ever hard-deleted. A removed customer or type is marked deleted
 * and still travels, because a weighbridge that has never seen the deletion has
 * no other way to learn about it, and because records made earlier still point
 * at it.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------

export const customerRecordSchema = z.object({
  id: z.string().min(1),
  /** `customerKey(name, company)` — how a weighing finds its account. */
  match_key: z.string(),
  name: z.string(),
  company: z.string().default(''),
  phone: z.string().nullable().default(null),
  /** Set when the manager removes them; they still sync, so bridges learn. */
  deleted_at: z.string().datetime({ offset: true }).nullable().default(null),
  updated_at: z.string().datetime({ offset: true }),
});

export type CustomerRecord = z.infer<typeof customerRecordSchema>;

export const createCustomerSchema = z.object({
  name: z.string().trim().min(1, 'Customer name is required').max(120),
  company: z.string().trim().max(120).default(''),
  phone: z.string().trim().max(40).optional(),
});

export type CreateCustomerInput = z.infer<typeof createCustomerSchema>;

/**
 * Editing a customer can move their match key, which is how their weighings
 * find them — so the name and company are sent together or not at all, and the
 * server recomputes the key from the pair.
 */
export const updateCustomerSchema = z.object({
  name: z.string().trim().min(1, 'Customer name is required').max(120),
  company: z.string().trim().max(120).default(''),
  phone: z.string().trim().max(40).nullable().optional(),
});

// ---------------------------------------------------------------------------
// Vehicle types
// ---------------------------------------------------------------------------

export const vehicleTypeRecordSchema = z.object({
  id: z.string().min(1),
  /** Stable, lower-case; what a weighment stores. Never changes once made. */
  key: z.string().min(1).max(40),
  label: z.string().min(1).max(80),
  /** Rupees. Zero means "the operator types the amount", as `other` always did. */
  rate_pkr: z.number().finite().min(0).max(10_000_000),
  deleted_at: z.string().datetime({ offset: true }).nullable().default(null),
  updated_at: z.string().datetime({ offset: true }),
});

export type VehicleTypeRecord = z.infer<typeof vehicleTypeRecordSchema>;

export const createVehicleTypeSchema = z.object({
  label: z.string().trim().min(1, 'A name is required').max(80),
  rate_pkr: z.number().finite().min(0).max(10_000_000),
});

/** The key is deliberately absent: renaming must not orphan existing records. */
export const updateVehicleTypeSchema = z.object({
  label: z.string().trim().min(1, 'A name is required').max(80),
  rate_pkr: z.number().finite().min(0).max(10_000_000),
});

// ---------------------------------------------------------------------------
// What the weighbridge pulls
// ---------------------------------------------------------------------------

export const customerSyncResponseSchema = z.object({
  customers: z.array(customerRecordSchema),
  synced_at: z.string().datetime({ offset: true }),
});

export const vehicleTypeSyncResponseSchema = z.object({
  vehicle_types: z.array(vehicleTypeRecordSchema),
  synced_at: z.string().datetime({ offset: true }),
});

/** What the operator is told a sync did, in words they can act on. */
export const syncOutcomeSchema = z.object({
  added: z.number().int().min(0),
  updated: z.number().int().min(0),
  removed: z.number().int().min(0),
  total: z.number().int().min(0),
  synced_at: z.string().datetime({ offset: true }),
});

export type SyncOutcome = z.infer<typeof syncOutcomeSchema>;
