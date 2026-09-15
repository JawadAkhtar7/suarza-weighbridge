import { describe, expect, it } from 'vitest';
import {
  formatAllUnits,
  formatKg,
  formatMaund,
  formatTon,
  kgToMaund,
  kgToTon,
  maundToKg,
  netWeightAllUnits,
  netWeightKg,
  round,
  toAllUnits,
  tonToKg,
} from '../src/utils/units.js';

describe('netWeightKg', () => {
  it('returns the difference when the truck arrives empty and leaves loaded', () => {
    expect(netWeightKg(8000, 20000)).toBe(12000);
  });

  it('returns the same magnitude when the truck arrives loaded and leaves empty', () => {
    // The absolute value is the whole point: material weight is identical
    // whichever order the two weighings happened in.
    expect(netWeightKg(20000, 8000)).toBe(12000);
  });

  it('is symmetric for every pair', () => {
    const pairs: Array<[number, number]> = [
      [0, 0],
      [1, 2],
      [15320, 9875],
      [42_000, 41_999.5],
    ];
    for (const [a, b] of pairs) {
      expect(netWeightKg(a, b)).toBe(netWeightKg(b, a));
    }
  });

  it('is 0 while the second weight is still pending', () => {
    expect(netWeightKg(8000, null)).toBe(0);
    expect(netWeightKg(8000, undefined)).toBe(0);
  });

  it('never returns a negative or non-finite value', () => {
    expect(netWeightKg(8000, 20000)).toBeGreaterThanOrEqual(0);
    expect(netWeightKg(Number.NaN, 100)).toBe(0);
    expect(netWeightKg(100, Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe('unit conversions', () => {
  it('converts kg to ton at 1000 kg', () => {
    expect(kgToTon(1000)).toBe(1);
    expect(kgToTon(12500)).toBe(12.5);
  });

  it('converts kg to maund at 40 kg (Pakistan standard)', () => {
    expect(kgToMaund(40)).toBe(1);
    expect(kgToMaund(12000)).toBe(300);
  });

  it('round-trips both directions', () => {
    expect(tonToKg(kgToTon(7345))).toBeCloseTo(7345, 9);
    expect(maundToKg(kgToMaund(7345))).toBeCloseTo(7345, 9);
  });
});

describe('toAllUnits', () => {
  it('reports kg to 0dp and ton/maund to 3dp by default', () => {
    expect(toAllUnits(12345)).toEqual({ kg: 12345, ton: 12.345, maund: 308.625 });
  });

  it('honours a grams-capable indicator via kg precision', () => {
    expect(toAllUnits(1234.567, { kg: 3 }).kg).toBe(1234.567);
  });

  it('rounds float dust rather than propagating it', () => {
    // 80.2 / 40 is 2.0049999999999997 in IEEE-754.
    expect(round(80.2 / 40, 3)).toBe(2.005);
  });
});

describe('netWeightAllUnits', () => {
  it('gives the three receipt figures from the two weighings', () => {
    expect(netWeightAllUnits(9_000, 21_000)).toEqual({ kg: 12000, ton: 12, maund: 300 });
  });
});

describe('formatting', () => {
  it('formats each unit with a thousands separator and label', () => {
    expect(formatKg(12345)).toBe('12,345 kg');
    expect(formatTon(12.345)).toBe('12.345 ton');
    expect(formatMaund(308.625)).toBe('308.625 maund');
  });

  it('renders the completion-screen line', () => {
    expect(formatAllUnits(toAllUnits(12345))).toBe('12,345 kg · 12.345 ton · 308.625 maund');
  });
});
