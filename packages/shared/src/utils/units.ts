/**
 * Weight maths — the single implementation used by agent, server and both PWAs
 * (brief §2, §7.2). Nothing else in the codebase may compute net weight.
 */

import { KG_PER_MAUND, KG_PER_TON } from '../constants/domain.js';

export interface NetWeight {
  kg: number;
  ton: number;
  maund: number;
}

/**
 * Net weight is the ABSOLUTE difference between the two weighings.
 *
 * Absolute value is deliberate, not defensive: a truck may arrive empty and
 * leave loaded (second > first) or arrive loaded and leave empty (first >
 * second). Both are ordinary at a weighbridge and both yield the same material
 * weight, so the sign carries no information and must not leak into revenue.
 */
export function netWeightKg(firstKg: number, secondKg: number | null | undefined): number {
  if (secondKg === null || secondKg === undefined || !Number.isFinite(secondKg)) return 0;
  if (!Number.isFinite(firstKg)) return 0;
  return Math.abs(firstKg - secondKg);
}

export function kgToTon(kg: number): number {
  return kg / KG_PER_TON;
}

export function kgToMaund(kg: number): number {
  return kg / KG_PER_MAUND;
}

export function tonToKg(ton: number): number {
  return ton * KG_PER_TON;
}

export function maundToKg(maund: number): number {
  return maund * KG_PER_MAUND;
}

/** Round half-away-from-zero at `decimals`, avoiding the float dust that
 *  `toFixed` leaves on values like 1.005. */
export function round(value: number, decimals: number): number {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** decimals;
  // The epsilon nudge keeps 2.0049999999999997 (a real float result of
  // 80.2 / 40) from rounding down to 2.004 at 3dp.
  return Math.sign(value) * (Math.round(Math.abs(value) * factor + Number.EPSILON) / factor);
}

export interface WeightPrecision {
  /** Decimals for kg. Default 0; raise to 3 if the indicator reports grams. */
  kg?: number;
  ton?: number;
  maund?: number;
}

const DEFAULT_PRECISION: Required<WeightPrecision> = { kg: 0, ton: 3, maund: 3 };

/** All three display units for a kg value (brief §2). */
export function toAllUnits(kg: number, precision: WeightPrecision = {}): NetWeight {
  const p = { ...DEFAULT_PRECISION, ...precision };
  return {
    kg: round(kg, p.kg),
    ton: round(kgToTon(kg), p.ton),
    maund: round(kgToMaund(kg), p.maund),
  };
}

/** Convenience: net weight of a weighment, already in all three units. */
export function netWeightAllUnits(
  firstKg: number,
  secondKg: number | null | undefined,
  precision: WeightPrecision = {},
): NetWeight {
  return toAllUnits(netWeightKg(firstKg, secondKg), precision);
}

const NUMBER_FORMATTERS = new Map<number, Intl.NumberFormat>();

function formatter(decimals: number): Intl.NumberFormat {
  let f = NUMBER_FORMATTERS.get(decimals);
  if (!f) {
    f = new Intl.NumberFormat('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
    NUMBER_FORMATTERS.set(decimals, f);
  }
  return f;
}

export function formatKg(kg: number, decimals = DEFAULT_PRECISION.kg): string {
  return `${formatter(decimals).format(round(kg, decimals))} kg`;
}

export function formatTon(ton: number, decimals = DEFAULT_PRECISION.ton): string {
  return `${formatter(decimals).format(round(ton, decimals))} ton`;
}

export function formatMaund(maund: number, decimals = DEFAULT_PRECISION.maund): string {
  return `${formatter(decimals).format(round(maund, decimals))} maund`;
}

/** "12,340 kg · 12.340 ton · 308.500 maund" — the completion-screen line. */
export function formatAllUnits(net: NetWeight, precision: WeightPrecision = {}): string {
  const p = { ...DEFAULT_PRECISION, ...precision };
  return [formatKg(net.kg, p.kg), formatTon(net.ton, p.ton), formatMaund(net.maund, p.maund)].join(
    ' · ',
  );
}
