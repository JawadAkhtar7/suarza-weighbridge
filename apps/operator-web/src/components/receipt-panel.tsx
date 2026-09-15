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

import { useEffect, useRef } from 'react';
import { Button, Card, CardContent, CardHeader, CardTitle, Receipt, toast } from '@suarza/ui';
import type { NetWeight, Weighment } from '@suarza/shared';
import { Download, Printer } from 'lucide-react';
import { useReceiptSettings } from '../hooks/use-receipt-settings.js';
import { buildReceiptUrl } from '../lib/receipt-settings.js';
import { printPageUrl, receiptPdfUrl } from '../lib/api.js';

interface ReceiptPanelProps {
  weighment: Weighment;
  net: NetWeight;
  variant: 'FIRST' | 'SECOND';
  /** Open the print tab once, as soon as this receipt appears. */
  autoPrint?: boolean;
}

export function ReceiptPanel({
  weighment,
  net,
  variant,
  autoPrint = false,
}: ReceiptPanelProps) {
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

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-3 space-y-0">
        <CardTitle className="text-base">
          Receipt {variant === 'FIRST' ? '1 — first weight' : '2 — completed'}
        </CardTitle>
        <div className="flex flex-wrap gap-2">
          <Button onClick={openPrintTab}>
            <Printer />
            Print
          </Button>
          <Button variant="outline" asChild>
            {/* A plain link: the browser's own download handling streams the
                file straight from the agent, so it works with no internet. */}
            <a href={receiptPdfUrl(weighment.slip_number)} download>
              <Download />
              Download PDF
            </a>
          </Button>
        </div>
      </CardHeader>

      <CardContent>
        <div className="overflow-x-auto rounded-md border bg-muted/40 p-4">
          <Receipt
            weighment={weighment}
            net={net}
            variant={variant}
            company={{
              name: settings.company_name,
              address: settings.company_address,
              phone: settings.company_phone,
              // The bundled logo is the default; Settings can override it.
            logoUrl: settings.company_logo_url || '/logo.png',
            }}
            receiptUrl={receiptUrl}
          />
        </div>

        <p className="mt-3 text-xs text-muted-foreground">
          <span className="font-medium">Print</span> opens the receipt in a new tab and sends only
          the central block to the printer — the header and footer come from your pre-printed pad.
          <span className="font-medium"> Download PDF</span> saves the full receipt, header and
          footer included.
          {!receiptUrl && ' Set the receipt web address in Settings to print a QR code.'}
        </p>
      </CardContent>
    </Card>
  );
}
