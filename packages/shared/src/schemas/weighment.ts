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
import { WEIGHMENT_STATUSES, WEIGHT_SOURCES, DEFAULT_CURRENCY } from '../constants/domain.js';
import { isStorableSlipNumber } from '../utils/slip.js';

/**
 * A vehicle type key. A key, not one of a fixed set — the manager keeps the
 * catalogue now, so a type added next year must be storable today. The agent
 * checks it against the catalogue it has synced, which is a better check than
 * an enum compiled into three tiers.
 */
export const vehicleTypeSchema = z
  .string()
  .trim()
  .min(1, 'Vehicle type is required')
  .max(40)
  .regex(/^[a-z0-9_]+$/, 'Vehicle type must be a lower-case key');
export const weighmentStatusSchema = z.enum(WEIGHMENT_STATUSES);
export const weightSourceSchema = z.enum(WEIGHT_SOURCES);

/**
 * Describes a slip number on a record that EXISTS, so it also accepts the
 * pre-2026 `SI-000123` shape. New numbers come from `generateSlipNumber`,
 * which only ever mints the current format.
 */
export const slipNumberSchema = z
  .string()
  .refine(isStorableSlipNumber, 'Slip number must be the year and a number, like 20265');

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

/**
 * A plate or container number, upper-cased on the way in.
 *
 * These are identifiers that get read back off a slip and compared by eye,
 * and "les-1234" and "LES-1234" are the same truck. Normalising here rather
 * than in the form means the record, the slip and any later lookup all agree
 * no matter which tier or which screen the value arrived through — the form
 * only ever styled it upper-case, which left the stored value as typed.
 */
const upperIdentifier = z
  .string()
  .trim()
  .max(32)
  .transform((v) => v.toUpperCase());

const optionalUpperIdentifier = z
  .string()
  .trim()
  .max(120)
  .optional()
  .transform((v) => (v === '' || v === undefined ? undefined : v.toUpperCase()));

export const weighmentSchema = z.object({
  id: z.string().uuid(),
  slip_number: slipNumberSchema,
  status: weighmentStatusSchema,
  station_id: z.string().min(1).max(16).default('A'),

  // Customer / vehicle
  /**
   * Optional, like the company and the product.
   *
   * A weighing with nobody named opens no customer account and posts nothing
   * to the ledger — there is no one to bill, and pooling every unnamed weighing
   * into a single nameless account would make a balance no one could chase.
   * That is why "Add to account" needs a name and a cash weighing does not.
   */
  customer_name: z.string().trim().max(120).default(''),
  // Optional: plenty of customers are individuals with no company to give, and
  // refusing the weighing over it would just get a placeholder typed in. Empty
  // string rather than undefined, so every tier keeps a plain `string`.
  customer_company: z.string().trim().max(120).default(''),
  customer_phone: optionalText,
  vehicle_type: vehicleTypeSchema,
  /**
   * What the type was called when the slip was made.
   *
   * Carried on the record rather than looked up, so a slip reprinted after the
   * manager renames a type still reads the way the customer's copy does, and so
   * a receipt can be rendered by a tier that has no catalogue.
   */
  vehicle_type_label: z.string().trim().max(80).default(''),
  vehicle_plate: upperIdentifier.pipe(z.string().min(1, 'Vehicle plate is required')),
  container_number: optionalUpperIdentifier,
  // Optional, like the company: plenty of loads are weighed without anyone
  // naming what is on the truck, and refusing the weighing over it would only
  // get a placeholder typed in. Empty string rather than undefined, so every
  // tier keeps a plain `string`.
  product: z.string().trim().max(120).default(''),

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

/**
 * The photographs taken when the weight was captured, waiting to be filed.
 *
 * The cameras used to fire when the weighing was SAVED, which is a different
 * moment entirely: the operator captures a weight, then types a plate, a
 * product, a customer and an amount, and by the time they press Save the
 * truck has often pulled off the bridge. The pictures showed the next truck,
 * or an empty plate.
 *
 * So the agent now photographs the truck the instant the weight is taken and
 * holds the result against this token, which the save hands back. An id the
 * agent no longer knows — it restarted, or the operator left the form open
 * past the holding time — is not an error: it falls back to photographing
 * whatever is there now, which is exactly what used to happen.
 */
const captureToken = z.string().trim().max(64).optional();

/** POST /weighments — pass 1. The agent mints id, slip number and timestamps. */
export const createWeighmentSchema = z.object({
  /**
   * Optional, like the company and the product.
   *
   * A weighing with nobody named opens no customer account and posts nothing
   * to the ledger — there is no one to bill, and pooling every unnamed weighing
   * into a single nameless account would make a balance no one could chase.
   * That is why "Add to account" needs a name and a cash weighing does not.
   */
  customer_name: z.string().trim().max(120).default(''),
  // Optional: plenty of customers are individuals with no company to give, and
  // refusing the weighing over it would just get a placeholder typed in. Empty
  // string rather than undefined, so every tier keeps a plain `string`.
  customer_company: z.string().trim().max(120).default(''),
  customer_phone: optionalText,
  vehicle_type: vehicleTypeSchema,
  /**
   * What the type was called when the slip was made.
   *
   * Carried on the record rather than looked up, so a slip reprinted after the
   * manager renames a type still reads the way the customer's copy does, and so
   * a receipt can be rendered by a tier that has no catalogue.
   */
  vehicle_type_label: z.string().trim().max(80).default(''),
  vehicle_plate: upperIdentifier.pipe(z.string().min(1, 'Vehicle plate is required')),
  container_number: optionalUpperIdentifier,
  // Optional, like the company: plenty of loads are weighed without anyone
  // naming what is on the truck, and refusing the weighing over it would only
  // get a placeholder typed in. Empty string rather than undefined, so every
  // tier keeps a plain `string`.
  product: z.string().trim().max(120).default(''),
  first_weight_kg: weightKg,
  first_weight_src: weightSourceSchema.default('SERIAL'),
  amount_charged: z.number().finite().min(0).default(0),
  operator_username: z.string().trim().min(1).max(64).default('operator'),
  capture_id: captureToken,
  /**
   * Keep this person in the customer directory.
   *
   * The operator's choice, and off by default. The directory used to fill
   * itself from every weighing, which is right for a yard of regulars and
   * wrong for the lorry that passes through once: a picker with six hundred
   * one-off names in it is a picker nobody can find a regular in.
   *
   * Ticking it for somebody already in the directory does NOT make a second
   * entry — the directory is keyed on name and company, so the existing one
   * is updated with whatever this weighing adds. See CustomerRepository.
   */
  save_customer: z.boolean().default(false),
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
  container_number: optionalUpperIdentifier,
  capture_id: captureToken,
});

export type CompleteWeighmentInput = z.infer<typeof completeWeighmentSchema>;

/**
 * POST /weighments/complete — a weighing finished in one visit.
 *
 * For the customer who already knows his empty weight and says so: the
 * operator types that figure, weighs the loaded truck once, and the slip is
 * printed there and then. No open ticket is ever created, because the truck is
 * not coming back for a second pass.
 *
 * It is the create and the completion in one message rather than two calls,
 * so a failure cannot leave a ticket half-made — either the whole weighing
 * exists or none of it does.
 */
export const createCompletedWeighmentSchema = createWeighmentSchema.extend({
  second_weight_kg: weightKg,
  second_weight_src: weightSourceSchema.default('SERIAL'),
  /** Decided at the same moment here, since there is no second visit. */
  payment_status: paymentStatusSchema.default('PAID'),
  /**
   * Take this slip's photographs from an earlier slip instead of the cameras.
   *
   * For the fourth-weight flow, where both figures come off a slip the driver
   * is holding and no truck is on the bridge at all. Photographing the yard
   * at that moment would put a picture of nothing, or of somebody else's
   * lorry, onto the new slip; the honest picture is the one taken when this
   * truck was last weighed, so that is the one copied across.
   *
   * The second pass's pictures are preferred — the loaded truck, as it left.
   */
  copy_captures_from_slip: z.string().trim().max(32).optional(),
});

export type CreateCompletedWeighmentInput = z.infer<typeof createCompletedWeighmentSchema>;

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
