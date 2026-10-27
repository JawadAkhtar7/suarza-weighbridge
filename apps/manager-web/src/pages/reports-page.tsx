/**
 * Reports: one person, one period, one story.
 *
 * Pick somebody, pick the days and hours, read what they did — in the order
 * they did it. Five kinds of thing happen in a shift (a truck weighed, a
 * shift begun or ended, money taken or given) and they used to be three
 * separate tables, which left the reader doing the ordering in their head.
 * One list, sorted by the clock, with an icon per kind.
 *
 * The figures above it are counted over the WHOLE period, not over the lines
 * listed, so a long report that has been cut still adds up.
 *
 * Built for a phone as much as a desk: the cards stack, the table scrolls
 * rather than squeezes, and the print styles put the report alone on paper
 * with its colour intact.
 */

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { DayPicker, type DateRange as PickerRange } from 'react-day-picker';
import {
  Badge,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@suarza/ui';
import {
  OPERATOR_ROLE_LABELS,
  formatDatePkt,
  formatPKR,
  formatTimePkt,
  vehicleTypeLabel,
  type ReportActivity,
  type ReportActivityKind,
  type UserReport,
} from '@suarza/shared';
import {
  ArrowDownLeft,
  ArrowUpRight,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  LogIn,
  LogOut,
  Printer,
  Scale,
  ShieldCheck,
  Truck,
  UserRound,
  Wallet,
  X,
} from 'lucide-react';
import { api } from '../lib/api.js';
import { resolveRange, type RangeKey } from '../lib/date-ranges.js';

const DAY_START = '00:00';
const DAY_END = '23:59';

/** The ranges offered, in the order a manager reaches for them. */
const RANGES: { key: RangeKey; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: 'last7', label: 'Last 7 days' },
  { key: 'lastMonth', label: 'Last month' },
];

/** Minutes past midnight, or null for anything that is not a time of day. */
function clockMinutes(clock: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(clock.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/**
 * Narrow a run of days to a stretch of hours inside it.
 *
 * Measured from the day boundaries the date buttons already produce — which
 * are Pakistan midnights — so the clock the manager types means the clock at
 * the yard rather than the clock on this server.
 *
 * On a single day this is exactly "between these two times". Across several
 * it runs from the first day's start time to the last day's end time, which
 * is what a range of anything means.
 */
function withinDay(
  days: { from?: string; to?: string },
  fromTime: string,
  toTime: string,
): { from?: string; to?: string } {
  const start = clockMinutes(fromTime);
  const end = clockMinutes(toTime);
  if (start === null || end === null || !days.from || !days.to) return days;

  const MINUTE = 60_000;
  const firstMidnight = new Date(days.from).getTime();
  /* `to` is the last millisecond of the last day, so its own midnight is
     that instant less a day. */
  const lastMidnight = new Date(days.to).getTime() - (24 * 60 * MINUTE - 1);

  return {
    from: new Date(firstMidnight + start * MINUTE).toISOString(),
    /* To the end of the chosen minute, so 08:00–20:00 includes 20:00:59. */
    to: new Date(lastMidnight + end * MINUTE + (MINUTE - 1)).toISOString(),
  };
}

/**
 * How each kind of line looks.
 *
 * Colour follows what the line IS, and the same pairing throughout: money in
 * is green, money out is amber, a weighing is the brand's own green, a shift
 * boundary is the quiet blue of something that is neither. The icon carries
 * it as well as the colour, for anyone reading in grey.
 */
const ACTIVITY_STYLE: Record<
  ReportActivityKind,
  { icon: typeof Scale; label: string; disc: string; amount: string }
> = {
  WEIGHMENT: {
    icon: Truck,
    label: 'Weighment',
    disc: 'bg-primary/15 text-primary',
    amount: 'text-primary',
  },
  SHIFT_START: {
    icon: LogIn,
    label: 'Shift started',
    disc: 'bg-sky-500/15 text-sky-700 dark:text-sky-400',
    amount: 'text-muted-foreground',
  },
  SHIFT_END: {
    icon: LogOut,
    label: 'Shift ended',
    disc: 'bg-violet-500/15 text-violet-700 dark:text-violet-400',
    amount: 'text-muted-foreground',
  },
  MONEY_TAKEN: {
    icon: ArrowDownLeft,
    label: 'Money taken',
    disc: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
    amount: 'text-emerald-700 dark:text-emerald-400',
  },
  MONEY_GIVEN: {
    icon: ArrowUpRight,
    label: 'Money given',
    disc: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
    amount: 'text-amber-700 dark:text-amber-400',
  },
};

/** What the middle column says, which differs by kind. */
function describe(activity: ReportActivity): string {
  switch (activity.kind) {
    case 'WEIGHMENT':
      return `Slip ${activity.slip_number ?? '—'}`;
    case 'MONEY_TAKEN':
      return `From ${activity.counterpart || 'someone unnamed'}`;
    case 'MONEY_GIVEN':
      return `To ${activity.counterpart || 'someone unnamed'}`;
    default:
      return activity.detail ?? '';
  }
}

/** The truck, for the lines that have one. */
function vehicleOf(activity: ReportActivity): string {
  if (activity.kind !== 'WEIGHMENT') return '';
  const type = activity.vehicle_type
    ? vehicleTypeLabel(activity.vehicle_type, activity.vehicle_type_label ?? '')
    : '';
  return [activity.vehicle_plate, type].filter(Boolean).join(' · ');
}

/** One headline figure. */
const FIGURE_TONES = {
  brandGreen: {
    wash: 'bg-primary/5 border-primary/30',
    icon: 'text-primary',
    value: 'text-primary',
  },
  in: {
    wash: 'bg-emerald-500/5 border-emerald-500/30',
    icon: 'text-emerald-600',
    value: 'text-emerald-700 dark:text-emerald-400',
  },
  out: {
    wash: 'bg-amber-500/5 border-amber-500/30',
    icon: 'text-amber-600',
    value: 'text-amber-700 dark:text-amber-400',
  },
} as const;

function Figure({
  label,
  value,
  note,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string;
  note?: string;
  icon: typeof Wallet;
  tone: keyof typeof FIGURE_TONES;
}) {
  const style = FIGURE_TONES[tone];

  return (
    <div className={`rounded-lg border p-4 ${style.wash}`}>
      <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        <Icon className={`h-3.5 w-3.5 ${style.icon}`} aria-hidden />
        {label}
      </p>
      <p className={`tabular mt-1 text-2xl font-bold leading-tight ${style.value}`}>{value}</p>
      {note && <p className="text-xs text-muted-foreground">{note}</p>}
    </div>
  );
}

/**
 * The whole period in one line: one day reads as that day.
 *
 * The hours are named only when they are not the whole day — but then they
 * MUST be, including on paper: a report of eight hours that read like a
 * report of the day would be a misleading thing to hand somebody.
 */
function periodLabel(from: string, to: string): string {
  const start = formatDatePkt(from);
  const finish = formatDatePkt(to);
  const days = start === finish ? start : `${start} – ${finish}`;

  const opens = formatTimePkt(from);
  const closes = formatTimePkt(to);
  const wholeDay = opens === '12:00 AM' && closes === '11:59 PM';

  return wholeDay ? days : `${days} · ${opens} – ${closes}`;
}

/** How many lines a screenful is. The paper takes them all. */
const PAGE_SIZE = 25;

function Report({ report }: { report: UserReport }) {
  const [page, setPage] = useState(1);
  const pageCount = Math.max(1, Math.ceil(report.activities.length / PAGE_SIZE));

  /* A new report is a new first page: staying on page 7 of somebody else's
     fortnight would show an empty table and look broken. */
  useEffect(() => {
    setPage(1);
  }, [report.operator, report.from, report.to]);

  return (
    /*
     * `print-color-adjust: exact` is what keeps the colour: browsers drop
     * background fills when printing to save ink, which would leave a sheet
     * of grey boxes with no brand on it at all.
     */
    <div
      className="space-y-5 [print-color-adjust:exact] [-webkit-print-color-adjust:exact]"
      data-report
    >
      {/* The masthead. The logo on white, over the brand's green-to-orange
          rule — the same pair the slip uses, so a printed report and a
          printed slip plainly come from the same yard. */}
      <header className="overflow-hidden rounded-lg border">
        <div className="flex flex-wrap items-center justify-between gap-3 bg-white px-4 py-3 dark:bg-white">
          <img
            src="/logo.png"
            srcSet="/logo.png 1x, /logo@3x.png 3x"
            alt="Suarza International"
            className="h-12 w-auto"
          />
          <p className="text-right text-xs font-bold uppercase tracking-[0.2em] text-primary">
            Weighbridge
            <span className="block text-sm tracking-[0.3em]">Report</span>
          </p>
        </div>

        <div className="h-1.5 bg-gradient-to-r from-primary via-primary to-brand" />

        <div className="flex flex-wrap items-center justify-between gap-3 bg-primary/5 px-4 py-3">
          <div>
            <h2 className="text-xl font-bold text-primary">{report.operator_name}</h2>
            <p className="tabular text-sm text-muted-foreground">
              {periodLabel(report.from, report.to)}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="gap-1.5 bg-primary/10 text-primary">
              {report.role === 'ADMIN' && <ShieldCheck className="h-3.5 w-3.5" />}
              {OPERATOR_ROLE_LABELS[report.role]}
            </Badge>
            {/* The honest "download" on a web page: the browser's own
                print-to-PDF, which every phone and desktop already has. */}
            <Button variant="brand" size="sm" onClick={() => window.print()} data-print-hide>
              <Printer className="h-4 w-4" />
              Print / PDF
            </Button>
          </div>
        </div>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Figure
          label="Weighments"
          value={report.weighments.toLocaleString()}
          note="Voided tickets excluded"
          icon={Scale}
          tone="brandGreen"
        />
        <Figure
          label="Total profit"
          value={formatPKR(report.takings)}
          note="What those weighings charged"
          icon={Wallet}
          tone="brandGreen"
        />
        <Figure
          label="Money taken"
          value={formatPKR(report.money_taken)}
          note="Handed to them"
          icon={ArrowDownLeft}
          tone="in"
        />
        <Figure
          label="Money given"
          value={formatPKR(report.money_given)}
          note="Handed on by them"
          icon={ArrowUpRight}
          tone="out"
        />
      </div>

      <section className="space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b-2 border-primary/20 pb-1">
          <h3 className="text-sm font-bold uppercase tracking-wide text-primary">Activity</h3>
          <span className="tabular text-xs text-muted-foreground">
            {report.activities.length.toLocaleString()} entries, newest first
          </span>
        </div>

        {report.activities.length === 0 ? (
          <p className="rounded-lg border p-4 text-sm text-muted-foreground">
            Nothing recorded in this period.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow className="bg-primary/10 hover:bg-primary/10">
                  <TableHead className="font-semibold text-primary">Time</TableHead>
                  <TableHead className="font-semibold text-primary">Activity</TableHead>
                  <TableHead className="font-semibold text-primary">Details</TableHead>
                  <TableHead className="font-semibold text-primary">Vehicle</TableHead>
                  <TableHead className="text-right font-semibold text-primary">Amount</TableHead>
                </TableRow>
              </TableHeader>

              <TableBody>
                {report.activities.map((activity, index) => {
                  const style = ACTIVITY_STYLE[activity.kind];
                  const vehicle = vehicleOf(activity);
                  const onThisPage = Math.floor(index / PAGE_SIZE) + 1 === page;

                  return (
                    /*
                     * Every row is rendered; the ones not on this page are
                     * hidden. The printed report is the WHOLE report — a
                     * PDF of page 3 of 9 is not a report of anything — and
                     * the print styles below undo this.
                     */
                    <TableRow
                      key={activity.id}
                      style={onThisPage ? undefined : { display: 'none' }}
                    >
                      <TableCell className="tabular whitespace-nowrap align-top text-muted-foreground">
                        <span className="block">{formatTimePkt(activity.at)}</span>
                        <span className="block text-xs">{formatDatePkt(activity.at)}</span>
                      </TableCell>

                      <TableCell className="align-top">
                        <span className="flex items-center gap-2 whitespace-nowrap font-medium">
                          <span
                            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${style.disc}`}
                            aria-hidden
                          >
                            <style.icon className="h-4 w-4" />
                          </span>
                          {style.label}
                        </span>
                      </TableCell>

                      <TableCell className="align-top">
                        {describe(activity)}
                        {/* Whose record this is, when it is not this
                            person's own. A handover is written down by one
                            of its two sides, and "I never wrote that" is
                            exactly what somebody will want to know. */}
                        {activity.recorded_by && (
                          <span className="block text-xs italic text-muted-foreground">
                            recorded by {activity.recorded_by}
                          </span>
                        )}
                      </TableCell>

                      <TableCell className="align-top text-muted-foreground">
                        {vehicle || '—'}
                      </TableCell>

                      <TableCell
                        className={`tabular whitespace-nowrap text-right align-top font-semibold ${style.amount}`}
                      >
                        {activity.amount > 0 ? formatPKR(activity.amount) : '—'}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}

        {pageCount > 1 && (
          <div
            className="flex flex-wrap items-center justify-between gap-3 text-sm"
            data-print-hide
          >
            <p className="text-muted-foreground">
              Showing {(page - 1) * PAGE_SIZE + 1}–
              {Math.min(page * PAGE_SIZE, report.activities.length)} of{' '}
              {report.activities.length.toLocaleString()}
              <span className="ml-1 text-xs">(printing gives every page)</span>
            </p>

            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage(page - 1)}
                disabled={page <= 1}
              >
                <ChevronLeft className="h-4 w-4" />
                Newer
              </Button>
              <span className="tabular text-muted-foreground">
                Page {page} of {pageCount}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage(page + 1)}
                disabled={page >= pageCount}
              >
                Older
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}

        {report.truncated && (
          <p className="text-xs text-muted-foreground">
            Only the first {report.activities.length.toLocaleString()} entries are listed. The
            figures above count the whole period — narrow the dates to list the rest.
          </p>
        )}
      </section>
    </div>
  );
}

export function ReportsPage() {
  const [rangeKey, setRangeKey] = useState<RangeKey>('today');
  const [custom, setCustom] = useState<{ from?: Date; to?: Date }>({});
  const [pickerOpen, setPickerOpen] = useState(false);
  const [draftRange, setDraftRange] = useState<PickerRange | undefined>();
  const [chosen, setChosen] = useState<string>('');

  const days = useMemo(() => resolveRange(rangeKey, custom), [rangeKey, custom]);

  /* The hours within those days. Midnight to midnight until the manager
     narrows it, which is the whole day and the same answer the days alone
     would give. */
  const [fromTime, setFromTime] = useState(DAY_START);
  const [toTime, setToTime] = useState(DAY_END);

  const range = useMemo(() => withinDay(days, fromTime, toTime), [days, fromTime, toTime]);
  const narrowed = fromTime !== DAY_START || toTime !== DAY_END;

  const roster = useQuery({ queryKey: ['roster'], queryFn: api.roster });
  /*
   * The operators, not the managers.
   *
   * A manager's money is its own screen now — see the Manager page — and
   * mixing the two put a person with no weighings in a list of people
   * reported on by their weighings.
   */
  const people = (roster.data?.operators ?? []).filter(
    (person) => person.username && person.role !== 'ADMIN',
  );

  const report = useQuery({
    queryKey: ['user-report', chosen, range.from, range.to],
    queryFn: () =>
      api.userReport({
        operator: chosen,
        from: range.from ?? new Date(0).toISOString(),
        to: range.to ?? new Date().toISOString(),
      }),
    enabled: chosen !== '',
  });

  const customLabel =
    custom.from && custom.to
      ? `${formatDatePkt(custom.from)} – ${formatDatePkt(custom.to)}`
      : 'Pick dates';

  return (
    <div className="space-y-6">
      {/* Print styles, scoped to this page: on paper the report is the whole
          sheet — no sidebar, no buttons, no controls. */}
      <style>{`
        @media print {
          /*
           * A white sheet whatever the screen was set to.
           *
           * Forcing the background alone was not enough: the TEXT colours
           * come from theme tokens, so a report printed from dark mode put
           * pale grey type on white paper — technically ink, practically
           * unreadable. The handful of tokens the report draws with are
           * redeclared here with the light theme's own values, so what
           * reaches the printer is the light theme whatever the screen is.
           */
          :root,
          html.dark {
            color-scheme: light;
            --background: 0 0% 100%;
            --foreground: 222 47% 11%;
            --card: 0 0% 100%;
            --card-foreground: 222 47% 11%;
            --popover: 0 0% 100%;
            --popover-foreground: 222 47% 11%;
            --primary: 146 62% 22%;
            --primary-foreground: 0 0% 100%;
            --brand-orange: 28 92% 55%;
            --secondary: 210 40% 96%;
            --secondary-foreground: 222 47% 11%;
            --muted: 210 40% 96%;
            --muted-foreground: 215 16% 47%;
            --border: 214 32% 91%;
          }
          body { background: #fff; color: hsl(222 47% 11%); }
          body * { visibility: hidden; }
          [data-report], [data-report] * { visibility: visible; }
          [data-report] { position: absolute; inset: 0; padding: 0; }
          [data-print-hide] { display: none !important; }
          [data-report] {
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          /* Nothing should be cut in half across a page break. */
          [data-report] section, [data-report] tr { break-inside: avoid; }
          [data-report] thead { display: table-header-group; }
          /* The paper takes every row, whichever page is on screen. */
          [data-report] tbody tr { display: table-row !important; }
        }
      `}</style>

      <div data-print-hide>
        <h1 className="text-2xl font-semibold">Reports</h1>
      </div>

      <div className="flex flex-wrap items-center gap-2" data-print-hide>
        {/* Who. A select rather than a table of people to click: the report
            is about one person at a time, and the list is short. */}
        <Select value={chosen} onValueChange={setChosen}>
          <SelectTrigger className="w-60" aria-label="Person">
            <SelectValue placeholder="Select Person" />
          </SelectTrigger>
          <SelectContent>
            {people.map((person, index) => (
              <div key={person.id}>
                {index > 0 && <SelectSeparator />}
                <SelectItem value={person.username as string}>
                  <span className="flex items-center gap-2">
                    <span
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"
                      aria-hidden
                    >
                      {person.role === 'ADMIN' ? (
                        <ShieldCheck className="h-3.5 w-3.5" />
                      ) : (
                        <UserRound className="h-3.5 w-3.5" />
                      )}
                    </span>
                    {person.name}
                  </span>
                </SelectItem>
              </div>
            ))}
          </SelectContent>
        </Select>

        {RANGES.map(({ key, label }) => (
          <Button
            key={key}
            type="button"
            size="sm"
            variant={rangeKey === key ? 'default' : 'outline'}
            onClick={() => setRangeKey(key)}
          >
            {label}
          </Button>
        ))}

        <Button
          type="button"
          size="sm"
          variant={rangeKey === 'custom' ? 'default' : 'outline'}
          onClick={() => {
            setDraftRange(custom.from ? { from: custom.from, to: custom.to } : undefined);
            setPickerOpen(true);
          }}
        >
          <CalendarDays className="h-4 w-4" />
          {rangeKey === 'custom' ? customLabel : 'Pick dates'}
        </Button>

        {/* The hours inside those days. Beside the dates rather than under
            them, because the two answer one question together. */}
        <div className="flex items-center gap-2 rounded-md border px-2 py-1">
          <Clock3 className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <label htmlFor="report-from-time" className="sr-only">
            From this time
          </label>
          <Input
            id="report-from-time"
            type="time"
            value={fromTime}
            onChange={(event) => setFromTime(event.target.value)}
            className="tabular h-8 w-[7.5rem] border-0 px-1 shadow-none focus-visible:ring-0"
          />
          <span className="text-muted-foreground">–</span>
          <label htmlFor="report-to-time" className="sr-only">
            To this time
          </label>
          <Input
            id="report-to-time"
            type="time"
            value={toTime}
            onChange={(event) => setToTime(event.target.value)}
            className="tabular h-8 w-[7.5rem] border-0 px-1 shadow-none focus-visible:ring-0"
          />

          {narrowed && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 px-2 text-muted-foreground"
              onClick={() => {
                setFromTime(DAY_START);
                setToTime(DAY_END);
              }}
              aria-label="Use the whole day"
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      {chosen === '' ? (
        <Card data-print-hide>
          <CardContent className="p-10 text-center text-muted-foreground">
            {roster.isLoading
              ? 'Loading…'
              : people.length === 0
                ? 'Nobody to report on yet. Add people on the Operators screen.'
                : 'Choose somebody to see their report.'}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-5">
            {report.isLoading || !report.data ? (
              <div className="space-y-3">
                <Skeleton className="h-20 w-full" />
                <Skeleton className="h-24 w-full" />
                <Skeleton className="h-64 w-full" />
              </div>
            ) : (
              <Report report={report.data} />
            )}
          </CardContent>
        </Card>
      )}

      <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
        <DialogContent className="max-w-fit">
          <DialogHeader>
            <DialogTitle>Choose the days</DialogTitle>
          </DialogHeader>

          <DayPicker
            mode="range"
            selected={draftRange}
            onSelect={setDraftRange}
            numberOfMonths={1}
            // Nobody needs a report on days that have not happened yet.
            disabled={{ after: new Date() }}
            className="rdp-suarza"
          />

          <DialogFooter>
            <Button variant="outline" onClick={() => setPickerOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={!draftRange?.from}
              onClick={() => {
                setCustom({
                  from: draftRange?.from,
                  // A single-day click means that one day, not an open end.
                  to: draftRange?.to ?? draftRange?.from,
                });
                setRangeKey('custom');
                setPickerOpen(false);
              }}
            >
              Apply
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
