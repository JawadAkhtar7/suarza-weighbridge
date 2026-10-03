/**
 * What the cloud knows about a station.
 *
 * Only the paper size. The company's name, address and phone used to be here
 * too, synced up from whatever the operator had typed into Settings — which
 * meant the slip in a customer's hand and the page behind its own QR code could
 * disagree about the company's phone number. They are now in code, identical at
 * both ends by construction (COMPANY in @suarza/shared).
 */

import type { PdfPaperSize } from '@suarza/receipt-pdf';
import { StationModel } from '../models/station.model.js';

/** The paper this slip's station prints on; A5 until it has told us. */
export async function paperForStation(
  stationId: string | null | undefined,
): Promise<PdfPaperSize> {
  if (!stationId) return 'A5';
  const station = await StationModel.findById(stationId).lean();
  return (station?.paper_size as PdfPaperSize | undefined) ?? 'A5';
}
