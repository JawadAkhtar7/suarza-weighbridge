/**
 * The measuring sheet, in its own tab (Settings -> Print).
 *
 * Printed onto ONE pad through exactly the same path as a slip — this tab,
 * the same page rules, the same printer — so its scales land with exactly
 * the error the slip's own values will. See MeasureSheet in @suarza/ui for
 * why that, and not a ruler, is what finally measures the boxes.
 *
 * On screen the scales are drawn over the pad's artwork so the operator can
 * see what to expect; only the scales reach the paper.
 *
 * The path still says `measure-pictures`: it is in the operator app's dev
 * proxy, in the agent's route list and in whatever browser tabs are open on
 * site, and renaming a URL to match a widened purpose is the kind of tidying
 * that is only ever noticed when it breaks something.
 */

import { useEffect } from 'react';
import { Button, MeasureSheet, SLIP_PAGE_CSS, SlipA5, type SlipValues } from '@suarza/ui';
import { Loader2, Printer, X } from 'lucide-react';
import { useReceiptSettings } from '../hooks/use-receipt-settings.js';

/** The URL this page lives at; opened in its own tab. */
export const MEASURE_PICTURES_PATH = '/measure-pictures';

export function MeasurePicturesPage() {
  const { settings, isLoaded } = useReceiptSettings();
  const boxes = settings.print.photo_boxes_mm;

  useEffect(() => {
    const style = document.createElement('style');
    style.textContent = SLIP_PAGE_CSS;
    document.head.appendChild(style);
    document.title = 'Measuring sheet';
    return () => style.remove();
  }, []);

  if (!isLoaded) {
    return (
      <div className="flex min-h-screen items-center justify-center gap-2 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        Loading…
      </div>
    );
  }

  return (
    <>
      <div className="min-h-screen bg-muted/40 py-6" data-slip-screen-only>
        <div className="mx-auto mb-4 max-w-[150mm] space-y-3 px-4">
          <div className="flex flex-wrap gap-2">
            <Button variant="brand" onClick={() => window.print()}>
              <Printer className="h-4 w-4" />
              Print on one pad
            </Button>
            <Button variant="ghost" className="ml-auto" onClick={() => window.close()}>
              <X className="h-4 w-4" />
              Close
            </Button>
          </div>
          <ol className="list-decimal space-y-2 pl-5 text-sm">
            <li>Put one pad in the printer and print this sheet.</li>
            <li>
              Every scale crosses one edge of one box on the pad. Read it at the{' '}
              <strong>middle of that box&apos;s line</strong> — for a picture box&apos;s top, where
              the green band ends. Long marks are whole millimetres, short marks halves; read to the
              nearest quarter.
            </li>
            <li>
              Scales numbered <strong>from zero</strong> — Slip no, Details, Weights — give you the
              answer directly. The number you read is what to type into Settings → Print →{' '}
              <strong>Print alignment</strong> for that group, minus sign and all. Zero means that
              edge is already right.
            </li>
            <li>
              Scales numbered in <strong>plain millimetres</strong> — Front and Side — are the two
              picture boxes. Type those four readings each into Settings → Print →{' '}
              <strong>Picture boxes</strong>. The pictures then print a little over the green line
              on every side.
            </li>
          </ol>

          <p className="text-xs text-muted-foreground">
            Two edges of one box should give the same reading; if they differ, the pad&apos;s box is
            a different size from the slip&apos;s, and halfway between the two readings centres it.
            Three things have no scale here and are set by eye: the date beside the slip number,
            which moves with Details anyway, and the date beside each weight&apos;s calendar icon.
            The slip number box has no left-hand scale either — the pad&apos;s green SLIP NO tab
            runs right up to that edge, and nothing printed on top of it could be read. Its
            right-hand scale answers the same question.
          </p>
        </div>

        {/* The scales over the pad's artwork, on screen only. */}
        <div className="relative mx-auto w-[140mm] bg-white shadow-sm">
          <SlipA5 view="template" values={{} as SlipValues} />
          <div className="absolute inset-0">
            <MeasureSheet boxes={boxes} />
          </div>
        </div>
      </div>

      {/* What actually prints: the scales alone. */}
      <div data-slip-print-only>
        <MeasureSheet boxes={boxes} />
      </div>
    </>
  );
}
