/**
 * Slip numbers (brief §6) — the human-facing ID the driver carries back for
 * the second weighing, so it must be short, unambiguous and speakable.
 *
 * The format is the year followed by a counter that restarts each year:
 *
 *   20261, 20262, 20263 … 2026147 …   then 20271 on the first of January
 *
 * Plain digits, deliberately. It used to be `SI-000123`, which meant the
 * operator typing a slip back in had to find the letters, then the dash, then
 * pad the number with zeros — four chances to mistype on a keyboard in a
 * weighbridge cabin, for an ID that is only ever read off a slip and typed
 * straight back. The year carries the only information the prefix ever did:
 * which run of numbers this slip belongs to.
 *
 * The year is always four digits, so a slip number splits unambiguously into
 * the year and the sequence no matter how long the sequence grows.
 *
 * The caller MUST pass an `isTaken` check so uniqueness is decided against the
 * local DB before commit — no generator can guarantee it alone.
 */

import { DEFAULT_STATION_ID } from '../constants/domain.js';

/** Four digits of year, then at least one of sequence. */
export const SLIP_NUMBER_REGEX = /^\d{5,}$/;

/**
 * Years a four-digit prefix is believed to be.
 *
 * This is what lets `normalizeSlipNumber` tell "20265" (slip 5 of 2026) from
 * "10000" (slip 10000 of this year, typed without its prefix). Without a
 * bounded range the two are the same string of digits with two meanings.
 */
const EARLIEST_YEAR = 2020;
const LATEST_YEAR = 2099;

export type SlipMode = 'counter' | 'station';

export function isValidSlipNumber(slip: string): boolean {
  if (!SLIP_NUMBER_REGEX.test(slip)) return false;
  const year = Number(slip.slice(0, 4));
  return year >= EARLIEST_YEAR && year <= LATEST_YEAR;
}

/** The year a slip belongs to, or null if it is not a slip number. */
export function slipYear(slip: string): number | null {
  return isValidSlipNumber(slip) ? Number(slip.slice(0, 4)) : null;
}

/** Its sequence within that year, or null. */
export function slipSequence(slip: string): number | null {
  return isValidSlipNumber(slip) ? Number(slip.slice(4)) : null;
}

/**
 * The shape slip numbers had before this one: `SI-` and six padded digits.
 *
 * Nothing generates these any more. They stay recognised because records
 * written by an older agent are already in SQLite and in Mongo, and a stored
 * record that cannot be validated is a record that can never sync, never be
 * read back, and never be corrected — the cloud would reject the batch
 * forever. Tolerating the old shape on the way IN costs nothing; what matters
 * is that nothing new is ever minted in it.
 */
export const LEGACY_SLIP_NUMBER_REGEX = /^SI-\d{6}$/;

export function isLegacySlipNumber(slip: string): boolean {
  return LEGACY_SLIP_NUMBER_REGEX.test(slip);
}

/**
 * Is this a slip number some version of this software could have issued?
 *
 * Use this to validate a record that already exists. Use `isValidSlipNumber`
 * for anything that decides what a NEW number looks like.
 */
export function isStorableSlipNumber(slip: string): boolean {
  return isValidSlipNumber(slip) || isLegacySlipNumber(slip);
}

export function currentSlipYear(now: Date = new Date()): number {
  return now.getFullYear();
}

export function formatCounterSlip(counter: number, year = currentSlipYear()): string {
  // Never zero: a slip numbered 20260 would read as year 2026, sequence 0,
  // and the first slip of a year is the first, not the zeroth.
  const n = Math.max(1, Math.floor(counter));
  return `${year}${n}`;
}

/**
 * Normalise operator input.
 *
 * The second-weighing screen shows the year as a fixed prefix and the operator
 * types only the sequence, so what arrives is usually already complete. This
 * still accepts a bare sequence, because the manager's search box has no such
 * prefix and somebody will type "5" there.
 *
 * Anything that is not already a plausible year-and-sequence is read as a
 * sequence in the current year. That is what makes "10000" the ten-thousandth
 * slip of this year rather than a slip from the year 1000.
 */
export function normalizeSlipNumber(input: string, now: Date = new Date()): string {
  // An old SI- number is still printed on slips in the office drawer, and the
  // record it names is still in the database. Pass it through untouched rather
  // than stripping it down to digits that would name a different slip.
  const trimmed = input.trim().toUpperCase();
  if (isLegacySlipNumber(trimmed)) return trimmed;

  const digits = input.replace(/\D+/g, '');
  if (!digits) return '';
  if (isValidSlipNumber(digits)) return digits;
  return formatCounterSlip(Number(digits), currentSlipYear(now));
}

const BASE36 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

function randomBase36(length: number, rng: () => number): string {
  let out = '';
  for (let i = 0; i < length; i++) {
    out += BASE36[Math.floor(rng() * BASE36.length)];
  }
  return out;
}

/**
 * The multi-station form: year, station digit, then six random base-36 chars.
 *
 * Unused today — there is one weighbridge. It stays because the schema already
 * carries `station_id`, and because two offline stations sharing a counter
 * would hand out the same number to two different trucks.
 */
export const SLIP_RANDOM_CHARS = 6;

export function formatStationSlip(
  stationId: string,
  rng: () => number = Math.random,
  year = currentSlipYear(),
): string {
  const station = (stationId || DEFAULT_STATION_ID).trim().toUpperCase().charAt(0) || 'A';
  return `${year}${station}${randomBase36(SLIP_RANDOM_CHARS, rng)}`;
}

export interface GenerateSlipOptions {
  mode?: SlipMode;
  /** Highest sequence already used THIS YEAR (from `SELECT MAX(...)`). */
  lastCounter?: number;
  stationId?: string;
  /** Uniqueness check against the local DB. Required for a real commit. */
  isTaken?: (slip: string) => boolean;
  /** Attempts before giving up, so a broken `isTaken` can't spin forever. */
  maxAttempts?: number;
  rng?: () => number;
  /** The year to number within. Defaults to today's. */
  year?: number;
}

export interface GeneratedSlip {
  slipNumber: string;
  /** Next sequence value to persist, when mode is `counter`. */
  counter: number;
  attempts: number;
}

/**
 * Generate a slip number that is unique in the local DB.
 *
 * Collisions are expected to be rare but are handled rather than assumed away:
 * in `counter` mode a taken number just advances the counter (which is what a
 * half-written previous run leaves behind), and in `station` mode it redraws.
 */
export function generateSlipNumber(options: GenerateSlipOptions = {}): GeneratedSlip {
  const {
    mode = 'counter',
    lastCounter = 0,
    stationId = DEFAULT_STATION_ID,
    isTaken = () => false,
    maxAttempts = 1000,
    rng = Math.random,
    year = currentSlipYear(),
  } = options;

  let counter = Math.max(0, Math.floor(lastCounter));

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let candidate: string;
    if (mode === 'counter') {
      counter += 1;
      candidate = formatCounterSlip(counter, year);
    } else {
      candidate = formatStationSlip(stationId, rng, year);
    }
    if (!isTaken(candidate)) {
      return { slipNumber: candidate, counter, attempts: attempt };
    }
  }

  throw new Error(
    `Could not generate a unique slip number after ${maxAttempts} attempts (mode=${mode}).`,
  );
}
