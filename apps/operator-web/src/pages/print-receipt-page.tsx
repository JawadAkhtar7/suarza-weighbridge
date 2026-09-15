/**
 * The printable receipt, in its own tab (operator feedback).
 *
 * Opened with `window.open` from the weighing screens rather than printed from
 * a hidden frame, so the operator can see exactly what is about to come out,
 * print it again without redoing the weighing, and close it when they are done
 * — all without leaving the weighing screen behind it.
 *
 * On screen this is the SOFT form: header and footer included, so it reads like
 * the page a customer would see. What the printer produces is still the central
 * block only, because `@media print` hides the rest (brief §8).
 */

import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button, Receipt, buildPageStyle } from '@suarza/ui';
import { netWeightAllUnits } from '@suarza/shared';
import { Download, Loader2, Printer, X } from 'lucide-react';
import { agentApi, receiptPdfUrl } from '../lib/api.js';
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

  const query = useQuery({
    queryKey: ['print-receipt', request.slipNumber],
    queryFn: () => agentApi.getWeighment(request.slipNumber),
    retry: false,
  });

  const weighment = query.data?.weighment;

  // The print dialog opens by itself once the receipt AND the settings are in —
  // printing before the settings land would use the wrong page size and
  // offsets, and the operator would only find out from the paper.
  useEffect(() => {
    if (!weighment || !isLoaded || printedOnce.current) return;
    if (!settings.auto_print) return;
    printedOnce.current = true;
    const timer = window.setTimeout(() => window.print(), 350);
    return () => window.clearTimeout(timer);
  }, [weighment, isLoaded, settings.auto_print]);

  // The page style has to be in the document itself here, not handed to a
  // print library — this tab IS the print document.
  useEffect(() => {
    const style = document.createElement('style');
    style.textContent = buildPageStyle(settings.print);
    document.head.appendChild(style);
    return () => style.remove();
  }, [settings.print]);

  useEffect(() => {
    document.title = `${request.slipNumber} — receipt`;
  }, [request.slipNumber]);

  if (query.isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center gap-2 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        Loading receipt…
      </div>
    );
  }

  if (!weighment) {
    return (
      <div className="flex min-h-screen items-center justify-center p-8">
        <div className="max-w-sm text-center">
          <h1 className="text-lg font-semibold">Receipt not found</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            No weighment for slip <span className="font-medium">{request.slipNumber}</span> on this
            weighbridge.
          </p>
        </div>
      </div>
    );
  }

  const net = netWeightAllUnits(weighment.first_weight_kg, weighment.second_weight_kg);

  return (
    <div className="min-h-screen bg-muted/40 py-6">
      {/* Controls are print-hidden, so they never reach the paper. */}
      <div className="receipt-soft-only mx-auto mb-4 flex max-w-[150mm] flex-wrap gap-2 px-4">
        <Button onClick={() => window.print()}>
          <Printer className="h-4 w-4" />
          Print
        </Button>
        <Button variant="outline" asChild>
          <a href={receiptPdfUrl(weighment.slip_number)} download>
            <Download className="h-4 w-4" />
            Download PDF
          </a>
        </Button>
        <Button variant="ghost" className="ml-auto" onClick={() => window.close()}>
          <X className="h-4 w-4" />
          Close
        </Button>
      </div>

      <div className="mx-auto max-w-[150mm] bg-white shadow-sm print:max-w-none print:shadow-none">
        <Receipt
          weighment={weighment}
          net={net}
          variant={request.variant}
          company={{
            name: settings.company_name,
            address: settings.company_address,
            phone: settings.company_phone,
            // The bundled logo is the default; Settings can override it.
            logoUrl: settings.company_logo_url || '/logo.png',
          }}
          receiptUrl={buildReceiptUrl(settings.receipt_base_url, weighment.slip_number)}
        />
      </div>

      <p className="receipt-soft-only mx-auto mt-4 max-w-[150mm] px-4 text-center text-xs text-muted-foreground">
        Only the central block prints — the header and footer above come from your pre-printed pad.
        Use <span className="font-medium">Download PDF</span> for a full copy with the header and
        footer included.
      </p>
    </div>
  );
}
