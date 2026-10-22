/**
 * Audit Logs: one day, the morning beside the night.
 *
 * Two columns, because that is the shape of the yard — one operator in the
 * morning, one at night — and a manager comparing them is comparing two
 * things, not reading one list. Each column answers what its shift did (how
 * many trucks, how much they were charged) and then, shift by shift, what
 * money changed hands at each end of it.
 *
 * Deliberately NOT a reconciliation. An earlier version worked out what was
 * left over and said whether a shift balanced; it was arithmetic the client
 * had not asked for, over figures nobody had checked yet, and it made a
 * simple record of a handover look like an accusation. What is here is the
 * record: who, when, how much, which way.
 *
 * One day at a time. Today by default, yesterday at a press, and any past
 * day from the calendar — the day a shift BEGAN, so a night that runs past
 * midnight stays on the night it started.
 */

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { DayPicker } from 'react-day-picker';
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
} from '@suarza/ui';
import {
  OPERATOR_SLOT_LABELS,
  SHIFTS,
  formatPKR,
  formatDatePkt,
  formatTimePkt,
  type Shift,
  type ShiftAudit,
  type ShiftCashEntry,
} from '@suarza/shared';
import {
  CalendarDays,
  Clock3,
  LogIn,
  LogOut,
  Moon,
  Scale,
  Sun,
  UserRound,
  Wallet,
} from 'lucide-react';
import { api } from '../lib/api.js';
import { resolveRange } from '../lib/date-ranges.js';

/** The two columns, and how each is dressed. */
const COLUMN = {
  MORNING: {
    icon: Sun,
    tint: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
    edge: 'before:bg-amber-500',
    /* The operator's own badge, in the shift's colour — so a name is found
       by the eye before it is read, the way the column is. */
    face: 'bg-gradient-to-br from-amber-400 to-orange-500 text-white',
  },
  NIGHT: {
    icon: Moon,
    tint: 'bg-indigo-500/10 text-indigo-700 dark:text-indigo-400',
    edge: 'before:bg-indigo-500',
    face: 'bg-gradient-to-br from-indigo-500 to-violet-600 text-white',
  },
} as const satisfies Record<Shift, { icon: typeof Sun; tint: string; edge: string; face: string }>;

/** `08:14 AM` — all a card needs, once the day is chosen above it. */
function clock(at: string): string {
  return formatTimePkt(at);
}

/** `7h 40m`, or how long a running shift has been going. */
function duration(shift: ShiftAudit): string {
  const end = shift.ended_at ? new Date(shift.ended_at).getTime() : Date.now();
  const minutes = Math.max(0, Math.round((end - new Date(shift.started_at).getTime()) / 60_000));
  const hours = Math.floor(minutes / 60);
  return `${hours > 0 ? `${hours}h ` : ''}${minutes % 60}m`;
}

/** The first letters of a name, for the dot beside it. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((part) => part[0]?.toUpperCase() ?? '').join('') || '?';
}

/** One figure, with its time, and the direction said in words, colour and sign. */
function Movement({
  direction,
  who,
  amount,
  at,
}: {
  direction: 'in' | 'out';
  who: string;
  amount: number;
  /** When it was written down — the point of keeping each one separately. */
  at: string;
}) {
  const inbound = direction === 'in';

  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="tabular shrink-0 text-xs text-muted-foreground">{clock(at)}</span>
      <span
        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
          inbound
            ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
            : 'bg-amber-500/15 text-amber-700 dark:text-amber-400'
        }`}
        aria-hidden
      >
        {inbound ? '+' : '−'}
      </span>

      <span className="min-w-0 flex-1 truncate text-muted-foreground">
        {inbound ? 'Took from' : 'Gave to'}{' '}
        <span className="font-medium text-foreground">{who.trim() || 'someone unnamed'}</span>
      </span>

      <span
        className={`tabular shrink-0 font-semibold ${
          inbound ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400'
        }`}
      >
        {formatPKR(amount)}
      </span>
    </div>
  );
}

/** Every line one movement produces — a movement may record up to four. */
function linesOf(entry: ShiftCashEntry) {
  return [
    entry.person_taken > 0 && {
      key: `${entry.id}-pt`,
      direction: 'in' as const,
      who: entry.person_name,
      amount: entry.person_taken,
    },
    entry.person_given > 0 && {
      key: `${entry.id}-pg`,
      direction: 'out' as const,
      who: entry.person_name,
      amount: entry.person_given,
    },
    entry.manager_taken > 0 && {
      key: `${entry.id}-mt`,
      direction: 'in' as const,
      who: entry.manager_name || 'the manager',
      amount: entry.manager_taken,
    },
    entry.manager_given > 0 && {
      key: `${entry.id}-mg`,
      direction: 'out' as const,
      who: entry.manager_name || 'the manager',
      amount: entry.manager_given,
    },
  ].filter(Boolean) as {
    key: string;
    direction: 'in' | 'out';
    who: string;
    amount: number;
  }[];
}

/**
 * One end of a shift: when it happened, and every movement recorded there.
 *
 * A list, not a set of four figures. An operator handed cash three times in
 * a morning has three things to show, each with its own time — which is the
 * whole reason the movements are kept separately rather than summed.
 */
function CashBlock({
  title,
  icon: Icon,
  at,
  tone,
  entries,
}: {
  title: string;
  icon: typeof LogIn;
  at: string | null;
  tone: 'start' | 'end';
  entries: ShiftCashEntry[];
}) {
  const lines = entries.flatMap((entry) =>
    linesOf(entry).map((line) => ({ ...line, at: entry.at })),
  );

  return (
    <div className="overflow-hidden rounded-lg border">
      {/* A tinted strip rather than a bare line of small caps: the two ends
          of a shift are the thing being compared, so each needs to be
          findable before it is read. */}
      <div
        className={`flex items-center justify-between gap-2 px-3 py-2 ${
          tone === 'start'
            ? 'bg-sky-500/10 text-sky-800 dark:text-sky-300'
            : 'bg-violet-500/10 text-violet-800 dark:text-violet-300'
        }`}
      >
        <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide">
          <Icon className="h-3.5 w-3.5" aria-hidden />
          {title}
          {lines.length > 1 && (
            <span className="font-normal normal-case opacity-80">· {lines.length} entries</span>
          )}
        </span>
        <span className="tabular text-sm font-bold">{at ? clock(at) : '—'}</span>
      </div>

      <div className="px-3 py-2.5">
        {lines.length === 0 ? (
          <p className="text-sm italic text-muted-foreground">
            {at ? 'No cash written down' : 'Shift still running'}
          </p>
        ) : (
          <div className="space-y-2">
            {lines.map((line) => (
              <Movement
                key={line.key}
                direction={line.direction}
                who={line.who}
                amount={line.amount}
                at={line.at}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ShiftCard({ shift }: { shift: ShiftAudit }) {
  const running = shift.ended_at === null;

  return (
    <Card className="overflow-hidden transition-shadow hover:shadow-md">
      <CardContent className="space-y-3 p-4">
        <div className="flex items-center gap-2.5">
          <span
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary"
            aria-hidden
          >
            {initials(shift.operator_name)}
          </span>

          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold leading-tight">{shift.operator_name}</p>
            <p className="tabular flex items-center gap-1 text-xs text-muted-foreground">
              <Clock3 className="h-3 w-3" aria-hidden />
              {clock(shift.started_at)} – {shift.ended_at ? clock(shift.ended_at) : 'now'}
            </p>
          </div>

          <Badge
            variant="secondary"
            className={
              running
                ? 'shrink-0 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                : 'shrink-0'
            }
          >
            {running ? 'On shift' : duration(shift)}
          </Badge>
        </div>

        {/* What the shift did, as two figures rather than two chips — this is
            the pair a manager reads first on every card. */}
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-lg bg-muted/60 px-3 py-2">
            <p className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
              <Scale className="h-3 w-3" aria-hidden />
              Weighings
            </p>
            <p className="tabular text-lg font-bold leading-tight">
              {shift.weighments.toLocaleString()}
            </p>
          </div>
          <div className="rounded-lg bg-muted/60 px-3 py-2">
            <p className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
              <Wallet className="h-3 w-3" aria-hidden />
              Earnings
            </p>
            <p className="tabular text-lg font-bold leading-tight">{formatPKR(shift.takings)}</p>
          </div>
        </div>

        <CashBlock
          title="During the shift"
          icon={LogIn}
          tone="start"
          at={shift.started_at}
          entries={shift.cash_entries.filter((entry) => entry.stage === 'START')}
        />

        <CashBlock
          title="At the end"
          icon={LogOut}
          tone="end"
          at={shift.ended_at}
          entries={shift.cash_entries.filter((entry) => entry.stage === 'END')}
        />
      </CardContent>
    </Card>
  );
}

/** One side of the screen: a shift's totals, then its shifts. */
function ShiftColumn({
  shift,
  rows,
  rosteredName,
  isLoading,
}: {
  shift: Shift;
  rows: ShiftAudit[];
  /**
   * Who holds this shift now, for a day on which nobody signed in.
   *
   * The name on a card is whoever actually worked; this is only the
   * fallback, so an empty column still says whose column it is.
   */
  rosteredName: string | null;
  isLoading: boolean;
}) {
  const column = COLUMN[shift];
  const Icon = column.icon;

  const weighments = rows.reduce((sum, row) => sum + row.weighments, 0);
  const takings = rows.reduce((sum, row) => sum + row.takings, 0);

  /* Whoever worked it on this day — the most recent of them, since the cards
     are newest first — and the roster only when nobody did. */
  const operatorName = rows[0]?.operator_name ?? rosteredName;

  return (
    <section className="space-y-3">
      {/* The totals first: what this shift did on this day, in two figures. */}
      <Card
        className={`relative overflow-hidden before:absolute before:inset-y-0 before:left-0 before:w-1 before:content-[""] ${column.edge}`}
      >
        <CardContent className="p-5 pl-6">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-md p-1.5 ${column.tint}`}>
              <Icon className="h-4 w-4" aria-hidden />
            </span>
            <h2 className="text-lg font-semibold">{OPERATOR_SLOT_LABELS[shift]} shift</h2>

            {/* The name belongs in the heading: a manager looking at this
                screen is looking at two people as much as two shifts. */}
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="text-muted-foreground">—</span>
              <span
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full shadow-sm ${column.face}`}
                aria-hidden
              >
                <UserRound className="h-3.5 w-3.5" />
              </span>
              <span className="truncate text-lg font-semibold">
                {operatorName ?? <span className="text-muted-foreground">nobody</span>}
              </span>
            </span>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Weighings</p>
              <p className="tabular text-2xl font-bold leading-tight">
                {isLoading ? '—' : weighments.toLocaleString()}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Earnings</p>
              <p className="tabular text-2xl font-bold leading-tight">
                {isLoading ? '—' : formatPKR(takings)}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            Nobody signed in on this shift.
          </CardContent>
        </Card>
      ) : (
        rows.map((row) => <ShiftCard key={row.session_id} shift={row} />)
      )}
    </section>
  );
}

export function AuditLogsPage() {
  /** The day on screen. Today until the manager picks another. */
  const [day, setDay] = useState<Date>(() => new Date());
  const [pickerOpen, setPickerOpen] = useState(false);

  const range = useMemo(() => resolveRange('custom', { from: day, to: day }), [day]);

  /* Only for the heading of a column nobody signed into on this day. */
  const roster = useQuery({ queryKey: ['roster'], queryFn: api.roster });

  const audit = useQuery({
    queryKey: ['shift-audit', range.from, range.to],
    queryFn: () => api.shiftAudit(range),
    placeholderData: (previous) => previous,
  });

  const rows = audit.data?.rows ?? [];
  const forShift = (shift: Shift) => rows.filter((row) => row.slot === shift);
  /* The administrator belongs to neither column — they work no shift — so
     they get their own row underneath rather than being filed under one. */
  const admins = rows.filter((row) => row.slot === 'ADMIN');

  const today = new Date();
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
  const sameDay = (a: Date, b: Date) => formatDatePkt(a) === formatDatePkt(b);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Audit Logs</h1>
          <p className="text-sm text-muted-foreground">
            Each shift on {formatDatePkt(day)}, and the cash that changed hands at its two ends.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant={sameDay(day, today) ? 'default' : 'outline'}
            onClick={() => setDay(new Date())}
          >
            Today
          </Button>
          <Button
            type="button"
            size="sm"
            variant={sameDay(day, yesterday) ? 'default' : 'outline'}
            onClick={() => setDay(yesterday)}
          >
            Yesterday
          </Button>
          <Button
            type="button"
            size="sm"
            variant={!sameDay(day, today) && !sameDay(day, yesterday) ? 'default' : 'outline'}
            onClick={() => setPickerOpen(true)}
          >
            <CalendarDays className="h-4 w-4" />
            {formatDatePkt(day)}
          </Button>
        </div>
      </div>

      {/* Side by side on a desktop, stacked on a phone — where two columns
          would be two narrow columns of nothing. */}
      <div className="grid gap-4 lg:grid-cols-2">
        {SHIFTS.map((shift) => (
          <ShiftColumn
            key={shift}
            shift={shift}
            rows={forShift(shift)}
            rosteredName={
              roster.data?.operators.find((person) => person.slot === shift)?.name ?? null
            }
            isLoading={audit.isLoading}
          />
        ))}
      </div>

      {admins.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Administrator</h2>
          <div className="grid gap-4 lg:grid-cols-2">
            {admins.map((row) => (
              <ShiftCard key={row.session_id} shift={row} />
            ))}
          </div>
        </section>
      )}

      <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
        <DialogContent className="max-w-fit">
          <DialogHeader>
            <DialogTitle>Choose a day</DialogTitle>
          </DialogHeader>

          <DayPicker
            mode="single"
            selected={day}
            onSelect={(picked) => {
              if (!picked) return;
              setDay(picked);
              setPickerOpen(false);
            }}
            numberOfMonths={1}
            // Nobody needs the shifts of a day that has not happened yet.
            disabled={{ after: new Date() }}
            className="rdp-suarza"
          />

          <DialogFooter>
            <Button variant="outline" onClick={() => setPickerOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
