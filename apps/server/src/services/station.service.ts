/**
 * What the cloud knows about a station.
 *
 * Its paper, and how its front camera is framed — the two things that have to
 * be true of the page served here as well as of the slip printed there. The
 * company's name, address and phone used to be here too, synced up from
 * whatever the operator had typed into Settings, which meant the slip in a
 * customer's hand and the page behind its own QR code could disagree about the
 * company's phone number. They are now in code, identical at both ends by
 * construction (COMPANY in @suarza/shared).
 */

import type { PdfPaperSize } from '@suarza/receipt-pdf';
import { FRONT_VIEW_ZOOM } from '@suarza/shared';
import { StationModel } from '../models/station.model.js';

/** The paper this slip's station prints on; A5 until it has told us. */
export async function paperForStation(
  stationId: string | null | undefined,
): Promise<PdfPaperSize> {
  if (!stationId) return 'A5';
  const station = await StationModel.findById(stationId).lean();
  return (station?.paper_size as PdfPaperSize | undefined) ?? 'A5';
}

/**
 * How this station crops its front view; the design's own figure until it has
 * told us.
 *
 * A station the cloud has never heard of, or an agent too old to send it, gets
 * the default rather than no crop — which is the picture every slip printed
 * before this setting existed already shows.
 */
export async function frontViewZoomForStation(
  stationId: string | null | undefined,
): Promise<number> {
  if (!stationId) return FRONT_VIEW_ZOOM.default;
  const station = await StationModel.findById(stationId).lean();
  return station?.front_view_zoom ?? FRONT_VIEW_ZOOM.default;
}
