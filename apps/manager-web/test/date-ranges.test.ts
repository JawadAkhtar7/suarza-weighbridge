/**
 * Quick date ranges (brief §9).
 *
 * These decide which day a weighing counts towards, so they are tested against
 * Pakistan time rather than the machine's. A boundary that is an hour out moves
 * revenue between days.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { QUICK_RANGES, RANGE_LABELS, resolveRange } from '../src/lib/date-ranges.js';

afterEach(() => vi.useRealTimers());

/** 14 Sep 2026, 02:30 UTC — which is 07:30 the same day in Pakistan. */
const MORNING_UTC = new Date('2026-09-14T02:30:00.000Z');
/** 13 Sep 2026, 21:00 UTC — which is already 02:00 on the 14th in Pakistan. */
const LATE_EVENING_UTC = new Date('2026-09-13T21:00:00.000Z');

describe('resolveRange — today', () => {
  it('spans the Pakistan day, not the UTC day', () => {
    vi.setSystemTime(MORNING_UTC);
    const range = resolveRange('today');

    // Midnight PKT on the 14th is 19:00 UTC on the 13th.
    expect(range.from).toBe('2026-09-13T19:00:00.000Z');
    expect(new Date(range.to!).toISOString()).toMatch(/^2026-09-14T18:59:59/);
  });

  it('still means "today in Pakistan" when UTC is still on yesterday', () => {
    // 02:00 on the 14th locally. A UTC-based range would report the 13th and
    // silently hide the morning's weighings.
    vi.setSystemTime(LATE_EVENING_UTC);
    const range = resolveRange('today');
    expect(range.from).toBe('2026-09-13T19:00:00.000Z');
  });
});

describe('resolveRange — the other quick ranges', () => {
  it('yesterday is the whole previous Pakistan day', () => {
    vi.setSystemTime(MORNING_UTC);
    const range = resolveRange('yesterday');
    expect(range.from).toBe('2026-09-12T19:00:00.000Z');
    expect(new Date(range.to!).toISOString()).toMatch(/^2026-09-13T18:59:59/);
  });

  it('last 7 days includes today, so it is 7 days not 8', () => {
    vi.setSystemTime(MORNING_UTC);
    const range = resolveRange('last7');
    expect(range.from).toBe('2026-09-07T19:00:00.000Z');
    expect(new Date(range.to!).toISOString()).toMatch(/^2026-09-14T18:59:59/);
  });

  it('last month goes back a calendar month', () => {
    vi.setSystemTime(MORNING_UTC);
    expect(resolveRange('lastMonth').from).toBe('2026-08-13T19:00:00.000Z');
  });

  it('all time sets no bounds at all', () => {
    expect(resolveRange('all')).toEqual({});
  });
});

describe('resolveRange — custom', () => {
  it('covers both end days in full', () => {
    const range = resolveRange('custom', {
      from: new Date('2026-09-01T10:00:00.000Z'),
      to: new Date('2026-09-03T10:00:00.000Z'),
    });
    // Starts at midnight PKT on the 1st and ends at the last moment of the 3rd.
    expect(range.from).toBe('2026-08-31T19:00:00.000Z');
    expect(new Date(range.to!).toISOString()).toMatch(/^2026-09-03T18:59:59/);
  });

  it('leaves an unset end open rather than inventing one', () => {
    const range = resolveRange('custom', { from: new Date('2026-09-01T10:00:00.000Z') });
    expect(range.to).toBeUndefined();
  });
});

describe('range labels', () => {
  it('labels every quick range the dashboard offers', () => {
    for (const key of QUICK_RANGES) {
      expect(RANGE_LABELS[key]).toBeTruthy();
    }
    expect(QUICK_RANGES).toEqual(['today', 'yesterday', 'last7', 'lastMonth', 'all']);
  });
});
