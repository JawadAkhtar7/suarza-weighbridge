/**
 * Slip numbers (brief §6) — the human-facing ID the driver carries back for
 * the second weighing, so it must be short, unambiguous and speakable.
 *
 * Two generation modes:
 *  - `counter` (default): `SI-000123`, a zero-padded local counter seeded from
 *    the SQLite max. Matches the printed `SI-XXXXXX` format exactly and is the
 *    easiest for an operator to read off a slip and type back in.
 *  - `station`: `SI-A4K2P9Z`, a station char + 6 base36 chars. Collision-free
 *    across multiple offline stations; switch to this if the client ever adds
 *    a second bridge (the schema already carries `station_id`).
 *
 * Either way the caller MUST pass an `isTaken` check so uniqueness is decided
 * against the local DB before commit — no generator can guarantee it alone.
 */

import { DEFAULT_STATION_ID } from '../constants/domain.js';

export const SLIP_PREFIX = 'SI-';
export const SLIP_COUNTER_DIGITS = 6;
export const SLIP_RANDOM_CHARS = 6;

/** Accepts both modes: `SI-000123` and `SI-A4K2P9Z`. */
export const SLIP_NUMBER_REGEX = /^SI-(?:\d{6}|[A-Z][0-9A-Z]{6})$/;

export type SlipMode = 'counter' | 'station';

const BASE36 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

export function isValidSlipNumber(slip: string): boolean {
  return SLIP_NUMBER_REGEX.test(slip);
}

/** Normalise operator input: trims, uppercases, and adds a missing `SI-`
 *  prefix so typing just the digits off the slip works. */
export function normalizeSlipNumber(input: string): string {
  const raw = input.trim().toUpperCase().replace(/\s+/g, '');
  if (!raw) return '';
  const body = raw.startsWith(SLIP_PREFIX) ? raw.slice(SLIP_PREFIX.length) : raw;
  // A bare counter entry ("123") is padded back to the printed width.
  if (/^\d+$/.test(body) && body.length < SLIP_COUNTER_DIGITS) {
    return SLIP_PREFIX + body.padStart(SLIP_COUNTER_DIGITS, '0');
  }
  return SLIP_PREFIX + body;
}

export function formatCounterSlip(counter: number): string {
  const n = Math.max(0, Math.floor(counter));
  // Past 999999 the counter simply widens rather than wrapping into a
  // collision — a wider slip prints fine, a duplicate does not.
  return SLIP_PREFIX + String(n).padStart(SLIP_COUNTER_DIGITS, '0');
}

function randomBase36(length: number, rng: () => number): string {
  let out = '';
  for (let i = 0; i < length; i++) {
    out += BASE36[Math.floor(rng() * BASE36.length)];
  }
  return out;
}

export function formatStationSlip(stationId: string, rng: () => number = Math.random): string {
  const station = (stationId || DEFAULT_STATION_ID).trim().toUpperCase().charAt(0) || 'A';
  return SLIP_PREFIX + station + randomBase36(SLIP_RANDOM_CHARS, rng);
}

export interface GenerateSlipOptions {
  mode?: SlipMode;
  /** Highest counter already used locally (from `SELECT MAX(...)`). */
  lastCounter?: number;
  stationId?: string;
  /** Uniqueness check against the local DB. Required for a real commit. */
  isTaken?: (slip: string) => boolean;
  /** Attempts before giving up, so a broken `isTaken` can't spin forever. */
  maxAttempts?: number;
  rng?: () => number;
}

export interface GeneratedSlip {
  slipNumber: string;
  /** Next counter value to persist, when mode is `counter`. */
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
  } = options;

  let counter = Math.max(0, Math.floor(lastCounter));

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let candidate: string;
    if (mode === 'counter') {
      counter += 1;
      candidate = formatCounterSlip(counter);
    } else {
      candidate = formatStationSlip(stationId, rng);
    }
    if (!isTaken(candidate)) {
      return { slipNumber: candidate, counter, attempts: attempt };
    }
  }

  throw new Error(
    `Could not generate a unique slip number after ${maxAttempts} attempts (mode=${mode}).`,
  );
}
