/**
 * Reports: one person, one stretch of time, one page.
 *
 * Pick somebody from the list, pick the days, read the report — or print it,
 * which is how a web page becomes a PDF anybody can keep.
 *
 * IT REPLACED an audit screen that laid two shifts side by side, worked out
 * what was left over and pronounced on whether a shift balanced. The client
 * could not read it at a glance, and no wonder: it answered a question
 * nobody had asked, over figures nobody had checked. This answers the plain
 * ones. How many trucks did this person weigh, what did those weighings
 * charge, what money came to them and what did they hand on, and when were
 * they here.
 *
 * Built for a phone as much as a desk: the figures stack, the tables scroll
 * rather than squeeze, and the print styles put the whole thing on paper
 * without the chrome around it.
 */

import type { ReactNode } from 'react';
import { useMemo, useState } from 'react';
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
  type Operator,
  type ShiftCashEntry,
  type UserReport,
} from '@suarza/shared';
import {
  ArrowDownLeft,
  ArrowUpRight,
  CalendarDays,
  Clock3,
  FileText,
  Printer,
  Scale,
  ShieldCheck,
  Wallet,
  X,
} from 'lucide-react';
import { api } from '../lib/api.js';
import { resolveRange, type RangeKey } from '../lib/date-ranges.js';

/** The ranges offered, in the order a manager reaches for them. */
const RANGES: { key: RangeKey; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: 'last7', label: 'Last 7 days' },
  { key: 'lastMonth', label: 'Last month' },
];

/**
 * One headline figure.
 *
 * Three tones, not four colours: the yard's own money is the brand green,
 * cash coming in is green, cash going out is amber. A fourth hue would say
 * something, and there is nothing more to say.
 */
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

/** Every line one movement produces — a movement may record up to four. */
function movementLines(entry: ShiftCashEntry) {
  return [
    entry.person_taken > 0 && {
      key: `${entry.id}-pt`,
      inbound: true,
      who: entry.person_name || 'someone unnamed',
      amount: entry.person_taken,
    },
    entry.person_given > 0 && {
      key: `${entry.id}-pg`,
      inbound: false,
      who: entry.person_name || 'someone unnamed',
      amount: entry.person_given,
    },
    entry.manager_taken > 0 && {
      key: `${entry.id}-mt`,
      inbound: true,
      who: entry.manager_name || 'the manager',
      amount: entry.manager_taken,
    },
    entry.manager_given > 0 && {
      key: `${entry.id}-mg`,
      inbound: false,
      who: entry.manager_name || 'the manager',
      amount: entry.manager_given,
    },
  ].filter(Boolean) as { key: string; inbound: boolean; who: string; amount: number }[];
}

/** `8h 15m`, or `—` for a shift still running. */
function lengthOf(session: { started_at: string; ended_at: string | null }): string {
  if (!session.ended_at) return 'still signed in';
  const minutes = Math.max(
    0,
    Math.round(
      (new Date(session.ended_at).getTime() - new Date(session.started_at).getTime()) / 60_000,
    ),
  );
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
}

/** The whole period in one line: one day reads as that day. */
function periodLabel(from: string, to: string): string {
  const start = formatDatePkt(from);
  const finish = formatDatePkt(to);
  return start === finish ? start : `${start} – ${finish}`;
}

/** A section, with the brand's own rule under its heading. */
function Section({
  title,
  aside,
  children,
}: {
  title: string;
  aside?: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b-2 border-primary/20 pb-1">
        <h3 className="text-sm font-bold uppercase tracking-wide text-primary">{title}</h3>
        {aside && <span className="tabular text-xs text-muted-foreground">{aside}</span>}
      </div>
      {children}
    </section>
  );
}

function Report({ report }: { report: UserReport }) {
  const lines = report.movements.flatMap((entry) =>
    movementLines(entry).map((line) => ({ ...line, at: entry.at })),
  );

  /* The whole time signed in, which is the figure a manager totals by hand
     otherwise. */
  const workedMinutes = report.sessions.reduce((sum, session) => {
    if (!session.ended_at) return sum;
    return (
      sum +
      Math.max(
        0,
        Math.round(
          (new Date(session.ended_at).getTime() - new Date(session.started_at).getTime()) / 60_000,
        ),
      )
    );
  }, 0);
  const workedLabel = `${Math.floor(workedMinutes / 60)}h ${String(workedMinutes % 60).padStart(2, '0')}m`;

  const period = periodLabel(report.from, report.to);

  return (
    /*
     * The report, on screen and on paper alike.
     *
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
            <p className="tabular text-sm text-muted-foreground">{period}</p>
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
          label="Weighings"
          value={report.weighments.toLocaleString()}
          note="Voided tickets excluded"
          icon={Scale}
          tone="brandGreen"
        />
        <Figure
          label="Earned"
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

      <Section title={period} aside={`${report.weighments.toLocaleString()} weighings in total`}>
        {report.days.length === 0 ? (
          <p className="rounded-lg border p-4 text-sm text-muted-foreground">
            No weighings in this period.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow className="bg-primary/10 hover:bg-primary/10">
                  <TableHead className="font-semibold text-primary">Day</TableHead>
                  <TableHead className="text-right font-semibold text-primary">Weighings</TableHead>
                  <TableHead className="text-right font-semibold text-primary">Earned</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.days.map((day) => (
                  <TableRow key={day.date}>
                    <TableCell className="whitespace-nowrap">{formatDatePkt(day.date)}</TableCell>
                    <TableCell className="tabular text-right">
                      {day.weighments.toLocaleString()}
                    </TableCell>
                    <TableCell className="tabular text-right font-semibold text-primary">
                      {formatPKR(day.takings)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Section>

      <Section
        title="Money moved"
        aside={`${formatPKR(report.money_taken)} taken · ${formatPKR(report.money_given)} given`}
      >
        {lines.length === 0 ? (
          <p className="rounded-lg border p-4 text-sm text-muted-foreground">
            Nothing written down in this period.
          </p>
        ) : (
          <ul className="divide-y overflow-hidden rounded-lg border">
            {lines.map((line) => (
              <li
                key={line.key}
                className={`flex items-center gap-3 p-3 text-sm ${
                  line.inbound ? 'bg-emerald-500/5' : 'bg-amber-500/5'
                }`}
              >
                <span
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                    line.inbound
                      ? 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-400'
                      : 'bg-amber-500/20 text-amber-700 dark:text-amber-400'
                  }`}
                  aria-hidden
                >
                  {line.inbound ? '+' : '−'}
                </span>

                <span className="min-w-0 flex-1">
                  <span className="block truncate">
                    {line.inbound ? 'Took from' : 'Gave to'}{' '}
                    <span className="font-medium">{line.who}</span>
                  </span>
                  <span className="tabular text-xs text-muted-foreground">
                    {formatDatePkt(line.at)} · {formatTimePkt(line.at)}
                  </span>
                </span>

                <span
                  className={`tabular shrink-0 font-semibold ${
                    line.inbound
                      ? 'text-emerald-700 dark:text-emerald-400'
                      : 'text-amber-700 dark:text-amber-400'
                  }`}
                >
                  {formatPKR(line.amount)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section
        title="Shift Length"
        aside={workedMinutes > 0 ? `${workedLabel} in total` : undefined}
      >
        {report.sessions.length === 0 ? (
          <p className="rounded-lg border p-4 text-sm text-muted-foreground">
            They did not sign in during this period.
          </p>
        ) : (
          <ul className="divide-y overflow-hidden rounded-lg border">
            {report.sessions.map((session) => (
              <li
                key={session.started_at}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 p-3 text-sm"
              >
                <Clock3 className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
                <span className="whitespace-nowrap font-medium">
                  {formatDatePkt(session.started_at)}
                </span>
                <span className="tabular text-muted-foreground">
                  {formatTimePkt(session.started_at)} –{' '}
                  {session.ended_at ? formatTimePkt(session.ended_at) : 'now'}
                </span>
                <span className="tabular ml-auto font-bold text-primary">{lengthOf(session)}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

export function ReportsPage() {
  const [rangeKey, setRangeKey] = useState<RangeKey>('today');
  const [custom, setCustom] = useState<{ from?: Date; to?: Date }>({});
  const [pickerOpen, setPickerOpen] = useState(false);
  const [draftRange, setDraftRange] = useState<PickerRange | undefined>();
  const [chosen, setChosen] = useState<Operator | null>(null);

  const range = useMemo(() => resolveRange(rangeKey, custom), [rangeKey, custom]);

  const roster = useQuery({ queryKey: ['roster'], queryFn: api.roster });
  const people = (roster.data?.operators ?? []).filter((person) => person.username);

  const report = useQuery({
    queryKey: ['user-report', chosen?.username, range.from, range.to],
    queryFn: () =>
      api.userReport({
        operator: chosen?.username ?? '',
        from: range.from ?? new Date(0).toISOString(),
        to: range.to ?? new Date().toISOString(),
      }),
    enabled: Boolean(chosen?.username),
  });

  const customLabel =
    custom.from && custom.to
      ? `${formatDatePkt(custom.from)} – ${formatDatePkt(custom.to)}`
      : 'Pick dates';

  return (
    <div className="space-y-6">
      {/* Print styles, scoped to this page: on paper the report is the whole
          sheet — no sidebar, no buttons, no list of people. */}
      <style>{`
        @media print {
          /* A white sheet whatever the screen was set to: printing a dark
             theme puts a page of ink on paper and reads worse for it. */
          :root { color-scheme: light; }
          body { background: #fff; }
          body * { visibility: hidden; }
          [data-report], [data-report] * { visibility: visible; }
          [data-report] { position: absolute; inset: 0; padding: 0; }
          [data-print-hide] { display: none !important; }
          /* Browsers drop background fills when printing to save ink, which
             would leave the report's colour behind on screen. */
          [data-report] {
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          /* Nothing should be cut in half across a page break. */
          [data-report] section, [data-report] li, [data-report] tr {
            break-inside: avoid;
          }
        }
      `}</style>

      <div data-print-hide>
        <h1 className="text-2xl font-semibold">Reports</h1>
        <p className="text-sm text-muted-foreground">
          Pick somebody and a period: what they weighed, what it earned, and what money changed
          hands.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2" data-print-hide>
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
      </div>

      {/* The list of people, and the report under it. Under rather than
          beside, because on a phone a sidebar is a row of nothing. */}
      <Card data-print-hide>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Username</TableHead>
                <TableHead>Role</TableHead>
                <TableHead className="text-right">&nbsp;</TableHead>
              </TableRow>
            </TableHeader>

            <TableBody>
              {roster.isLoading ? (
                Array.from({ length: 3 }, (_, index) => (
                  <TableRow key={index}>
                    {Array.from({ length: 4 }, (_, cell) => (
                      <TableCell key={cell}>
                        <Skeleton className="h-5 w-full" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : people.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="py-10 text-center text-muted-foreground">
                    Nobody to report on yet. Add people on the Operators screen.
                  </TableCell>
                </TableRow>
              ) : (
                people.map((person) => (
                  <TableRow
                    key={person.id}
                    className={`cursor-pointer ${chosen?.id === person.id ? 'bg-muted/60' : ''}`}
                    onClick={() => setChosen(person)}
                  >
                    <TableCell className="font-medium">{person.name}</TableCell>
                    <TableCell className="tabular text-muted-foreground">
                      {person.username}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="gap-1.5">
                        {person.role === 'ADMIN' && <ShieldCheck className="h-3.5 w-3.5" />}
                        {OPERATOR_ROLE_LABELS[person.role]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm">
                        <FileText className="h-4 w-4" />
                        View report
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {chosen && (
        <Card>
          <CardContent className="p-5">
            <div className="mb-3 flex justify-end" data-print-hide>
              <Button variant="ghost" size="sm" onClick={() => setChosen(null)}>
                <X className="h-4 w-4" />
                Close
              </Button>
            </div>

            {report.isLoading || !report.data ? (
              <div className="space-y-3">
                <Skeleton className="h-8 w-48" />
                <Skeleton className="h-24 w-full" />
                <Skeleton className="h-40 w-full" />
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
