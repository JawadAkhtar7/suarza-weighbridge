/**
 * Time handling (brief §6, §12): store UTC everywhere, display Pakistan time.
 *
 * Intl does the zone conversion so no tz database ships with the bundle, and
 * PKT has no DST — but going through Intl rather than a hardcoded +5 offset
 * keeps the display correct if that ever changes.
 */

import { DISPLAY_TIMEZONE } from '../constants/domain.js';

/** Current instant as a UTC ISO string — the only way timestamps are minted. */
export function nowUtc(): string {
  return new Date().toISOString();
}

export function toUtcIso(value: Date | string | number): string {
  return new Date(value).toISOString();
}

function fmt(options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat('en-GB', { timeZone: DISPLAY_TIMEZONE, ...options });
}

/** `14 Sep 2026` */
export function formatDatePkt(value: Date | string | number): string {
  return fmt({ day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(value));
}

/** `03:42 PM` */
export function formatTimePkt(value: Date | string | number): string {
  return fmt({ hour: '2-digit', minute: '2-digit', hour12: true }).format(new Date(value));
}

/** `14 Sep 2026, 03:42 PM` — the receipt and table format. */
export function formatDateTimePkt(value: Date | string | number): string {
  return `${formatDatePkt(value)}, ${formatTimePkt(value)}`;
}

/** `2026-09-14` in PKT — used to bucket analytics by local day, not UTC day. */
export function pktDateKey(value: Date | string | number): string {
  const parts = fmt({ year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(
    new Date(value),
  );
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}
