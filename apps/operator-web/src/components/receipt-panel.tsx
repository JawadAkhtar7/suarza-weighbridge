/**
 * The receipt preview, with its print and download actions.
 *
 * Printing opens the receipt in its OWN TAB rather than firing a hidden print
 * frame (operator feedback). The operator sees what is about to come out, can
 * print it again without redoing anything, and closes the tab when done — the
 * weighing screen is still underneath, untouched.
 *
 * On screen this is the SOFT form, header and footer included. What reaches the
 * printer is the central block only, because the pad already carries the
 * branding (brief §8). The PDF download is the full soft form, for a customer
 * who has no pad.
 */

import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { Button, Card, CardContent, CardHeader, CardTitle, SlipA5, slipValues, toast } from '@suarza/ui';
import type { Weighment } from '@suarza/shared';
import { Printer } from 'lucide-react';
import { useReceiptSettings } from '../hooks/use-receipt-settings.js';
import { buildReceiptUrl } from '../lib/receipt-settings.js';
import { agentApi, captureImageUrl, printPageUrl } from '../lib/api.js';

interface ReceiptPanelProps {
  weighment: Weighment;
  /* No `net`: the slip works it out from the two weights, so a caller cannot
     hand it a net weight that disagrees with the record it is printing. */
  variant: 'FIRST' | 'SECOND';
  /**
   * Overrides the "Receipt 1 / 2" heading. The numbering counts visits, so it
   * reads wrong for a one-visit weighing, where this is the only receipt.
   */
  title?: string;
  /** Open the print tab once, as soon as this receipt appears. */
  autoPrint?: boolean;
}

export function ReceiptPanel({ weighment, variant, title, autoPrint = false }: ReceiptPanelProps) {
  const { settings } = useReceiptSettings();
  const autoOpenedFor = useRef<string | null>(null);

  const openPrintTab = () => {
    const tab = window.open(printPageUrl(weighment.slip_number, variant), '_blank');
    if (!tab) {
      // A blocked popup would otherwise look like nothing happened, and the
      // operator would keep pressing the button.
      toast.error('The browser blocked the receipt tab', {
        description: 'Allow pop-ups for this page, then press Print again.',
        duration: 8000,
      });
      return false;
    }
    return true;
  };

  useEffect(() => {
    if (!autoPrint || !settings.auto_print) return;
    // Keyed on slip + variant, so a re-render never reopens the tab but the
    // second receipt for the same slip still opens when the weighing completes.
    const key = `${weighment.slip_number}:${variant}`;
    if (autoOpenedFor.current === key) return;
    autoOpenedFor.current = key;
    window.open(printPageUrl(weighment.slip_number, variant), '_blank');
  }, [autoPrint, settings.auto_print, weighment.slip_number, variant]);

  const receiptUrl = buildReceiptUrl(settings.receipt_base_url, weighment.slip_number);

  /* The stills for the preview. Best-effort: no cameras, or a camera that did
     not answer, simply leaves the placeholder in place. */
  const captures = useQuery({
    queryKey: ['captures', weighment.slip_number],
    queryFn: () => agentApi.slipCaptures(weighment.slip_number),
    retry: false,
  });

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-3 space-y-0">
        <CardTitle className="text-base">
          {title ?? `Receipt ${variant === 'FIRST' ? '1 — first weight' : '2 — completed'}`}
        </CardTitle>
        <div className="flex flex-wrap gap-2">
          {/* Printing is what the operator does next, so it carries the same
              orange as every other step-forward action. */}
          <Button variant="brand" onClick={openPrintTab}>
            <Printer />
            Print
          </Button>

        </div>
      </CardHeader>

      <CardContent>
        <div className="overflow-x-auto rounded-md border bg-muted/40 p-4">
          {/* The same slip the print tab renders and the QR page serves, scaled
              to fit the card. One rendering, so a preview cannot promise
              something the paper does not deliver. */}
          <SlipA5
            view="soft"
            values={slipValues({ weighment })}
            verifyUrl={receiptUrl ?? undefined}
            frontImageUrl={
              captures.data?.front ? captureImageUrl(captures.data.front) : undefined
            }
            sideImageUrl={captures.data?.side ? captureImageUrl(captures.data.side) : undefined}
          />
        </div>

        <p className="mt-3 text-xs text-muted-foreground">
          <span className="font-medium">Print</span> opens the slip in a new tab and sends only the
          values to the printer — the design comes from your pre-printed pad.
          {!receiptUrl && ' Set the receipt web address in Settings to print a QR code.'}
        </p>
      </CardContent>
    </Card>
  );
}
