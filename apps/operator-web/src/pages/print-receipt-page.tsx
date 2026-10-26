/**
 * The printable slip, in its own tab (operator feedback).
 *
 * Opened with `window.open` from the weighing screens rather than printed from
 * a hidden frame, so the operator can see exactly what is about to come out,
 * print it again without redoing the weighing, and close it when they are done
 * — all without leaving the weighing screen behind it.
 *
 * TWO slips are rendered here, and only ever one reaches paper:
 *
 *   on screen   the whole design, so the operator sees the finished slip
 *   on paper    the values alone, and nothing else
 *
 * They are the same component reading the same coordinates, so a value cannot
 * sit in one place on screen and another on the paper. The paper the operator
 * feeds in already carries the design; the printer only has to add what this
 * particular weighing says.
 */

import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button, SlipA5, SLIP_PAGE_CSS, WhatsAppShareButton, slipValues } from '@suarza/ui';
import { Loader2, Printer, X } from 'lucide-react';
import { agentApi, captureImageUrl } from '../lib/api.js';
import { useReceiptSettings } from '../hooks/use-receipt-settings.js';
import { buildReceiptUrl } from '../lib/receipt-settings.js';

export interface PrintRequest {
  slipNumber: string;
  variant: 'FIRST' | 'SECOND';
}

/** Reads the request out of the URL this tab was opened with. */
export function parsePrintRequest(url: URL): PrintRequest | null {
  const match = /^\/print\/([^/]+)\/?$/.exec(url.pathname);
  if (!match) return null;

  const variant = url.searchParams.get('variant');

  return {
    slipNumber: decodeURIComponent(match[1]!),
    variant: variant === 'FIRST' ? 'FIRST' : 'SECOND',
  };
}

export function PrintReceiptPage({ request }: { request: PrintRequest }) {
  const { settings, isLoaded } = useReceiptSettings();
  const printedOnce = useRef(false);
  /* The on-screen slip, which is what WhatsApp sends: the whole design, not
     the values-only sheet the printer gets. */
  const slipRef = useRef<HTMLDivElement>(null);

  /*
   * A deadline on waiting for the camera stills.
   *
   * The auto-print gate waits for that query to settle, and nothing in the
   * agent client sets a request timeout — so a call that hangs rather than
   * failing would leave the slip on screen with no print dialog, forever,
   * and the operator with a truck on the bridge and no paper.
   *
   * Six seconds. The tab opens about a second before a main-stream still has
   * landed, and a camera that has died costs two digest requests at 2.5 s
   * each before the agent gives up on it — this covers that, and the agent's
   * `pending` flag ends the wait as soon as the pictures are in. The pictures
   * are worth a short wait and nothing more.
   */
  const [stillsDeadlinePassed, setStillsDeadlinePassed] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setStillsDeadlinePassed(true), 6000);
    return () => window.clearTimeout(timer);
  }, []);

  const query = useQuery({
    queryKey: ['print-receipt', request.slipNumber],
    queryFn: () => agentApi.getWeighment(request.slipNumber),
    retry: false,
  });

  const weighment = query.data?.weighment;

  /*
   * The camera stills for this slip, if the bridge has cameras.
   *
   * A separate query so a slow or missing answer cannot delay the slip: it
   * resolves to nulls, SlipA5 falls back to the bundled placeholder, and the
   * paper still comes out. `retry: false` for the same reason — a bridge with
   * no cameras must not spend three attempts discovering that.
   *
   * Asked again while the agent says the cameras are still being read: this
   * tab opens the moment the weighing is saved, about a second before the
   * stills land, and the first answer is nearly always "not yet".
   */
  const captures = useQuery({
    queryKey: ['captures', request.slipNumber],
    queryFn: () => agentApi.slipCaptures(request.slipNumber),
    retry: false,
    refetchInterval: (q) => (q.state.data?.pending && !stillsDeadlinePassed ? 300 : false),
  });
  const stillsSettled = (captures.isFetched && !captures.data?.pending) || stillsDeadlinePassed;

  /*
   * The print dialog opens by itself once the slip, the settings AND the
   * camera stills have settled.
   *
   * Settings, because printing before they land would use the wrong offsets
   * and the operator would only find out from the paper. Stills, because a
   * slip that goes to the printer before its pictures have loaded prints two
   * empty boxes — and nobody re-reads a slip they have already torn off.
   *
   * `isFetched` rather than success: a bridge with no cameras, or one whose
   * camera is unplugged, settles into "asked and answered with nothing" and
   * must print exactly then rather than waiting for a picture that is not
   * coming.
   *
   * Then the <img>s themselves are waited for: knowing a still's URL is not
   * having its 4 MP JPEG decoded, and the print snapshot does not wait.
   */
  useEffect(() => {
    if (!weighment || !isLoaded || !stillsSettled || printedOnce.current) return;
    if (!settings.auto_print) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      // A picture that fails to load must not stop the paper.
      const decoded = Array.from(document.images, (img) => img.decode().catch(() => undefined));
      const cap = new Promise((done) => window.setTimeout(done, 3000));
      void Promise.race([Promise.all(decoded), cap]).then(() => {
        // Marked here, not when scheduled: a re-render during the wait
        // cancels this attempt and must leave the next one free to print.
        if (cancelled || printedOnce.current) return;
        printedOnce.current = true;
        window.print();
      });
    }, 350);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [weighment, isLoaded, stillsSettled, settings.auto_print]);

  // The page rules have to be in the document itself here, not handed to a
  // print library — this tab IS the print document.
  useEffect(() => {
    const style = document.createElement('style');
    style.textContent = SLIP_PAGE_CSS;
    document.head.appendChild(style);
    return () => style.remove();
  }, []);

  useEffect(() => {
    document.title = `${request.slipNumber} — slip`;
  }, [request.slipNumber]);

  if (query.isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center gap-2 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        Loading slip…
      </div>
    );
  }

  if (!weighment) {
    return (
      <div className="flex min-h-screen items-center justify-center p-8">
        <div className="max-w-sm text-center">
          <h1 className="text-lg font-semibold">Slip not found</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            No weighment for slip <span className="font-medium">{request.slipNumber}</span> on this
            weighbridge.
          </p>
        </div>
      </div>
    );
  }

  const values = slipValues({ weighment });

  const verifyUrl = buildReceiptUrl(settings.receipt_base_url, weighment.slip_number) ?? undefined;
  const frontImageUrl = captures.data?.front ? captureImageUrl(captures.data.front) : undefined;
  const sideImageUrl = captures.data?.side ? captureImageUrl(captures.data.side) : undefined;

  return (
    <>
      {/*
       * The screen and the paper are siblings, not nested.
       *
       * Everything the operator looks at carries a page background, padding and
       * a shadow. If the printed sheet sat inside that, the wrapper's grey
       * would print behind it — the one thing an overprint must never do, since
       * it would lay a grey rectangle over the pad's own design.
       */}
      <div className="min-h-screen bg-muted/40 py-6" data-slip-screen-only>
        <div className="mx-auto mb-4 flex max-w-[150mm] flex-wrap gap-2 px-4">
          <Button variant="brand" onClick={() => window.print()}>
            <Printer className="h-4 w-4" />
            Print
          </Button>
          {/* The slip drawn below — the whole design, as the customer's copy
              looks — rather than the values-only sheet that reaches paper. */}
          <WhatsAppShareButton
            target={() => slipRef.current}
            fileName={`Weight-Bridge-Slip-${request.slipNumber}`}
          />
          <Button variant="ghost" className="ml-auto" onClick={() => window.close()}>
            <X className="h-4 w-4" />
            Close
          </Button>
        </div>

        <div ref={slipRef} className="mx-auto w-[140mm] bg-white shadow-sm">
          <SlipA5
            view="soft"
            values={values}
            verifyUrl={verifyUrl}
            frontImageUrl={frontImageUrl}
            sideImageUrl={sideImageUrl}
            frontViewFrame={settings.front_view_frame}
            sideViewFrame={settings.side_view_frame}
          />
        </div>

        <p className="mx-auto mt-4 max-w-[150mm] px-4 text-center text-xs text-muted-foreground">
          Only the values print — the design above is already on your pad. Settings → Print has the
          alignment offsets if anything lands off its box.
        </p>
      </div>

      {/* What actually prints: the values, on bare paper. */}
      <div data-slip-print-only>
        <SlipA5
          view="overprint"
          values={values}
          verifyUrl={verifyUrl}
          frontImageUrl={frontImageUrl}
          sideImageUrl={sideImageUrl}
          /* The same crop as the preview above, deliberately — unlike the
             calibration below, which the paper gets and nothing else. */
          frontViewFrame={settings.front_view_frame}
          sideViewFrame={settings.side_view_frame}
          /*
           * Calibration, for the paper only.
           *
           * SlipA5 applies it when the view is `overprint` and ignores it
           * otherwise, so the preview above, the PDF and the page behind the
           * QR all stay on the design's own coordinates. A printer's quirk
           * must not reach the record.
           */
          calibration={{
            'slip-number': {
              x: settings.print.slip_number_offset_x_mm,
              y: settings.print.slip_number_offset_y_mm,
            },
            details: {
              x: settings.print.details_offset_x_mm,
              y: settings.print.details_offset_y_mm,
            },
            weights: {
              x: settings.print.weights_offset_x_mm,
              y: settings.print.weights_offset_y_mm,
            },
            'first-time': {
              x: settings.print.first_time_offset_x_mm,
              y: settings.print.first_time_offset_y_mm,
            },
            'second-time': {
              x: settings.print.second_time_offset_x_mm,
              y: settings.print.second_time_offset_y_mm,
            },
            qr: { x: settings.print.qr_offset_x_mm, y: settings.print.qr_offset_y_mm },
          }}
          /* The photographs go in their boxes as measured on these pads,
             read off the measuring sheet (Settings -> Print). */
          paperPhotoBoxes={settings.print.photo_boxes_mm}
        />
      </div>
    </>
  );
}
