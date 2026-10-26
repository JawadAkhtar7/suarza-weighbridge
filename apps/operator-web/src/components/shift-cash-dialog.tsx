/**
 * Money changing hands, written down as it happens.
 *
 * ONE PERSON AND TWO FIGURES. It began as two blocks — a colleague and the
 * manager, four figures between them — which asked the operator to decide
 * which kind of person they were handing money to before they could record
 * it. The manager is in the same list of accounts as everybody else, so the
 * question was never worth asking: pick the name, say what went each way.
 *
 * The two amounts are labelled in Urdu. Every operator here reads it, not all
 * of them read English, and these two labels are the whole of what the form
 * asks — getting them the wrong way round is the one mistake it can make.
 *
 * EVERY SUBMISSION IS A NEW ENTRY, not a correction of the last one. Money
 * changes hands more than twice in a day, so the form opens empty each time
 * and what has already been written down is listed above it, with the time
 * on each line.
 *
 * Nothing here blocks the weighing screen. It opens once when a shift
 * starts, can be left for later, and is reachable from the header menu
 * whenever money actually moves. A form standing between an operator and a
 * truck is a form that gets filled with zeroes.
 */

import * as React from 'react';
import {
  Autocomplete,
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
} from '@suarza/ui';
import { formatTimePkt, type ShiftCashEntry, type ShiftCashMovement } from '@suarza/shared';
import { ArrowDownLeft, ArrowUpRight, UserRound } from 'lucide-react';

/** The slip's own Urdu face, already loaded by this app. */
const URDU = { fontFamily: "'Noto Naskh Arabic', serif" } as const;

/** What the two amount boxes are called. */
const LABELS = {
  taken: 'رقم جو آپ نے لی',
  given: 'رقم جو آپ نے دی',
} as const;

const toAmount = (value: string): number => {
  const parsed = Number(value.replace(/[^0-9.]/g, ''));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

/** A figure the operator types, with its direction said in the label. */
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
      <Label htmlFor={id} className="flex items-center gap-1.5 text-base font-medium">
        <Icon
          className={inbound ? 'h-4 w-4 text-emerald-600' : 'h-4 w-4 text-amber-600'}
          aria-hidden
        />
        <span dir="rtl" style={URDU}>
          {label}
        </span>
      </Label>
      <Input
        id={id}
        inputMode="numeric"
        className="tabular h-12 text-xl font-semibold"
        placeholder="0"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
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
      /* Older entries, from when the form asked about the manager
         separately. Nothing writes these any more. */
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
  /** The other accounts — operators and administrators alike. */
  operatorNames: string[];
  /** What this shift has written down already, oldest first. */
  recorded?: ShiftCashEntry[];
  busy?: boolean;
  onSubmit: (cash: ShiftCashMovement) => void;
  /** "I will do it later" — the form never stands in anybody's way. */
  onSkip: () => void;
}

export function ShiftCashDialog({
  open,
  operatorNames,
  recorded = [],
  busy = false,
  onSubmit,
  onSkip,
}: ShiftCashDialogProps) {
  const [who, setWho] = React.useState('');
  const [taken, setTaken] = React.useState('');
  const [given, setGiven] = React.useState('');

  /*
   * Empty each time the form opens, because each submission is a NEW
   * handing-over rather than a correction of the last.
   */
  React.useEffect(() => {
    if (!open) return;
    setWho('');
    setTaken('');
    setGiven('');
  }, [open]);

  const submit = () => {
    /*
     * Written into the `person` pair, which is where everything new goes.
     * The manager pair beside it in the record is only read, for entries
     * made when the form asked about the two separately.
     */
    onSubmit({
      person_name: who.trim(),
      person_taken: toAmount(taken),
      person_given: toAmount(given),
      manager_name: '',
      manager_taken: 0,
      manager_given: 0,
    });
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onSkip()}>
      <DialogContent
        className="max-h-[92vh] max-w-md overflow-y-auto"
        /*
         * Nothing is focused when this opens.
         *
         * The dialog focuses its first field by default, and the first
         * field here is the name box — which answered by unfurling its list
         * over the two amounts, unasked, every single time. It also keeps a
         * tablet's keyboard down until the operator actually taps a box.
         */
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Move money</DialogTitle>
        </DialogHeader>

        {/* What is already written down for this shift. Shown above the
            form, because an operator about to type a figure needs to know
            whether they have typed it already. */}
        {recorded.length > 0 && <AlreadyRecorded entries={recorded} />}

        <div className="space-y-4">
          {/* A dropdown that can also be typed into: the people are the
              accounts the manager keeps, but a stand-in nobody has entered
              must never be unenterable.
              
              No label above it: "Select Person" in the box says the same
              thing in the space the label would have taken, and this form is
              three fields long. */}
          <Autocomplete
            id="shift-cash-who"
            value={who}
            onValueChange={setWho}
            options={operatorNames.map((name) => ({ value: name, label: name }))}
            listLabel="People"
            emptyMessage="No saved names — type it in"
            placeholder="Select Person"
            optionIcon={UserRound}
            separateOptions
            /* The dialog does not focus this on open (see DialogContent),
               but a field that unfurls its list the moment it is touched
               would still cover the amounts underneath. */
            openOnFocus={false}
            className="h-12 text-base"
          />

          <AmountField
            id="shift-cash-taken"
            direction="in"
            label={LABELS.taken}
            value={taken}
            onChange={setTaken}
          />

          <AmountField
            id="shift-cash-given"
            direction="out"
            label={LABELS.given}
            value={given}
            onChange={setGiven}
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onSkip} disabled={busy}>
            Not now
          </Button>
          <Button variant="brand" onClick={submit} disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
