/**
 * How a camera's picture sits in its box on the slip: zoom and pan, set by the
 * operator on the live preview. The front and side views are framed the same
 * way, each with its own stored framing.
 *
 * Box-relative on purpose. `x` and `y` are how far the picture is moved, as a
 * fraction of the box's own width and height, before it is scaled about the
 * box's centre — CSS `scale(zoom) translate(x*100%, y*100%)`. The operator's
 * preview, the slip on screen, the printed sheet and the page behind the QR
 * all have boxes of the same shape and different sizes, so a fraction of the
 * box frames the same truck in every one of them, where pixels would not.
 */

import { FRONT_VIEW_ZOOM, SIDE_VIEW_ZOOM } from '../constants/paper.js';

export interface ViewFrame {
  zoom: number;
  x: number;
  y: number;
}

/** The design's crop, centred: the lorry sits small in the middle of a wide frame. */
export const DEFAULT_FRONT_VIEW_FRAME: ViewFrame = { zoom: FRONT_VIEW_ZOOM.default, x: 0, y: 0 };
/** The whole picture: the side camera looks along the bridge from close in. */
export const DEFAULT_SIDE_VIEW_FRAME: ViewFrame = { zoom: SIDE_VIEW_ZOOM.default, x: 0, y: 0 };

/** Both views share these bounds; see FRONT_VIEW_ZOOM for what the top end costs. */
export const VIEW_FRAME_ZOOM = { min: 1, max: 10 } as const;

/**
 * The same framing, kept inside what the picture can cover.
 *
 * Scaled by `zoom` about the centre, the picture overhangs the box by
 * (zoom - 1) / 2 of its size on each side, and that overhang is all the room
 * a pan has: any more and the pad's white shows along one edge. Zoom is held
 * to its bounds first because the room depends on it.
 */
export function clampViewFrame(frame: ViewFrame): ViewFrame {
  const zoom = Math.min(VIEW_FRAME_ZOOM.max, Math.max(VIEW_FRAME_ZOOM.min, frame.zoom || 1));
  const room = (1 - 1 / zoom) / 2;
  const clamp = (value: number) => Math.min(room, Math.max(-room, value || 0));
  return { zoom, x: clamp(frame.x), y: clamp(frame.y) };
}

/** The CSS transform that draws a framing; none for the whole picture, centred. */
export function viewFrameTransform(frame: ViewFrame | undefined): string | undefined {
  if (!frame) return undefined;
  const { zoom, x, y } = clampViewFrame(frame);
  if (x === 0 && y === 0) return zoom === 1 ? undefined : `scale(${zoom})`;
  return `scale(${zoom}) translate(${(x * 100).toFixed(3)}%, ${(y * 100).toFixed(3)}%)`;
}
