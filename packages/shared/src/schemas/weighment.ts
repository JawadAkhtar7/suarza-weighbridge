/**
 * The canonical weighment record (brief §6) as a Zod schema.
 *
 * This is the single validation source for all three tiers: the operator form
 * validates against it, the agent validates before writing SQLite, and the
 * cloud ingest route validates before upserting Mongo. Field names are
 * snake_case to match the DB columns/documents exactly — one shape everywhere
 * means no mapping layer to drift.
 */

import { z } from 'zod';
import { VEHICLE_TYPES } from '../constants/vehicle-types.js';
import { WEIGHMENT_STATUSES, WEIGHT_SOURCES, DEFAULT_CURRENCY } from '../constants/domain.js';
import { SLIP_NUMBER_REGEX } from '../utils/slip.js';

export const vehicleTypeSchema = z.enum(VEHICLE_TYPES);
export const weighmentStatusSchema = z.enum(WEIGHMENT_STATUSES);
export const weightSourceSchema = z.enum(WEIGHT_SOURCES);

export const slipNumberSchema = z
  .string()
  .regex(SLIP_NUMBER_REGEX, 'Slip number must look like SI-000123');

const utcDateTime = z.string().datetime({ offset: true });

/** A weight in kg. Negative readings are a wiring/tare fault, never data. */
const weightKg = z
  .number()
  .finite()
  .min(0, 'Weight cannot be negative')
  .max(200_000, 'Weight is implausibly large — check the indicator');

/** Optional text fields arrive as '' from HTML inputs; treat that as absent. */
/**
 * PAID — settled at the weighbridge, nothing outstanding.
 * ON_ACCOUNT — added to the customer's ledger, to be paid later.
 */
export const PAYMENT_STATUSES = ['PAID', 'ON_ACCOUNT'] as const;
export const paymentStatusSchema = z.enum(PAYMENT_STATUSES);
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/** The words the operator and the customer see. */
export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  PAID: 'Paid now',
  ON_ACCOUNT: 'On account',
};

const optionalText = z
  .string()
  .trim()
  .max(120)
  .optional()
  .transform((v) => (v === '' ? undefined : v));

export const weighmentSchema = z.object({
  id: z.string().uuid(),
  slip_number: slipNumberSchema,
  status: weighmentStatusSchema,
  station_id: z.string().min(1).max(16).default('A'),

  // Customer / vehicle
  customer_name: z.string().trim().min(1, 'Customer name is required').max(120),
  // Optional: plenty of customers are individuals with no company to give, and
  // refusing the weighing over it would just get a placeholder typed in. Empty
  // string rather than undefined, so every tier keeps a plain `string`.
  customer_company: z.string().trim().max(120).default(''),
  customer_phone: optionalText,
  vehicle_type: vehicleTypeSchema,
  vehicle_plate: z.string().trim().min(1, 'Vehicle plate is required').max(32),
  container_number: optionalText,
  product: z.string().trim().min(1, 'Product is required').max(120),

  /**
   * Whether the customer settled at the weighbridge or left it on their
   * account.
   *
   * Decided at completion, because that is when the money changes hands. It is
   * what stops the ledger treating every weighing as a debt: most customers pay
   * cash on the spot, and counting those as receivable would make "total owed
   * to you" a number nobody could act on.
   */
  payment_status: paymentStatusSchema.default('PAID'),

  // Weights
  first_weight_kg: weightKg,
  first_weight_at: utcDateTime,
  first_weight_src: weightSourceSchema,
  second_weight_kg: weightKg.nullable().default(null),
  second_weight_at: utcDateTime.nullable().default(null),
  second_weight_src: weightSourceSchema.nullable().default(null),
  net_weight_kg: z.number().finite().min(0).default(0),

  // Commercial
  amount_charged: z.number().finite().min(0, 'Amount cannot be negative').default(0),
  currency: z.string().min(1).max(8).default(DEFAULT_CURRENCY),

  // Meta
  operator_username: z.string().trim().min(1).max(64),
  created_at: utcDateTime,
  updated_at: utcDateTime,
  void_reason: z.string().trim().max(500).nullable().default(null),
  voided_at: utcDateTime.nullable().default(null),
});

export type Weighment = z.infer<typeof weighmentSchema>;

/**
 * Cross-field rules that only hold for a *complete* record. Kept separate from
 * the base schema because an OPEN ticket legitimately fails all of them.
 */
export const completedWeighmentSchema = weighmentSchema.superRefine((w, ctx) => {
  if (w.status !== 'COMPLETED') return;
  if (w.second_weight_kg === null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['second_weight_kg'],
      message: 'A completed weighment must have a second weight',
    });
  }
  if (w.second_weight_at === null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['second_weight_at'],
      message: 'A completed weighment must have a second weight timestamp',
    });
  }
});

// ---------------------------------------------------------------------------
// Request DTOs — what the operator app actually sends.
// ---------------------------------------------------------------------------

/** POST /weighments — pass 1. The agent mints id, slip number and timestamps. */
export const createWeighmentSchema = z.object({
  customer_name: z.string().trim().min(1, 'Customer name is required').max(120),
  // Optional: plenty of customers are individuals with no company to give, and
  // refusing the weighing over it would just get a placeholder typed in. Empty
  // string rather than undefined, so every tier keeps a plain `string`.
  customer_company: z.string().trim().max(120).default(''),
  customer_phone: optionalText,
  vehicle_type: vehicleTypeSchema,
  vehicle_plate: z.string().trim().min(1, 'Vehicle plate is required').max(32),
  container_number: optionalText,
  product: z.string().trim().min(1, 'Product is required').max(120),
  first_weight_kg: weightKg,
  first_weight_src: weightSourceSchema.default('SERIAL'),
  amount_charged: z.number().finite().min(0).default(0),
  operator_username: z.string().trim().min(1).max(64).default('operator'),
});

export type CreateWeighmentInput = z.infer<typeof createWeighmentSchema>;

/** PATCH /weighments/:slip/complete — pass 2. */
export const completeWeighmentSchema = z.object({
  second_weight_kg: weightKg,
  second_weight_src: weightSourceSchema.default('SERIAL'),
  amount_charged: z.number().finite().min(0),
  /** Defaults to PAID: taking the money at the gate is the normal case. */
  payment_status: paymentStatusSchema.default('PAID'),
  operator_username: z.string().trim().min(1).max(64).default('operator'),
  /** Identity fields stay locked after pass 1; only these may be corrected. */
  product: z.string().trim().min(1).max(120).optional(),
  container_number: optionalText,
});

export type CompleteWeighmentInput = z.infer<typeof completeWeighmentSchema>;

/** POST /weighments/:slip/void — a reason is mandatory (brief §7.6). */
export const voidWeighmentSchema = z.object({
  reason: z.string().trim().min(3, 'Give a reason for voiding this ticket').max(500),
  operator_username: z.string().trim().min(1).max(64).default('operator'),
});

export type VoidWeighmentInput = z.infer<typeof voidWeighmentSchema>;

export const reprintWeighmentSchema = z.object({
  operator_username: z.string().trim().min(1).max(64).default('operator'),
  /** Which of the two receipts is being reprinted, for the audit detail. */
  receipt: z.enum(['FIRST', 'SECOND']).default('SECOND'),
});

export type ReprintWeighmentInput = z.infer<typeof reprintWeighmentSchema>;

// ---------------------------------------------------------------------------
// Customer directory — built up from the weighments themselves.
// ---------------------------------------------------------------------------

/**
 * A customer the station has weighed before.
 *
 * There is no separate "add a customer" step anywhere: the directory is a
 * by-product of weighing, so it can never be out of date or half-filled in by
 * someone who was in a hurry. A customer is identified by name + company,
 * because that is the pair the operator actually types.
 */
export const customerSchema = z.object({
  id: z.string(),
  name: z.string(),
  company: z.string(),
  phone: z.string().nullable().default(null),
  /** Last values used, offered as defaults — never forced. */
  last_vehicle_type: vehicleTypeSchema.nullable().default(null),
  last_vehicle_plate: z.string().nullable().default(null),
  last_product: z.string().nullable().default(null),
  weighment_count: z.number().int().min(0).default(0),
  last_seen_at: z.string().datetime({ offset: true }),
});

export type Customer = z.infer<typeof customerSchema>;

/** `Ali Raza — Raza Traders`, the label the operator picks from. */
export function customerLabel(customer: Pick<Customer, 'name' | 'company'>): string {
  return customer.company ? `${customer.name} — ${customer.company}` : customer.name;
}
