/** Currency formatting (brief §7.9): PKR, rendered as `Rs 1,234`. */

import { DEFAULT_CURRENCY } from '../constants/domain.js';

const PKR_FORMAT = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

/**
 * `Rs 1,234`. Intl's own `currency: 'PKR'` style renders "PKR 1,234" or
 * "Rs 1,234.00" depending on locale/runtime, and the receipt must look the
 * same on the operator PC, the droplet-rendered page and the PDF — so the
 * prefix is ours, not the runtime's.
 */
export function formatPKR(amount: number): string {
  if (!Number.isFinite(amount)) return 'Rs 0';
  return `Rs ${PKR_FORMAT.format(Math.round(amount))}`;
}

export function formatCurrency(amount: number, currency: string = DEFAULT_CURRENCY): string {
  if (currency === 'PKR') return formatPKR(amount);
  return `${currency} ${PKR_FORMAT.format(Math.round(amount))}`;
}

/** Parse an operator-typed amount ("1,250", "Rs 1250", " 1250 ") to a number. */
export function parseAmount(input: string | number): number {
  if (typeof input === 'number') return Number.isFinite(input) ? input : 0;
  const cleaned = input.replace(/[^0-9.-]/g, '');
  const n = Number.parseFloat(cleaned);
  return Number.isFinite(n) ? n : 0;
}
