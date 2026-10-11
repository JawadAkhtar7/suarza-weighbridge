/**
 * The slip's paper, in millimetres.
 *
 * Here rather than in the UI package because three tiers need to agree on it:
 * the renderer that draws the sheet, the operator app that previews it at life
 * size, and the agent's settings, which hand the same figures to the alignment
 * test print. A test print on a different size from the slip is worse than no
 * test print at all — it would pass while the real thing lands off its boxes.
 *
 * NOT A5. The client's pads are 140 x 200: 8 mm narrower and 10 mm shorter,
 * and the artwork was redrawn for them rather than scaled, so the proportions
 * differ too (140/200 is 0.700 against A5's 0.705). Nothing may derive this
 * from A5, and nothing may assume it.
 */
export const SLIP_PAGE_MM = { width: 140, height: 200 } as const;

/**
 * How far the front-view photograph may be zoomed into its box on the slip,
 * and how far it starts.
 *
 * The cameras send 16:9; the box on the pad is very nearly 2:1, so the picture
 * is already cropped top and bottom to fill it. Above 1 it crops further. The
 * default crops about the centre, which is where the truck is — the lens sits
 * back far enough that the lorry occupies the middle of a wide frame and the
 * edges are yard. Beyond that the operator frames it by hand on the live
 * preview, zoom and pan, as the side view is (utils/framing.ts).
 *
 * Here, next to the paper, because it is a fact about the slip rather than
 * about the camera, and because four renderers have to agree on it: the
 * operator's preview, the sheet that prints, the manager's copy and the public
 * page behind the QR code. A picture framed one way on paper and another way
 * on the page a customer scans is the same slip telling two stories.
 *
 * Below 1 the picture stops filling its box and the pad's white shows through
 * at the edges. The ceiling is 10, raised from 3 at the operator's request, and
 * it costs sharpness: the box is 62.8 mm wide and wants 742 pixels at 300 dpi.
 * The front still is 3840 across, so it stays crisp to about 5x and prints at
 * ~155 dpi at 10x; the side's 2688 stays crisp to about 3.6x and prints at
 * ~110 dpi at 10x. The 1920-wide live preview softens past about 3x. A thing
 * to look at rather than a thing to forbid.
 */
export const FRONT_VIEW_ZOOM = { default: 1.3, min: 1, max: 10 } as const;

/**
 * How far the operator may zoom the side view into its box.
 *
 * Framed by hand on the live preview (zoom and pan), like the front view. 1 is
 * the whole frame, which is every slip before framing existed. Same ceiling as
 * the front view, at the cost described there.
 */
export const SIDE_VIEW_ZOOM = { default: 1, min: 1, max: 10 } as const;
