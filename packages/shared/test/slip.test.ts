import { describe, expect, it } from 'vitest';
import {
  currentSlipYear,
  formatCounterSlip,
  isLegacySlipNumber,
  isStorableSlipNumber,
  formatStationSlip,
  generateSlipNumber,
  isValidSlipNumber,
  normalizeSlipNumber,
  slipSequence,
  slipYear,
} from '../src/utils/slip.js';

const YEAR = 2026;

describe('slip formatting', () => {
  it('is the year followed by the sequence, with no padding', () => {
    // Plain digits: the operator types this back off a creased slip, and every
    // extra character is a chance to mistype.
    expect(formatCounterSlip(1, YEAR)).toBe('20261');
    expect(formatCounterSlip(42, YEAR)).toBe('202642');
    expect(formatCounterSlip(123456, YEAR)).toBe('2026123456');
  });

  it('starts the year at one, never zero', () => {
    // 20260 would read as sequence zero, and the first slip of a year is the
    // first. It also keeps the number five digits wide from the very first one.
    expect(formatCounterSlip(0, YEAR)).toBe('20261');
    expect(formatCounterSlip(-5, YEAR)).toBe('20261');
  });

  it('splits back into the year and the sequence it was built from', () => {
    expect(slipYear('202642')).toBe(YEAR);
    expect(slipSequence('202642')).toBe(42);
    expect(slipYear('not a slip')).toBeNull();
  });

  it('builds a station slip as year + station char + 6 base36 chars', () => {
    expect(formatStationSlip('A', () => 0.5, YEAR)).toMatch(/^2026A[0-9A-Z]{6}$/);
  });
});

describe('isValidSlipNumber', () => {
  it('accepts a year and at least one digit of sequence', () => {
    expect(isValidSlipNumber('20261')).toBe(true);
    expect(isValidSlipNumber('2026123456')).toBe(true);
  });

  it('rejects anything that is not one', () => {
    for (const bad of ['', '2026', '123', 'SI-000123', '20 261', '2026a', '19991']) {
      expect(isValidSlipNumber(bad), bad).toBe(false);
    }
  });
});

describe('the old SI-000123 numbers', () => {
  /*
   * Records issued before the format changed are still in SQLite and in Mongo.
   * They must stay readable and stay syncable — a stored record that fails
   * validation can never reach the cloud, so the agent would retry the same
   * batch forever. What must NOT happen is a new one being minted.
   */
  it('recognises the old shape', () => {
    expect(isLegacySlipNumber('SI-000123')).toBe(true);
    expect(isLegacySlipNumber('SI-999999')).toBe(true);
  });

  it('insists on exactly six digits after the prefix', () => {
    for (const bad of ['SI-00123', 'SI-0001234', 'SI-', 'si-000123', 'SI 000123']) {
      expect(isLegacySlipNumber(bad), bad).toBe(false);
    }
  });

  it('accepts both shapes when validating a record that already exists', () => {
    expect(isStorableSlipNumber('SI-000123')).toBe(true);
    expect(isStorableSlipNumber('20261')).toBe(true);
    expect(isStorableSlipNumber('nonsense')).toBe(false);
  });

  it('still refuses the old shape wherever a NEW number is decided', () => {
    // isValidSlipNumber is what normalisation and the counter are built on,
    // so this is the guarantee that nothing re-introduces the old format.
    expect(isValidSlipNumber('SI-000123')).toBe(false);
  });

  it('never generates one', () => {
    for (let i = 0; i < 100; i++) {
      expect(generateSlipNumber({ lastCounter: i }).slipNumber).not.toMatch(/^SI-/);
    }
  });

  it('finds the record when an old number is typed into a search box', () => {
    // Stripping it to digits would have turned SI-000020 into slip 20 of this
    // year — a different truck's slip, which is worse than not finding it.
    expect(normalizeSlipNumber('SI-000020')).toBe('SI-000020');
    expect(normalizeSlipNumber('  si-000020  ')).toBe('SI-000020');
  });
});

describe('normalizeSlipNumber', () => {
  const now = new Date('2026-06-15T10:00:00.000Z');

  it('prefixes the year when the operator types only the sequence', () => {
    // Which is what the second-weighing box asks for: the year is printed
    // beside the field, so only the part after it is typed.
    expect(normalizeSlipNumber('5', now)).toBe('20265');
    expect(normalizeSlipNumber('42', now)).toBe('202642');
  });

  it('leaves a whole slip number alone', () => {
    expect(normalizeSlipNumber('20265', now)).toBe('20265');
    expect(normalizeSlipNumber(' 2026 42 ', now)).toBe('202642');
  });

  it('reads a long sequence as a sequence, not as a year', () => {
    /*
     * The one genuinely ambiguous case. "10000" is five digits, the same shape
     * as a slip number — but 1000 is not a year this software will ever run in,
     * so it is the ten-thousandth slip of the current year. Without the year
     * range the two readings are the same string.
     */
    expect(normalizeSlipNumber('10000', now)).toBe('202610000');
  });

  it('leaves an empty entry empty rather than inventing a slip', () => {
    expect(normalizeSlipNumber('   ', now)).toBe('');
    expect(normalizeSlipNumber('abc', now)).toBe('');
  });
});

describe('generateSlipNumber uniqueness', () => {
  it('continues from the last sequence used this year', () => {
    const result = generateSlipNumber({ lastCounter: 41, year: YEAR });
    expect(result.slipNumber).toBe('202642');
    expect(result.counter).toBe(42);
  });

  it('starts again at one in a new year', () => {
    // The counter is per year, so January does not continue December's run.
    expect(generateSlipNumber({ lastCounter: 0, year: 2027 }).slipNumber).toBe('20271');
  });

  it('skips numbers already taken in the local DB', () => {
    const taken = new Set(['202642', '202643']);
    const result = generateSlipNumber({ lastCounter: 41, year: YEAR, isTaken: (s) => taken.has(s) });
    expect(result.slipNumber).toBe('202644');
    expect(result.attempts).toBe(3);
  });

  it('generates 5000 distinct numbers in counter mode', () => {
    const seen = new Set<string>();
    let counter = 0;
    for (let i = 0; i < 5000; i++) {
      const r = generateSlipNumber({ lastCounter: counter, year: YEAR, isTaken: (s) => seen.has(s) });
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
        year: YEAR,
        isTaken: (s) => seen.has(s),
      });
      expect(r.slipNumber).toMatch(/^2026B[0-9A-Z]{6}$/);
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
    }
  });

  it('numbers in the current year unless told otherwise', () => {
    const slip = generateSlipNumber({ lastCounter: 7 }).slipNumber;
    expect(slipYear(slip)).toBe(currentSlipYear());
    expect(slipSequence(slip)).toBe(8);
  });
});
