/**
 * The manager's own pocket.
 *
 * A manager is a party to the same handovers the operators write down — the
 * day's takings come in at the end of a shift, a float goes out at the
 * start — and until now they could only watch those from the other side.
 * This is the same ledger read from theirs, with a way to write down the
 * movements that happen at the office rather than at the window.
 *
 * Two figures, and they answer different questions. What is in hand NOW is
 * every movement ever, because a pocket does not reset at midnight. What
 * moved in the chosen period is the day's story. Showing only the second
 * would have a manager reading "0" on a quiet morning while holding a
 * week's takings.
 */

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DayPicker, type DateRange as PickerRange } from 'react-day-picker';
import {
  Autocomplete,
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
  Label,
  Skeleton,
  toast,
} from '@suarza/ui';
import {
  formatDatePkt,
  formatPKR,
  formatTimePkt,
  type ManagerPocket,
  type ReportActivity,
} from '@suarza/shared';
import {
  ArrowDownLeft,
  ArrowUpRight,
  CalendarDays,
  HandCoins,
  Scale,
  UserRound,
  Wallet,
} from 'lucide-react';
import { api, ApiError } from '../lib/api.js';
import { resolveRange, type RangeKey } from '../lib/date-ranges.js';
import { useCountUp } from '../lib/use-count-up.js';

/** The slip's own Urdu face, already loaded by this app. */
const URDU = { fontFamily: "'Noto Naskh Arabic', serif" } as const;

/**
 * What the two cards are called.
 *
 * In Urdu, because the figures are read aloud to the people they are about
 * — and because "the pocket" is the yard's own word for this, not a phrase
 * anybody translated for a screen.
 */
const KHAATA = {
  all: 'کل کھاتہ',
  today: 'آج کا کھاتہ',
  yesterday: 'کل کا کھاتہ',
  /** `کھاتہ 01 Oct 2026 سے 15 Oct 2026 تک` — the dates stay as they read. */
  between: (from: string, to: string) => `کھاتہ ${from} سے ${to} تک`,
} as const;

/** The ranges offered, in the order a manager reaches for them. */
const RANGES: { key: RangeKey; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
];

const parseAmount = (value: string): number => {
  const parsed = Number(value.replace(/[^0-9.]/g, ''));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

/** A figure that counts up to itself when it lands. */
function Money({ value }: { value: number }) {
  const shown = useCountUp(value);
  return <>{formatPKR(Math.round(shown))}</>;
}

/**
 * The headline card: what is in the pocket, and what went each way.
 *
 * The net is the figure; the two directions beneath it are how it got
 * there. A single number with no working shown is a number people argue
 * with.
 */
function PocketCard({
  title,
  net,
  taken,
  given,
  tone,
  delay,
}: {
  /** In Urdu, and drawn in the Urdu face — see KHAATA. */
  title: string;
  net: number;
  taken: number;
  given: number;
  tone: 'now' | 'range';
  delay: number;
}) {
  const negative = net < 0;

  return (
    <Card className="pocket-rise relative overflow-hidden" style={{ animationDelay: `${delay}ms` }}>
      {/* A wash of colour behind the figure rather than on it: the number
          stays in ink, which is the one thing that must read at a glance. */}
      <div
        className={`pointer-events-none absolute inset-0 ${
          tone === 'now'
            ? 'bg-gradient-to-br from-primary/10 via-transparent to-brand/10'
            : 'bg-gradient-to-br from-sky-500/10 via-transparent to-transparent'
        }`}
      />

      <CardContent className="relative space-y-3 p-5">
        <div className="flex items-start justify-between gap-2">
          <p dir="rtl" style={URDU} className="text-xl font-semibold leading-snug">
            {title}
          </p>
          <span
            className={`rounded-lg p-2 ${
              tone === 'now' ? 'bg-primary/15 text-primary' : 'bg-sky-500/15 text-sky-600'
            }`}
            aria-hidden
          >
            {tone === 'now' ? <Wallet className="h-5 w-5" /> : <Scale className="h-5 w-5" />}
          </span>
        </div>

        <p
          className={`tabular text-4xl font-bold leading-none ${
            negative ? 'text-rose-600 dark:text-rose-400' : 'text-foreground'
          }`}
        >
          <Money value={net} />
        </p>

        <div className="flex flex-wrap gap-2 text-sm">
          <span className="flex items-center gap-1.5 rounded-md bg-emerald-500/10 px-2 py-1 font-medium text-emerald-700 dark:text-emerald-400">
            <ArrowDownLeft className="h-3.5 w-3.5" aria-hidden />
            {formatPKR(taken)} in
          </span>
          <span className="flex items-center gap-1.5 rounded-md bg-amber-500/10 px-2 py-1 font-medium text-amber-700 dark:text-amber-400">
            <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
            {formatPKR(given)} out
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

/** One movement, as a line in the list. */
function Movement({ movement, index }: { movement: ReportActivity; index: number }) {
  const inbound = movement.kind === 'MONEY_TAKEN';

  return (
    <li
      className={`pocket-rise flex items-center gap-3 p-3 text-sm transition-colors hover:bg-muted/40 ${
        inbound ? 'bg-emerald-500/5' : 'bg-amber-500/5'
      }`}
      style={{ animationDelay: `${Math.min(index, 10) * 35}ms` }}
    >
      <span
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
          inbound
            ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
            : 'bg-amber-500/15 text-amber-700 dark:text-amber-400'
        }`}
        aria-hidden
      >
        {inbound ? <ArrowDownLeft className="h-4 w-4" /> : <ArrowUpRight className="h-4 w-4" />}
      </span>

      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">
          {inbound ? 'Took from' : 'Gave to'} {movement.counterpart || 'someone unnamed'}
        </span>
        <span className="tabular block text-xs text-muted-foreground">
          {formatDatePkt(movement.at)} · {formatTimePkt(movement.at)}
          {movement.recorded_by && ` · recorded by ${movement.recorded_by}`}
        </span>
      </span>

      <span
        className={`tabular shrink-0 text-base font-bold ${
          inbound ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400'
        }`}
      >
        {inbound ? '+' : '−'}
        {formatPKR(movement.amount)}
      </span>
    </li>
  );
}

export function ManagerPage() {
  const queryClient = useQueryClient();

  const [rangeKey, setRangeKey] = useState<RangeKey>('today');
  const [custom, setCustom] = useState<{ from?: Date; to?: Date }>({});
  const [pickerOpen, setPickerOpen] = useState(false);
  const [draftRange, setDraftRange] = useState<PickerRange | undefined>();

  const [moveOpen, setMoveOpen] = useState(false);
  const [who, setWho] = useState('');
  const [taken, setTaken] = useState('');
  const [given, setGiven] = useState('');

  const range = useMemo(() => resolveRange(rangeKey, custom), [rangeKey, custom]);

  const roster = useQuery({ queryKey: ['roster'], queryFn: api.roster });
  const names = (roster.data?.operators ?? []).map((person) => person.name);

  const pocket = useQuery({
    queryKey: ['manager-pocket', range.from, range.to],
    queryFn: () =>
      api.managerPocket({
        from: range.from ?? new Date(0).toISOString(),
        to: range.to ?? new Date().toISOString(),
      }),
    placeholderData: (previous) => previous,
  });

  const record = useMutation({
    mutationFn: () =>
      api.recordManagerCash({
        person_name: who.trim(),
        taken: parseAmount(taken),
        given: parseAmount(given),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['manager-pocket'] });
      setMoveOpen(false);
      setWho('');
      setTaken('');
      setGiven('');
      toast.success('Money written down');
    },
    onError: (error) =>
      toast.error('Could not save it', {
        description: error instanceof ApiError ? error.message : 'Unexpected error.',
      }),
  });

  const data: ManagerPocket | undefined = pocket.data;

  const customLabel =
    custom.from && custom.to
      ? `${formatDatePkt(custom.from)} – ${formatDatePkt(custom.to)}`
      : 'Pick dates';

  const rangeLabel =
    rangeKey === 'today' ? 'Today' : rangeKey === 'yesterday' ? 'Yesterday' : customLabel;

  /* The same period, as the card says it. */
  const rangeKhaata =
    rangeKey === 'today'
      ? KHAATA.today
      : rangeKey === 'yesterday'
        ? KHAATA.yesterday
        : custom.from && custom.to
          ? KHAATA.between(formatDatePkt(custom.from), formatDatePkt(custom.to))
          : KHAATA.between('—', '—');

  return (
    <div className="space-y-6">
      {/* Two small movements, both of which stop. A page that keeps moving
          is a page nobody can read. */}
      <style>{`
        @keyframes pocketRise {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: none; }
        }
        .pocket-rise { animation: pocketRise 380ms cubic-bezier(0.22, 1, 0.36, 1) both; }
        @media (prefers-reduced-motion: reduce) { .pocket-rise { animation: none; } }
      `}</style>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Manager</h1>
          <p className="text-sm text-muted-foreground">
            {data ? `${data.manager_name}'s pocket` : 'Your pocket'}
          </p>
        </div>

        <Button variant="brand" onClick={() => setMoveOpen(true)}>
          <HandCoins className="h-4 w-4" />
          Move money
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {pocket.isLoading || !data ? (
          <>
            <Skeleton className="h-44 w-full" />
            <Skeleton className="h-44 w-full" />
          </>
        ) : (
          <>
            <PocketCard
              title={KHAATA.all}
              net={data.all_time_net}
              taken={data.all_time_taken}
              given={data.all_time_given}
              tone="now"
              delay={0}
            />
            <PocketCard
              title={rangeKhaata}
              net={data.range_net}
              taken={data.range_taken}
              given={data.range_given}
              tone="range"
              delay={80}
            />
          </>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
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

      <Card>
        <CardContent className="p-0">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
            <h2 className="text-sm font-bold uppercase tracking-wide text-primary">
              Movements · {rangeLabel}
            </h2>
            {data && (
              <Badge variant="secondary" className="tabular">
                {data.movements.length} entr{data.movements.length === 1 ? 'y' : 'ies'}
              </Badge>
            )}
          </div>

          {pocket.isLoading || !data ? (
            <div className="space-y-2 p-4">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : data.movements.length === 0 ? (
            <p className="p-10 text-center text-sm text-muted-foreground">
              No money changed hands in this period.
            </p>
          ) : (
            <ul className="divide-y">
              {data.movements.map((movement, index) => (
                <Movement key={movement.id} movement={movement} index={index} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Writing one down. The same two figures the operators are asked for,
          from this side of the handover. */}
      <Dialog open={moveOpen} onOpenChange={setMoveOpen}>
        <DialogContent
          className="max-w-md"
          /* Nothing focused on open, so the name list does not unfurl over
             the amounts before anybody has asked it to. */
          onOpenAutoFocus={(event) => event.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>Move money</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <Autocomplete
              id="manager-cash-who"
              value={who}
              onValueChange={setWho}
              options={names.map((name) => ({ value: name, label: name }))}
              listLabel="People"
              emptyMessage="No saved names — type it in"
              placeholder="Select Person"
              optionIcon={UserRound}
              separateOptions
              openOnFocus={false}
              className="h-12 text-base"
            />

            <div className="space-y-1">
              <Label
                htmlFor="manager-cash-taken"
                className="flex items-center gap-1.5 text-sm font-medium"
              >
                <ArrowDownLeft className="h-4 w-4 text-emerald-600" aria-hidden />
                Money you took
              </Label>
              <Input
                id="manager-cash-taken"
                inputMode="numeric"
                className="tabular h-12 text-xl font-semibold"
                placeholder="0"
                value={taken}
                onChange={(event) => setTaken(event.target.value)}
              />
            </div>

            <div className="space-y-1">
              <Label
                htmlFor="manager-cash-given"
                className="flex items-center gap-1.5 text-sm font-medium"
              >
                <ArrowUpRight className="h-4 w-4 text-amber-600" aria-hidden />
                Money you gave
              </Label>
              <Input
                id="manager-cash-given"
                inputMode="numeric"
                className="tabular h-12 text-xl font-semibold"
                placeholder="0"
                value={given}
                onChange={(event) => setGiven(event.target.value)}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setMoveOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="brand"
              disabled={record.isPending || who.trim() === ''}
              onClick={() => record.mutate()}
            >
              {record.isPending ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
            // Nobody needs the money of a day that has not happened yet.
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
