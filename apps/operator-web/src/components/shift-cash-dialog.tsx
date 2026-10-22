/**
 * The money an operator takes and gives at each end of their shift.
 *
 * FOUR FIGURES AT EACH END. Cash moves both ways at a handover: an operator
 * arriving may be handed the night's takings and hand back a float in the
 * same minute, and the same is true when they leave. Asking only "what did
 * you take" at the start and only "what did you give" at the end produced a
 * record that looked wrong whenever the yard did something ordinary.
 *
 * THE WORDING IS THE FEATURE. The people filling this in are weighbridge
 * operators, not accountants, and "received" and "disbursed" would be
 * guessed at rather than read. So the screen says what physically happened:
 * money *you took from* somebody, money *you gave to* somebody.
 *
 * The names come from a list and can be typed over. The operator on the
 * other shift and the manager are the same two people nearly every day, and
 * a dropdown is faster than a keyboard with a truck on the bridge — but a
 * stand-in nobody has entered must never be unenterable.
 *
 * EVERY SUBMISSION IS A NEW ENTRY, not a correction of the last one. Money
 * changes hands more than twice in a day — the manager collects at noon, a
 * colleague covers an hour — so the form opens empty each time and what has
 * already been written down is listed above it, with the time on each line.
 *
 * Nothing here blocks the weighing screen. At the start it can be left for
 * later and opened again from the header; at the end the shift ends whether
 * or not it is filled in. A form standing between an operator and a truck is
 * a form that gets filled with zeroes.
 */

import * as React from 'react';
import {
  Autocomplete,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
} from '@suarza/ui';
import { formatTimePkt, type ShiftCashEntry, type ShiftCashMovement } from '@suarza/shared';
import { ArrowDownLeft, ArrowUpRight } from 'lucide-react';

/** The managers whose names have been typed here before. */
const MANAGER_KEY = 'suarza.shift.manager-names';

function readManagerNames(): string[] {
  try {
    const raw = window.localStorage.getItem(MANAGER_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return Array.isArray(parsed)
      ? parsed.filter((name): name is string => typeof name === 'string')
      : [];
  } catch {
    return [];
  }
}

function rememberManagerName(name: string): void {
  const trimmed = name.trim();
  if (!trimmed) return;
  try {
    const kept = [trimmed, ...readManagerNames().filter((old) => old !== trimmed)].slice(0, 5);
    window.localStorage.setItem(MANAGER_KEY, JSON.stringify(kept));
  } catch {
    // Only a convenience; the box still accepts anything typed into it.
  }
}

const toAmount = (value: string): number => {
  const parsed = Number(value.replace(/[^0-9.]/g, ''));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

/** A figure the operator types, with its direction said in words. */
function AmountField({
  id,
  label,
  direction,
  value,
  onChange,
}: {
  id: string;
  label: string;
  direction: 'in' | 'out';
  value: string;
  onChange: (value: string) => void;
}) {
  const inbound = direction === 'in';
  const Icon = inbound ? ArrowDownLeft : ArrowUpRight;

  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="flex items-center gap-1.5 text-xs font-normal">
        <Icon
          className={inbound ? 'h-3.5 w-3.5 text-emerald-600' : 'h-3.5 w-3.5 text-amber-600'}
          aria-hidden
        />
        {label}
      </Label>
      <Input
        id={id}
        inputMode="numeric"
        className="tabular text-base font-semibold"
        placeholder="0"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

/** One counterpart: who they are, what you took, what you gave. */
function CounterpartBlock({
  id,
  heading,
  whoLabel,
  names,
  who,
  onWho,
  taken,
  onTaken,
  given,
  onGiven,
}: {
  id: string;
  heading: string;
  whoLabel: string;
  names: string[];
  who: string;
  onWho: (value: string) => void;
  taken: string;
  onTaken: (value: string) => void;
  given: string;
  onGiven: (value: string) => void;
}) {
  return (
    <div className="space-y-3 rounded-lg border p-3">
      <p className="text-sm font-semibold">{heading}</p>

      <div className="space-y-1">
        <Label htmlFor={`${id}-who`} className="text-xs font-normal text-muted-foreground">
          {whoLabel}
        </Label>
        <Autocomplete
          id={`${id}-who`}
          value={who}
          onValueChange={onWho}
          options={names.map((name) => ({ value: name, label: name }))}
          listLabel={whoLabel}
          emptyMessage="No saved names — type it in"
          placeholder="Choose a name, or type one"
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <AmountField
          id={`${id}-taken`}
          direction="in"
          label="Money you TOOK (PKR)"
          value={taken}
          onChange={onTaken}
        />
        <AmountField
          id={`${id}-given`}
          direction="out"
          label="Money you GAVE (PKR)"
          value={given}
          onChange={onGiven}
        />
      </div>
    </div>
  );
}

/** The movements this shift has already written down, with their times. */
function AlreadyRecorded({ entries }: { entries: ShiftCashEntry[] }) {
  const lines = entries.flatMap((entry) => {
    const at = formatTimePkt(entry.at);
    return [
      entry.person_taken > 0 && {
        key: `${entry.id}-pt`,
        at,
        text: `Took ${entry.person_taken} from ${entry.person_name || 'someone'}`,
        inbound: true,
      },
      entry.person_given > 0 && {
        key: `${entry.id}-pg`,
        at,
        text: `Gave ${entry.person_given} to ${entry.person_name || 'someone'}`,
        inbound: false,
      },
      entry.manager_taken > 0 && {
        key: `${entry.id}-mt`,
        at,
        text: `Took ${entry.manager_taken} from ${entry.manager_name || 'the manager'}`,
        inbound: true,
      },
      entry.manager_given > 0 && {
        key: `${entry.id}-mg`,
        at,
        text: `Gave ${entry.manager_given} to ${entry.manager_name || 'the manager'}`,
        inbound: false,
      },
    ].filter(Boolean) as { key: string; at: string; text: string; inbound: boolean }[];
  });

  if (lines.length === 0) return null;

  return (
    <div className="rounded-lg bg-muted/60 p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Already written down today
      </p>
      <ul className="mt-2 space-y-1">
        {lines.map((line) => (
          <li key={line.key} className="flex items-center gap-2 text-sm">
            <span className="tabular shrink-0 text-xs text-muted-foreground">{line.at}</span>
            <span
              className={
                line.inbound
                  ? 'text-emerald-700 dark:text-emerald-400'
                  : 'text-amber-700 dark:text-amber-400'
              }
            >
              {line.text}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export interface ShiftCashDialogProps {
  open: boolean;
  /** Which end of the shift this is. */
  stage: 'start' | 'end';
  /** Names to choose from: the other operators on the roster. */
  operatorNames: string[];
  /** The likeliest counterpart, filled in until the operator says otherwise. */
  counterpartName?: string;
  /** What this shift has written down already, oldest first. */
  recorded?: ShiftCashEntry[];
  busy?: boolean;
  onSubmit: (cash: ShiftCashMovement) => void;
  /** Start: "I will do it later". End: end the shift without the figures. */
  onSkip: () => void;
}

export function ShiftCashDialog({
  open,
  stage,
  operatorNames,
  counterpartName = '',
  recorded = [],
  busy = false,
  onSubmit,
  onSkip,
}: ShiftCashDialogProps) {
  const starting = stage === 'start';
  const managerNames = React.useMemo(readManagerNames, [open]);

  const [personName, setPersonName] = React.useState('');
  const [personTaken, setPersonTaken] = React.useState('');
  const [personGiven, setPersonGiven] = React.useState('');
  const [managerName, setManagerName] = React.useState('');
  const [managerTaken, setManagerTaken] = React.useState('');
  const [managerGiven, setManagerGiven] = React.useState('');

  /*
   * Empty figures each time the form opens, because each submission is a NEW
   * handing-over rather than a correction of the last. Only the names carry
   * over — they are the same two people most of the day.
   *
   * Keyed on `open` alone: the roster arrives after the first render, and
   * re-running this when it does would wipe whatever the operator had begun
   * typing.
   */
  React.useEffect(() => {
    if (!open) return;
    setPersonName(counterpartName);
    setPersonTaken('');
    setPersonGiven('');
    setManagerName(managerNames[0] ?? '');
    setManagerTaken('');
    setManagerGiven('');
  }, [open]);

  /* The counterpart arrives with the roster, a moment after the form opens —
     but never over a name the operator has chosen. */
  React.useEffect(() => {
    setPersonName((current) => current || counterpartName);
  }, [counterpartName]);

  const submit = () => {
    rememberManagerName(managerName);

    onSubmit({
      person_name: personName.trim(),
      person_taken: toAmount(personTaken),
      person_given: toAmount(personGiven),
      manager_name: managerName.trim(),
      manager_taken: toAmount(managerTaken),
      manager_given: toAmount(managerGiven),
    });
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onSkip()}>
      <DialogContent className="max-h-[92vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {starting ? 'Cash at the start of your shift' : 'Cash at the end of your shift'}
          </DialogTitle>
          <DialogDescription>
            Write down the money that changed hands. Put 0 where nothing did.
          </DialogDescription>
        </DialogHeader>

        {/* What is already written down for this shift. Shown above the
            form, because an operator about to type a figure needs to know
            whether they have typed it already. */}
        {recorded.length > 0 && <AlreadyRecorded entries={recorded} />}

        <div className="space-y-3">
          <CounterpartBlock
            id="shift-cash-person"
            heading={starting ? 'The operator before you' : 'The operator after you'}
            whoLabel="Their name"
            names={operatorNames}
            who={personName}
            onWho={setPersonName}
            taken={personTaken}
            onTaken={setPersonTaken}
            given={personGiven}
            onGiven={setPersonGiven}
          />

          <CounterpartBlock
            id="shift-cash-manager"
            heading="The manager"
            whoLabel="Manager's name"
            names={managerNames}
            who={managerName}
            onWho={setManagerName}
            taken={managerTaken}
            onTaken={setManagerTaken}
            given={managerGiven}
            onGiven={setManagerGiven}
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onSkip} disabled={busy}>
            {starting ? 'Not now' : 'End shift without this'}
          </Button>
          <Button variant="brand" onClick={submit} disabled={busy}>
            {busy ? 'Saving…' : starting ? 'Save' : 'Save and end shift'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
