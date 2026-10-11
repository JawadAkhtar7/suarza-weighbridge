/**
 * What the cloud knows about a station.
 *
 * Its paper, and how its cameras are framed — the things that have to
 * be true of the page served here as well as of the slip printed there. The
 * company's name, address and phone used to be here too, synced up from
 * whatever the operator had typed into Settings, which meant the slip in a
 * customer's hand and the page behind its own QR code could disagree about the
 * company's phone number. They are now in code, identical at both ends by
 * construction (COMPANY in @suarza/shared).
 */

import type { PdfPaperSize } from '@suarza/receipt-pdf';
import {
  clampViewFrame,
  DEFAULT_FRONT_VIEW_FRAME,
  DEFAULT_SIDE_VIEW_FRAME,
  type ViewFrame,
} from '@suarza/shared';
import { StationModel } from '../models/station.model.js';

/** The paper this slip's station prints on; A5 until it has told us. */
export async function paperForStation(
  stationId: string | null | undefined,
): Promise<PdfPaperSize> {
  if (!stationId) return 'A5';
  const station = await StationModel.findById(stationId).lean();
  return (station?.paper_size as PdfPaperSize | undefined) ?? 'A5';
}

export interface CameraFraming {
  front: ViewFrame;
  side: ViewFrame;
}

/**
 * How this station frames its two camera views, as its operator set them on
 * the live preview.
 *
 * Until it has told us: the design's own crop for the front view and the
 * whole frame for the side — the pictures every slip printed before framing
 * existed already shows. A station that reported only a front zoom (written
 * before the front view could be panned) gets that zoom, centred.
 */
export async function cameraFramingForStation(
  stationId: string | null | undefined,
): Promise<CameraFraming> {
  const defaults = { front: DEFAULT_FRONT_VIEW_FRAME, side: DEFAULT_SIDE_VIEW_FRAME };
  if (!stationId) return defaults;
  const station = await StationModel.findById(stationId).lean();
  if (!station) return defaults;

  const read = (
    frame: { zoom?: number | null; x?: number | null; y?: number | null } | null | undefined,
  ) =>
    typeof frame?.zoom === 'number'
      ? clampViewFrame({ zoom: frame.zoom, x: frame.x ?? 0, y: frame.y ?? 0 })
      : undefined;

  return {
    front:
      read(station.front_view_frame) ??
      (typeof station.front_view_zoom === 'number'
        ? clampViewFrame({ zoom: station.front_view_zoom, x: 0, y: 0 })
        : DEFAULT_FRONT_VIEW_FRAME),
    side: read(station.side_view_frame) ?? DEFAULT_SIDE_VIEW_FRAME,
  };
}
