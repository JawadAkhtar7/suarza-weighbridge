/**
 * Whose company details a receipt carries, and what paper it is drawn for.
 *
 * The operator sets these on the weighbridge and they arrive with the sync
 * batches, so the PDF behind a QR code shows exactly what is printed on the
 * paper in the customer's hand. The server's own COMPANY_* configuration is
 * only the answer for a station that has never synced.
 */

import type { PdfPaperSize } from '@suarza/receipt-pdf';
import { StationModel } from '../models/station.model.js';

export interface ReceiptCompanyDetails {
  name: string;
  address: string;
  phone: string;
  logoUrl: string;
}

/**
 * Each field falls back on its own.
 *
 * A station that has filled in an address but not a phone should show its real
 * address and the fallback phone — not be pushed wholly back to placeholders by
 * one blank field.
 */
export async function companyForStation(
  stationId: string | null | undefined,
  fallback: ReceiptCompanyDetails,
): Promise<ReceiptCompanyDetails> {
  if (!stationId) return fallback;

  const station = await StationModel.findById(stationId).lean();
  if (!station) return fallback;

  return {
    name: station.company_name || fallback.name,
    address: station.company_address || fallback.address,
    phone: station.company_phone || fallback.phone,
    logoUrl: station.company_logo_url || fallback.logoUrl,
  };
}

/** The paper this slip's station prints on; A5 until it has told us. */
export async function paperForStation(
  stationId: string | null | undefined,
): Promise<PdfPaperSize> {
  if (!stationId) return 'A5';
  const station = await StationModel.findById(stationId).lean();
  return (station?.paper_size as PdfPaperSize | undefined) ?? 'A5';
}
