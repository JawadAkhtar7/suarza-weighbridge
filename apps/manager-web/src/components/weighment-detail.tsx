/**
 * Row detail: the full receipt, printable and downloadable (brief §9).
 *
 * The same `Receipt` component the operator prints and the QR page serves — a
 * manager checking a disputed slip sees exactly what the customer is holding.
 *
 * The PDF link points at the server, which builds it in memory from the record
 * (brief §8). The dashboard never assembles a PDF itself, so the two can never
 * disagree.
 */

import { useRef } from 'react';
import { useReactToPrint } from 'react-to-print';
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Receipt,
  buildPageStyle,
} from '@suarza/ui';
import { netWeightAllUnits, printSettingsSchema, type Weighment } from '@suarza/shared';
import { Download, Printer } from 'lucide-react';
import { receiptPdfUrl } from '../lib/api.js';

interface WeighmentDetailProps {
  weighment: Weighment | null;
  onClose: () => void;
  company: { name: string; address: string; phone: string; logoUrl?: string };
  /** Public origin, so the QR on a printed copy still resolves. */
  receiptBaseUrl: string;
}

export function WeighmentDetail({
  weighment,
  onClose,
  company,
  receiptBaseUrl,
}: WeighmentDetailProps) {
  const contentRef = useRef<HTMLDivElement>(null);

  // A manager prints onto plain paper, not the operator's pre-printed pad, so
  // this print keeps the branded header — hence default settings with no
  // offsets rather than the operator's calibration.
  const print = useReactToPrint({
    contentRef,
    documentTitle: weighment ? `${weighment.slip_number}-receipt` : 'receipt',
    pageStyle: buildPageStyle(printSettingsSchema.parse({})),
  });

  if (!weighment) return null;

  const net = netWeightAllUnits(weighment.first_weight_kg, weighment.second_weight_kg);
  const receiptUrl = receiptBaseUrl
    ? `${receiptBaseUrl.replace(/\/+$/, '')}/r/${encodeURIComponent(weighment.slip_number)}`
    : null;

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
          <Button variant="outline" asChild>
            {/* A plain link, so the browser's own download handling does the
                work and the file streams straight from the server. */}
            <a href={receiptPdfUrl(weighment.slip_number)} download>
              <Download className="h-4 w-4" />
              Download PDF
            </a>
          </Button>
        </div>

        <div className="overflow-x-auto rounded-md border bg-muted/40 p-3">
          <div ref={contentRef}>
            <Receipt
              weighment={weighment}
              net={net}
              variant={weighment.status === 'COMPLETED' ? 'SECOND' : 'FIRST'}
              company={company}
              receiptUrl={receiptUrl}
            />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
