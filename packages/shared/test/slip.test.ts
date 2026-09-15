import { describe, expect, it } from 'vitest';
import {
  formatCounterSlip,
  formatStationSlip,
  generateSlipNumber,
  isValidSlipNumber,
  normalizeSlipNumber,
} from '../src/utils/slip.js';

describe('slip formatting', () => {
  it('zero-pads the counter to the printed width', () => {
    expect(formatCounterSlip(1)).toBe('SI-000001');
    expect(formatCounterSlip(123456)).toBe('SI-123456');
  });

  it('widens rather than wrapping past the six-digit ceiling', () => {
    // A wider slip still prints; a wrapped one would collide.
    expect(formatCounterSlip(1234567)).toBe('SI-1234567');
  });

  it('builds a station slip as station char + 6 base36 chars', () => {
    const slip = formatStationSlip('A', () => 0.5);
    expect(slip).toMatch(/^SI-A[0-9A-Z]{6}$/);
  });
});

describe('isValidSlipNumber', () => {
  it('accepts both counter and station formats', () => {
    expect(isValidSlipNumber('SI-000123')).toBe(true);
    expect(isValidSlipNumber('SI-A4K2P9Z')).toBe(true);
  });

  it('rejects malformed input', () => {
    for (const bad of ['123456', 'SI-12345', 'si-000123', 'SI-', 'XX-000123', 'SI-00012A']) {
      expect(isValidSlipNumber(bad)).toBe(false);
    }
  });
});

describe('normalizeSlipNumber', () => {
  it('accepts what an operator actually types off a printed slip', () => {
    expect(normalizeSlipNumber('si-000123')).toBe('SI-000123');
    expect(normalizeSlipNumber('  SI-000123 ')).toBe('SI-000123');
    expect(normalizeSlipNumber('123')).toBe('SI-000123');
    expect(normalizeSlipNumber('000123')).toBe('SI-000123');
  });

  it('leaves an empty entry empty rather than inventing a slip', () => {
    expect(normalizeSlipNumber('   ')).toBe('');
  });
});

describe('generateSlipNumber uniqueness', () => {
  it('continues from the last local counter', () => {
    const result = generateSlipNumber({ lastCounter: 41 });
    expect(result.slipNumber).toBe('SI-000042');
    expect(result.counter).toBe(42);
  });

  it('skips numbers already taken in the local DB', () => {
    const taken = new Set(['SI-000042', 'SI-000043']);
    const result = generateSlipNumber({ lastCounter: 41, isTaken: (s) => taken.has(s) });
    expect(result.slipNumber).toBe('SI-000044');
    expect(result.attempts).toBe(3);
  });

  it('generates 5000 distinct numbers in counter mode', () => {
    const seen = new Set<string>();
    let counter = 0;
    for (let i = 0; i < 5000; i++) {
      const r = generateSlipNumber({ lastCounter: counter, isTaken: (s) => seen.has(s) });
      expect(seen.has(r.slipNumber)).toBe(false);
      seen.add(r.slipNumber);
      counter = r.counter;
    }
    expect(seen.size).toBe(5000);
  });

  it('redraws on collision in station mode', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i++) {
      const r = generateSlipNumber({
        mode: 'station',
        stationId: 'B',
        isTaken: (s) => seen.has(s),
      });
      expect(r.slipNumber).toMatch(/^SI-B[0-9A-Z]{6}$/);
      expect(seen.has(r.slipNumber)).toBe(false);
      seen.add(r.slipNumber);
    }
  });

  it('throws rather than returning a duplicate when it cannot find a free number', () => {
    expect(() =>
      generateSlipNumber({ mode: 'station', isTaken: () => true, maxAttempts: 10 }),
    ).toThrow(/unique slip number/i);
  });

  it('always produces a number that passes validation', () => {
    for (let i = 0; i < 200; i++) {
      expect(isValidSlipNumber(generateSlipNumber({ lastCounter: i }).slipNumber)).toBe(true);
      expect(isValidSlipNumber(generateSlipNumber({ mode: 'station' }).slipNumber)).toBe(true);
    }
  });
});
