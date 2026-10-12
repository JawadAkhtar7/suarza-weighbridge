/**
 * The picture-box measuring sheet, in its own tab (Settings -> Print).
 *
 * Printed onto ONE pad through exactly the same path as a slip — this tab,
 * the same page rules, the same printer — so its scales land with exactly
 * the error the photographs will. See MeasureSheet in @suarza/ui for why
 * that, and not a ruler, is what finally measures the boxes.
 *
 * On screen the scales are drawn over the pad's artwork so the operator can
 * see what to expect; only the scales reach the paper.
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
    document.title = 'Picture boxes — measuring sheet';
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
          <ol className="list-decimal space-y-1 pl-5 text-sm">
            <li>Put one pad in the printer and print this sheet.</li>
            <li>
              Each scale crosses one edge of a picture box. Read the number at the{' '}
              <strong>middle of the green line</strong> — for the top, where the green band ends.
              Long marks are whole millimetres, short marks halves; read to the nearest quarter.
            </li>
            <li>
              Type the eight readings into Settings → Print → <strong>Picture boxes</strong> and
              save. The pictures then print there, a little over the green line on every side.
            </li>
          </ol>
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
