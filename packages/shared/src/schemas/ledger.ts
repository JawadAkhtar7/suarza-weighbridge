/**
 * Customer ledgers (client requirement, after M9).
 *
 * One running account per customer, in rupees. Two things move it:
 *
 *  - a completed weighing DEBITS the customer by the amount charged
 *  - a payment CREDITS them
 *
 * The balance is `credits − debits`, which makes the sign say what everyone
 * actually wants to know:
 *
 *      negative  →  the customer owes the business  (the normal state)
 *      positive  →  the customer has paid in advance
 *      zero      →  settled
 *
 * Nothing is ever deleted or edited. A mistake is corrected by voiding the
 * entry, which leaves it visible in the history and out of the balance — the
 * same rule the weighments follow, and for the same reason: a ledger that can
 * be quietly rewritten is not evidence of anything.
 */

import { z } from 'zod';

/**
 * Which way an entry moves the balance.
 *
 * Named from the customer's account as the business keeps it, which is the
 * convention the client described: a charge is a debit against them, a payment
 * is a credit to them.
 */
export const LEDGER_DIRECTIONS = ['DEBIT', 'CREDIT'] as const;
export const ledgerDirectionSchema = z.enum(LEDGER_DIRECTIONS);
export type LedgerDirection = (typeof LEDGER_DIRECTIONS)[number];

/**
 * Why the entry exists. Kept separate from the direction because "why" and
 * "which way" are different questions — an ADJUSTMENT can go either way, and a
 * report that groups by reason should not have to infer it from the sign.
 */
export const LEDGER_KINDS = ['WEIGHING', 'PAYMENT', 'ADJUSTMENT'] as const;
export const ledgerKindSchema = z.enum(LEDGER_KINDS);
export type LedgerKind = (typeof LEDGER_KINDS)[number];

export const LEDGER_KIND_LABELS: Record<LedgerKind, string> = {
  WEIGHING: 'Weighing charge',
  PAYMENT: 'Payment received',
  ADJUSTMENT: 'Adjustment',
};

/**
 * The ledger's words in Urdu, beside the English rather than instead of it.
 *
 * The screen is read by people who have never used an accounts package, and
 * "debit" and "credit" are the two words that lose them. Kept in one table so
 * the two languages cannot drift apart across the pages that show them, and so
 * a correction to the wording is one edit.
 */
export const LEDGER_KIND_URDU: Record<LedgerKind, string> = {
  WEIGHING: 'وزن کا چارج',
  PAYMENT: 'وصول شدہ رقم',
  ADJUSTMENT: 'ترمیم',
};

export const LEDGER_URDU = {
  ledger: 'کھاتہ',
  customers: 'کسٹمرز',
  customer: 'کسٹمر',
  company: 'کمپنی',
  phone: 'فون نمبر',
  id: 'شناختی نمبر',
  matchKey: 'ملاپ کی کلید',
  balance: 'بقایا',
  owes: 'واجب الادا',
  inCredit: 'جمع شدہ',
  settled: 'حساب برابر',
  totalOwed: 'کل واجب الادا رقم',
  heldInAdvance: 'پیشگی جمع شدہ رقم',
  charged: 'کل چارج',
  paid: 'کل ادائیگی',
  entries: 'اندراجات',
  statement: 'کھاتہ کی تفصیل',
  date: 'تاریخ',
  detail: 'تفصیل',
  debit: 'ڈیبٹ (چارج)',
  credit: 'کریڈٹ (ادائیگی)',
  recordPayment: 'ادائیگی درج کریں',
  adjustment: 'ترمیم کریں',
  amount: 'رقم',
  note: 'تفصیل',
  reason: 'وجہ',
  void: 'منسوخ کریں',
  voided: 'منسوخ شدہ',
  search: 'تلاش کریں',
  all: 'سب',
  nothingYet: 'ابھی کوئی اندراج نہیں',
  cancel: 'منسوخ',
  save: 'محفوظ کریں',
  customerOwesMore: 'کسٹمر پر مزید واجب الادا',
  customerOwesLess: 'کسٹمر پر کم واجب الادا',
} as const;

/**
 * Rupees. Non-negative and at most two decimals — the direction carries the
 * sign, so a negative amount here would be a second way to say the same thing
 * and the two could disagree.
 */
export const ledgerAmountSchema = z
  .number()
  .finite()
  .positive('Amount must be more than zero')
  .max(100_000_000)
  .refine((value) => Math.round(value * 100) === value * 100, 'At most two decimal places');

/**
 * How a customer is identified across the tiers.
 *
 * The weighbridge has no customer registry an operator maintains — customers
 * appear by being weighed — so identity is the pair the operator actually
 * types. Matching is case- and space-insensitive, mirroring the agent's
 * `LOWER(name), LOWER(company)` unique index, so "Ali Raza" and "ali  raza"
 * are one account rather than two half-paid ones.
 */
export function customerKey(name: string, company: string): string {
  const normalise = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ');
  return `${normalise(name)}|${normalise(company)}`;
}

export const ledgerCustomerSchema = z.object({
  /** The database's own id. Opaque, permanent, and what URLs and entries use. */
  id: z.string().min(1),
  /**
   * `customerKey(name, company)` — how a weighing finds its account.
   *
   * Separate from the id because the two answer different questions: the id
   * never changes, while this is derived from what the operator typed and is
   * the thing to look at when a customer's weighings land in the wrong place.
   */
  match_key: z.string(),
  name: z.string(),
  company: z.string(),
  phone: z.string().nullable().default(null),
  /** credits − debits, over entries that are not voided. */
  balance_pkr: z.number(),
  /** Charged by weighings, all time. */
  total_charged_pkr: z.number().default(0),
  /** Paid by the customer, all time. */
  total_paid_pkr: z.number().default(0),
  entry_count: z.number().int().min(0).default(0),
  last_entry_at: z.string().datetime({ offset: true }).nullable().default(null),
});

export type LedgerCustomer = z.infer<typeof ledgerCustomerSchema>;

export const ledgerEntrySchema = z.object({
  id: z.string(),
  customer_id: z.string(),
  direction: ledgerDirectionSchema,
  kind: ledgerKindSchema,
  amount_pkr: z.number(),
  /** When it happened, as against when it was typed in. Drives the ordering. */
  at: z.string().datetime({ offset: true }),
  note: z.string().nullable().default(null),
  /** Set on a WEIGHING entry: the slip it came from, for the audit trail. */
  weighment_id: z.string().nullable().default(null),
  slip_number: z.string().nullable().default(null),
  created_by: z.string(),
  created_at: z.string().datetime({ offset: true }),
  voided: z.boolean().default(false),
  voided_at: z.string().datetime({ offset: true }).nullable().default(null),
  voided_by: z.string().nullable().default(null),
  void_reason: z.string().nullable().default(null),
});

export type LedgerEntry = z.infer<typeof ledgerEntrySchema>;

/** An entry plus the balance as it stood after it — what a statement shows. */
export const ledgerEntryWithBalanceSchema = ledgerEntrySchema.extend({
  balance_after_pkr: z.number(),
});

export type LedgerEntryWithBalance = z.infer<typeof ledgerEntryWithBalanceSchema>;

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

/**
 * A manual entry: a payment received, or a correction.
 *
 * WEIGHING is not offered — those are posted by the system from completed
 * slips, and letting someone type one by hand would put a charge in the ledger
 * that no weighbridge record backs up.
 */
export const createLedgerEntrySchema = z.object({
  direction: ledgerDirectionSchema,
  kind: z.enum(['PAYMENT', 'ADJUSTMENT']),
  amount_pkr: ledgerAmountSchema,
  /** Defaults to now. Lets a payment taken yesterday be recorded today. */
  at: z.string().datetime({ offset: true }).optional(),
  note: z.string().trim().max(500).optional(),
});

export type CreateLedgerEntryInput = z.infer<typeof createLedgerEntrySchema>;

export const voidLedgerEntrySchema = z.object({
  reason: z.string().trim().min(1, 'A reason is required').max(300),
});

export const ledgerQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  /** `owing` is the one people actually want; it is why this page exists. */
  status: z.enum(['all', 'owing', 'credit', 'settled']).default('all'),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(200).default(25),
});

export type LedgerQuery = z.infer<typeof ledgerQuerySchema>;

export const ledgerSummarySchema = z.object({
  /** What the business is owed, across every customer in the red. */
  total_receivable_pkr: z.number(),
  /** What it holds in advances, across every customer in the black. */
  total_advance_pkr: z.number(),
  customers_owing: z.number().int().min(0),
  customers_in_credit: z.number().int().min(0),
});

export type LedgerSummary = z.infer<typeof ledgerSummarySchema>;

// ---------------------------------------------------------------------------
// Presentation
// ---------------------------------------------------------------------------

export type BalanceState = 'owing' | 'credit' | 'settled';

/**
 * `-0.004` is zero to anyone reading a receipt, so the state is decided on the
 * rounded rupee rather than the raw float — otherwise a settled account can
 * show as owing because of an arithmetic remainder.
 */
export function balanceState(balancePkr: number): BalanceState {
  const rounded = Math.round(balancePkr * 100) / 100;
  if (rounded < 0) return 'owing';
  if (rounded > 0) return 'credit';
  return 'settled';
}

/** Plain words, because "negative balance" is not how anyone says it out loud. */
export function balanceLabel(balancePkr: number): string {
  switch (balanceState(balancePkr)) {
    case 'owing':
      return 'Owes';
    case 'credit':
      return 'In credit';
    case 'settled':
      return 'Settled';
  }
}

/** The signed effect of an entry on the balance. */
export function signedAmount(direction: LedgerDirection, amountPkr: number): number {
  return direction === 'CREDIT' ? amountPkr : -amountPkr;
}
