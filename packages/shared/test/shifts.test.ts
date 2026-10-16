/**
 * Which shift a moment belongs to.
 *
 * The whole difficulty is the night shift crossing midnight: with morning at
 * 08:00 and night at 20:00, 23:00 and 02:00 are both night even though one is
 * before midnight and the other after. Everything here is about that, and
 * about the bridge's clock not being the server's.
 */

import { describe, expect, it } from 'vitest';
import {
  clockToMinutes,
  DEFAULT_SHIFT_START_MINUTES,
  minutesToClock,
  shiftAt,
} from '../src/constants/shifts.js';

/** A moment at the bridge, written as Pakistan Standard Time (UTC+5). */
const pkt = (clock: string) => new Date(`2026-10-16T${clock}:00+05:00`);

describe('shiftAt', () => {
  it('puts the working day in the morning shift', () => {
    for (const clock of ['08:00', '09:30', '13:00', '19:59']) {
      expect(shiftAt(pkt(clock))).toBe('MORNING');
    }
  });

  it('puts the night in the night shift, both sides of midnight', () => {
    for (const clock of ['20:00', '23:30', '00:00', '02:15', '07:59']) {
      expect(shiftAt(pkt(clock))).toBe('NIGHT');
    }
  });

  it('counts the start of a shift as that shift, not the one before', () => {
    // 20:00 exactly is the night's first minute. A half-open range is the only
    // way a weighing taken on the hour belongs to one shift rather than both.
    expect(shiftAt(pkt('19:59'))).toBe('MORNING');
    expect(shiftAt(pkt('20:00'))).toBe('NIGHT');
    expect(shiftAt(pkt('07:59'))).toBe('NIGHT');
    expect(shiftAt(pkt('08:00'))).toBe('MORNING');
  });

  it('reads the clock at the bridge, not the one the server keeps', () => {
    /*
     * This is why a timezone is passed at all. The cloud runs in New York; at
     * 09:00 in the yard it is the small hours there. Answering from the
     * server's own clock would file a morning's work as night.
     */
    const nineInTheMorningAtTheBridge = new Date('2026-10-16T04:00:00Z');
    expect(shiftAt(nineInTheMorningAtTheBridge)).toBe('MORNING');
    expect(
      shiftAt(nineInTheMorningAtTheBridge, DEFAULT_SHIFT_START_MINUTES, 'America/New_York'),
    ).toBe('NIGHT');
  });

  it('follows hours the manager has changed', () => {
    // A yard opening at six and handing over at six.
    const sixAndSix = { MORNING: 6 * 60, NIGHT: 18 * 60 };
    expect(shiftAt(pkt('06:30'), sixAndSix)).toBe('MORNING');
    expect(shiftAt(pkt('19:00'), sixAndSix)).toBe('NIGHT');
    // The same moment answers differently under the default hours, which is
    // the point of working it out rather than storing it.
    expect(shiftAt(pkt('06:30'))).toBe('NIGHT');
  });

  it('handles a morning shift that is the one crossing midnight', () => {
    /*
     * Nothing stops a manager setting morning at 22:00 and night at 10:00.
     * Odd, but it must not produce a moment belonging to neither shift.
     */
    const inverted = { MORNING: 22 * 60, NIGHT: 10 * 60 };
    expect(shiftAt(pkt('23:00'), inverted)).toBe('MORNING');
    expect(shiftAt(pkt('03:00'), inverted)).toBe('MORNING');
    expect(shiftAt(pkt('12:00'), inverted)).toBe('NIGHT');
  });

  it('never leaves a moment without a shift', () => {
    // Every minute of the day belongs to exactly one of the two, which is what
    // storing only the two starts guarantees.
    for (let minute = 0; minute < 1440; minute += 7) {
      const clock = minutesToClock(minute);
      expect(['MORNING', 'NIGHT']).toContain(shiftAt(pkt(clock)));
    }
  });

  it('accepts an ISO string as readily as a Date', () => {
    expect(shiftAt('2026-10-16T09:00:00+05:00')).toBe('MORNING');
  });
});

describe('clock conversion', () => {
  it('round-trips every minute of the day', () => {
    for (let minute = 0; minute < 1440; minute += 1) {
      expect(clockToMinutes(minutesToClock(minute))).toBe(minute);
    }
  });

  it('writes a time the way a time input expects it', () => {
    expect(minutesToClock(0)).toBe('00:00');
    expect(minutesToClock(8 * 60)).toBe('08:00');
    expect(minutesToClock(20 * 60 + 5)).toBe('20:05');
  });

  it('refuses what is not a time of day', () => {
    for (const bad of ['', '8', '25:00', '08:60', 'morning', '08:0']) {
      expect(clockToMinutes(bad)).toBeNull();
    }
  });
});
