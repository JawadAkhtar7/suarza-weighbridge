/**
 * The two shifts a weighbridge runs, and who is on them.
 *
 * A weighing does not record which shift it belonged to, and deliberately so:
 * the shift is a fact about the clock, and the clock is already on the record.
 * Working it out from `first_weight_at` means a shift's boundaries can be
 * corrected later and every past weighing re-reads correctly, where a stored
 * label would be wrong for ever.
 *
 * The roster is the other half — which person was on which shift — and that
 * one IS a fact about today rather than about the record. A slip from last
 * month shows whoever holds that shift now. The alternative is stamping the
 * name onto every weighing, which the weighbridge has no way to know: it has
 * one login, used by whoever is at the window.
 */

export const SHIFTS = ['MORNING', 'NIGHT'] as const;
export type Shift = (typeof SHIFTS)[number];

export const SHIFT_LABELS: Record<Shift, string> = {
  MORNING: 'Morning',
  NIGHT: 'Night',
};

/**
 * When each shift starts, as minutes from midnight.
 *
 * Only the two starts are stored, because the two shifts divide the whole day
 * between them: each runs until the other begins. Storing four numbers would
 * let a yard be configured with a gap in it, or an overlap, and a weighing
 * that falls in either belongs to no shift or to both.
 *
 * The defaults are the client's: morning 8am to 8pm, night 8pm to 8am.
 */
export const DEFAULT_SHIFT_START_MINUTES: Record<Shift, number> = {
  MORNING: 8 * 60,
  NIGHT: 20 * 60,
};

/** `08:00` from 480, for an input the manager types into. */
export function minutesToClock(minutes: number): string {
  const whole = ((Math.round(minutes) % 1440) + 1440) % 1440;
  const hours = Math.floor(whole / 60);
  return `${String(hours).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}`;
}

/** 480 from `08:00`, or null for anything that is not a time of day. */
export function clockToMinutes(clock: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(clock.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/**
 * Which shift a moment belongs to.
 *
 * Works for a night shift that crosses midnight, which is the whole
 * difficulty: with morning at 08:00 and night at 20:00, 23:00 and 02:00 are
 * both night even though one is before midnight and the other after. So the
 * question asked is "has the morning started and not yet ended", and
 * everything else is night.
 *
 * `timeZone` matters because the cloud runs in New York and the yard is in
 * Pakistan: 09:00 at the bridge is the morning shift whatever the server
 * thinks the hour is.
 */
export function shiftAt(
  when: Date | string,
  starts: Record<Shift, number> = DEFAULT_SHIFT_START_MINUTES,
  timeZone = 'Asia/Karachi',
): Shift {
  const at = typeof when === 'string' ? new Date(when) : when;
  const minutes = minutesOfDay(at, timeZone);

  const morning = ((starts.MORNING % 1440) + 1440) % 1440;
  const night = ((starts.NIGHT % 1440) + 1440) % 1440;
  if (morning === night) return 'MORNING';

  // The morning runs from its start until the night's. Written as a half-open
  // range so a weighing taken exactly at 20:00 is night, not both.
  const inMorning =
    morning < night
      ? minutes >= morning && minutes < night
      : // The MORNING is the one crossing midnight in this configuration.
        minutes >= morning || minutes < night;

  return inMorning ? 'MORNING' : 'NIGHT';
}

/** Minutes past midnight at the bridge, whatever clock the machine keeps. */
function minutesOfDay(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(at);

  const read = (type: 'hour' | 'minute') =>
    Number(parts.find((p) => p.type === type)?.value ?? '0');
  // Some runtimes render midnight as 24; both mean the same minute of the day.
  return (read('hour') % 24) * 60 + read('minute');
}
