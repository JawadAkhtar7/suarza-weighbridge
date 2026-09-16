/**
 * Small shared pieces of the ledger screens.
 *
 * Both live here rather than in @suarza/ui because they are specific to this
 * one part of one app: the Urdu is on the ledger only, and the id shortening
 * is about how Mongo ids read in a table.
 */

import { cn } from '@suarza/ui';

/**
 * An Urdu gloss beside its English label.
 *
 * Beside, never instead of: the screen is used by people who read one, the
 * other, or both, and the English terms are also what the manager will find in
 * any accounts package they move to later.
 *
 * `dir="rtl"` with `unicode-bidi: isolate` stops the right-to-left run from
 * dragging the surrounding English about — the same rule the receipt uses.
 */
export function Urdu({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span dir="rtl" className={cn('urdu text-xs font-normal text-muted-foreground', className)}>
      {children}
    </span>
  );
}

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
