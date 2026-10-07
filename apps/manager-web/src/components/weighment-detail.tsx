/**
 * Row detail: the full slip, printable (brief §9).
 *
 * The same component the operator prints and the QR page serves, reading the
 * same coordinates — a manager checking a disputed slip sees exactly what the
 * customer is holding.
 *
 * One deliberate difference from the operator's tab: this prints the WHOLE
 * slip, design and all. The operator feeds pre-printed pads and so prints only
 * the values; a manager prints onto whatever is in the office printer, where a
 * page of bare figures would mean nothing to anybody.
 */

import { useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useReactToPrint } from 'react-to-print';
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  SlipA5,
  SLIP_PAGE_CSS,
  slipValues,
} from '@suarza/ui';
import type { Weighment } from '@suarza/shared';
import { ExternalLink, Printer } from 'lucide-react';
import { api, receiptPageUrl } from '../lib/api.js';

interface WeighmentDetailProps {
  weighment: Weighment | null;
  onClose: () => void;
  /** Public origin, so the QR on a printed copy still resolves. */
  receiptBaseUrl: string;
}

export function WeighmentDetail({ weighment, onClose, receiptBaseUrl }: WeighmentDetailProps) {
  const contentRef = useRef<HTMLDivElement>(null);

  const print = useReactToPrint({
    contentRef,
    documentTitle: weighment ? `${weighment.slip_number}-slip` : 'slip',
    pageStyle: SLIP_PAGE_CSS,
  });

  if (!weighment) return null;

  const receiptUrl = receiptBaseUrl
    ? `${receiptBaseUrl.replace(/\/+$/, '')}/r/${encodeURIComponent(weighment.slip_number)}`
    : undefined;

  const values = slipValues({ weighment });

  /* The truck's own pictures. Best-effort: a bridge without cameras, or one
     whose images have not synced yet, leaves the placeholder in place. */
  const captures = useQuery({
    queryKey: ['weighment-captures', weighment.slip_number],
    queryFn: () => api.weighmentCaptures(weighment.slip_number),
    retry: false,
  });

  /* Served publicly, like the QR page that embeds them — the manager app and
     a driver's phone fetch the very same bytes. */
  const captureUrl = (id: string | null | undefined) =>
    id ? `${receiptBaseUrl.replace(/\/+$/, '')}/captures/${encodeURIComponent(id)}` : undefined;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="tabular">{weighment.slip_number}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-wrap gap-2">
          <Button onClick={() => print()}>
            <Printer className="h-4 w-4" />
            Print
          </Button>
          {/*
           * The public page rather than a generated file. There is no PDF
           * builder any more — the page IS the slip, and the browser's own
           * "Save as PDF" turns it into one at A5 without a second renderer
           * that could disagree with this one.
           */}
          <Button variant="outline" asChild>
            <a href={receiptPageUrl(weighment.slip_number)} target="_blank" rel="noreferrer">
              <ExternalLink className="h-4 w-4" />
              Open slip page
            </a>
          </Button>
        </div>

        {/* Scaled down to fit the dialog; the print above is unaffected, since
            the transform lives on the wrapper and not on the sheet. */}
        <div className="overflow-x-auto rounded-md border bg-muted/40 p-3">
          <div ref={contentRef}>
            <SlipA5
              view="soft"
              values={values}
              verifyUrl={receiptUrl}
              frontImageUrl={captureUrl(captures.data?.front)}
              sideImageUrl={captureUrl(captures.data?.side)}
            />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
