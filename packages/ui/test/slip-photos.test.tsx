/** The photo boxes: the design's on screen, wider on paper only. */

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SlipA5 } from '../src/receipt/slip/slip-a5.js';
import { UNIT_MM, type SlipValues } from '../src/receipt/slip/layout.js';

const values = { net_kg: '12,000' } as SlipValues;
/** In mm, as the slip writes it (jsdom drops trailing zeros, so compare numbers). */
const mm = (designPx: number) => Number((designPx * UNIT_MM).toFixed(4));

/** The clipping wrapper carries the geometry; the <img> just fills it. */
function box(alt: string) {
  const style = screen.getByAltText(alt).parentElement!.style;
  const n = (value: string) => Number.parseFloat(value);
  return { left: n(style.left), top: n(style.top), width: n(style.width), height: n(style.height) };
}

const FRONT = 'Truck on the weighbridge, front view';
const SIDE = 'Truck on the weighbridge, side view';

describe('slip photos', () => {
  it('keeps the design geometry on screen, whatever the paper settings say', () => {
    render(
      <SlipA5
        view="soft"
        values={values}
        paperExtraWidth={{ 'front-view': 2, 'side-view': 2 }}
      />,
    );
    expect(box(FRONT)).toEqual({
      left: mm(21),
      top: mm(528.63),
      width: mm(237.31),
      height: mm(119.28),
    });
    expect(box(SIDE).left).toBe(mm(271.32));
  });

  it('prints over the green line, widened equally on both sides', () => {
    const extra = 1 / UNIT_MM; // 1 mm, in design px
    render(
      <SlipA5
        view="overprint"
        values={values}
        paperExtraWidth={{ 'front-view': 0, 'side-view': 1 }}
      />,
    );
    expect(box(FRONT)).toEqual({
      left: mm(18),
      top: mm(526.2),
      width: mm(242.88),
      height: mm(124.05),
    });
    // Still centred on the box, so the side view's offset keeps its meaning.
    expect(box(SIDE).left).toBe(mm(268.25 - extra));
    expect(box(SIDE).width).toBe(mm(242.75 + extra * 2));
  });
});
