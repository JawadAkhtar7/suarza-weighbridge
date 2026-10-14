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
/**
 * One station document's framing, with every way it might not have one.
 *
 * A station that has never synced since camera framing existed may carry the
 * older `front_view_zoom` and nothing else; one older still carries neither.
 * Both are read here rather than at each call site, because "which fallback
 * applies" is the kind of thing that gets remembered in one place and
 * forgotten in the other.
 */
function framingOf(station: {
  front_view_frame?: { zoom?: number | null; x?: number | null; y?: number | null } | null;
  side_view_frame?: { zoom?: number | null; x?: number | null; y?: number | null } | null;
  front_view_zoom?: number | null;
}): CameraFraming {
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

/**
 * The same, for every station a page of weighings came from.
 *
 * In practice that is one station and one document, but the list must not
 * start making a query per row the day a second weighbridge appears.
 */
export async function cameraFramingForStations(
  stationIds: readonly string[],
): Promise<Map<string, CameraFraming>> {
  const out = new Map<string, CameraFraming>();
  const wanted = [...new Set(stationIds.filter(Boolean))];
  if (wanted.length === 0) return out;

  const stations = await StationModel.find({ _id: { $in: wanted } }).lean();
  for (const station of stations) {
    out.set(String(station._id), framingOf(station));
  }
  return out;
}

export async function cameraFramingForStation(
  stationId: string | null | undefined,
): Promise<CameraFraming> {
  const defaults = { front: DEFAULT_FRONT_VIEW_FRAME, side: DEFAULT_SIDE_VIEW_FRAME };
  if (!stationId) return defaults;
  const station = await StationModel.findById(stationId).lean();
  return station ? framingOf(station) : defaults;
}
