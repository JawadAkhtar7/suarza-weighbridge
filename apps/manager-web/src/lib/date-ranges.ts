/**
 * The quick ranges the dashboard offers (brief §9).
 *
 * A day boundary here is a Pakistan day, not a UTC one: "Today" must mean the
 * day the manager is living in, or every weighing before 5am local would fall
 * into yesterday's figures.
 */

import { endOfDay, startOfDay, subDays, subMonths } from 'date-fns';
import { DISPLAY_TIMEZONE } from '@suarza/shared';

export type RangeKey = 'today' | 'yesterday' | 'last7' | 'lastMonth' | 'all' | 'custom';

export interface DateRange {
  from?: string;
  to?: string;
}

export const RANGE_LABELS: Record<RangeKey, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  last7: 'Last 7 days',
  lastMonth: 'Last month',
  all: 'All time',
  custom: 'Custom range',
};

export const QUICK_RANGES: RangeKey[] = ['today', 'yesterday', 'last7', 'lastMonth', 'all'];

/**
 * Midnight in Pakistan, expressed as a UTC instant.
 *
 * Done by measuring the zone's offset at that moment rather than assuming
 * +05:00, so the code stays correct if Pakistan ever reintroduces DST.
 */
function pktDayBoundary(date: Date, edge: 'start' | 'end'): Date {
  const local = new Date(date.toLocaleString('en-US', { timeZone: DISPLAY_TIMEZONE }));
  const offsetMs = date.getTime() - local.getTime();
  const boundary = edge === 'start' ? startOfDay(local) : endOfDay(local);
  return new Date(boundary.getTime() + offsetMs);
}

export function resolveRange(key: RangeKey, custom?: { from?: Date; to?: Date }): DateRange {
  const now = new Date();

  switch (key) {
    case 'today':
      return {
        from: pktDayBoundary(now, 'start').toISOString(),
        to: pktDayBoundary(now, 'end').toISOString(),
      };
    case 'yesterday': {
      const yesterday = subDays(now, 1);
      return {
        from: pktDayBoundary(yesterday, 'start').toISOString(),
        to: pktDayBoundary(yesterday, 'end').toISOString(),
      };
    }
    case 'last7':
      return {
        from: pktDayBoundary(subDays(now, 6), 'start').toISOString(),
        to: pktDayBoundary(now, 'end').toISOString(),
      };
    case 'lastMonth':
      return {
        from: pktDayBoundary(subMonths(now, 1), 'start').toISOString(),
        to: pktDayBoundary(now, 'end').toISOString(),
      };
    case 'custom':
      return {
        from: custom?.from ? pktDayBoundary(custom.from, 'start').toISOString() : undefined,
        to: custom?.to ? pktDayBoundary(custom.to, 'end').toISOString() : undefined,
      };
    case 'all':
      return {};
  }
}
