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
