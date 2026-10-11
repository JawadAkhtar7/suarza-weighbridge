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
 * How tightly the front-view photograph is cropped into its box on the slip.
 *
 * The cameras send 16:9; the box on the pad is very nearly 2:1, so the picture
 * is already cropped top and bottom to fill it. Above 1 it crops further about
 * the centre, which is where the truck is — the lens sits back far enough that
 * the lorry occupies the middle of a wide frame and the edges are yard.
 *
 * Here, next to the paper, because it is a fact about the slip rather than
 * about the camera, and because four renderers have to agree on it: the
 * operator's preview, the sheet that prints, the manager's copy and the public
 * page behind the QR code. A picture framed one way on paper and another way
 * on the page a customer scans is the same slip telling two stories.
 *
 * The bounds are not arbitrary. Below 1 the picture stops filling its box and
 * the pad's white shows through at the edges; past about 1.6 a sub-stream
 * still has too few pixels left to survive a 63 mm print.
 */
export const FRONT_VIEW_ZOOM = { default: 1.3, min: 1, max: 1.6 } as const;
