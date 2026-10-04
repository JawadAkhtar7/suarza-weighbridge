/**
 * Small shared pieces of the ledger screens.
 *
 * Here rather than in @suarza/ui because it is specific to this one part of
 * one app: how a Mongo id reads in a table.
 *
 * There used to be an `Urdu` gloss component beside it, putting an Urdu term
 * next to every English one on the ledger. It is gone: the manager reads
 * English, and a second term beside every label was noise on a screen that
 * is mostly numbers. The RECEIPT keeps its Urdu — that is the customer's
 * copy and it has to match the pre-printed pad.
 */

import { cn } from '@suarza/ui';

/**
 * A Mongo id in a table: the last six characters, with the whole thing on
 * hover and available to copy.
 *
 * The full 24 characters are unreadable in a column and impossible to repeat
 * over the phone, but the short form is a label rather than an identifier —
 * two customers could in principle share it — so the real id is never more
 * than a hover away, and it is what the URL carries.
 */
export function CustomerId({ id, className }: { id: string; className?: string }) {
  return (
    <span
      title={id}
      className={cn('tabular cursor-help text-xs text-muted-foreground', className)}
    >
      …{id.slice(-6)}
    </span>
  );
}
