/** The photo boxes: the design's on screen, the station's measured boxes on paper. */

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DEFAULT_PHOTO_BOXES_MM, PHOTO_BOX_FILL_MM } from '@suarza/shared';
import { SlipA5 } from '../src/receipt/slip/slip-a5.js';
import { UNIT_MM, type SlipValues } from '../src/receipt/slip/layout.js';
import { MeasureSheet, rulerMarks } from '../src/receipt/slip/measure-sheet.js';

const values = { net_kg: '12,000' } as SlipValues;
const mm = (designPx: number) => Number((designPx * UNIT_MM).toFixed(4));

/** The clipping wrapper's box, in mm (jsdom drops trailing zeros, so compare numbers). */
function box(alt: string) {
  const style = screen.getByAltText(alt).parentElement!.style;
  const n = (value: string) => Number.parseFloat(value);
  const left = n(style.left);
  const top = n(style.top);
  return { left, top, right: left + n(style.width), bottom: top + n(style.height) };
}

const FRONT = 'Truck on the weighbridge, front view';
const SIDE = 'Truck on the weighbridge, side view';

/* As if read off a measuring sheet. */
const MEASURED = {
  front: { left: 5.25, right: 70.5, top: 139, bottom: 172.75 },
  side: { left: 72.5, right: 137.25, top: 139, bottom: 172.75 },
};

describe('slip photos', () => {
  it('keeps the design geometry on screen, whatever the measured boxes say', () => {
    render(<SlipA5 view="soft" values={values} paperPhotoBoxes={MEASURED} />);
    expect(box(FRONT).left).toBeCloseTo(mm(21), 3);
    expect(box(FRONT).top).toBeCloseTo(mm(528.63), 3);
    expect(box(SIDE).left).toBeCloseTo(mm(271.32), 3);
  });

  it('prints each photo over its measured box by the fill on every side', () => {
    render(<SlipA5 view="overprint" values={values} paperPhotoBoxes={MEASURED} />);
    for (const [alt, want] of [
      [FRONT, MEASURED.front],
      [SIDE, MEASURED.side],
    ] as const) {
      const printed = box(alt);
      expect(printed.left).toBeCloseTo(want.left - PHOTO_BOX_FILL_MM, 3);
      expect(printed.right).toBeCloseTo(want.right + PHOTO_BOX_FILL_MM, 3);
      expect(printed.top).toBeCloseTo(want.top - PHOTO_BOX_FILL_MM, 3);
      expect(printed.bottom).toBeCloseTo(want.bottom + PHOTO_BOX_FILL_MM, 3);
    }
  });

  it('starts from the placement that printed best on site, before any measuring', () => {
    render(<SlipA5 view="overprint" values={values} />);
    const front = box(FRONT);
    const side = box(SIDE);
    expect([front.left, front.right]).toEqual([
      expect.closeTo(4.0, 2),
      expect.closeTo(70.65, 2),
    ]);
    expect([side.left, side.right]).toEqual([expect.closeTo(71.4, 2), expect.closeTo(138.0, 2)]);
    expect(front.top).toBeCloseTo(DEFAULT_PHOTO_BOXES_MM.front.top - PHOTO_BOX_FILL_MM, 3);
  });
});

describe('measuring sheet', () => {
  it('marks every half millimetre around an edge, numbering every second millimetre', () => {
    const marks = rulerMarks(5.25, 2);
    expect(marks.map((mark) => mark.at)).toEqual([3.5, 4, 4.5, 5, 5.5, 6, 6.5, 7]);
    expect(marks.filter((mark) => mark.label).map((mark) => mark.label)).toEqual(['4', '6']);
    expect(marks.find((mark) => mark.at === 5)?.whole).toBe(true);
    expect(marks.find((mark) => mark.at === 5.5)?.whole).toBe(false);
  });

  it('draws a scale across each of the eight edges, in absolute millimetres', () => {
    const { container } = render(<MeasureSheet boxes={MEASURED} />);
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('viewBox')).toBe('0 0 140 200');
    expect(svg.getAttribute('width')).toBe('140mm');

    const texts = [...svg.querySelectorAll('text')].map((t) => t.textContent);
    for (const caption of ['Front left', 'Front right', 'Front top', 'Front bottom', 'Side left', 'Side right', 'Side top', 'Side bottom']) {
      expect(texts).toContain(caption);
    }
    // The side box's right edge at 137.25: its scale is numbered around it.
    expect(texts).toEqual(expect.arrayContaining(['132', '134', '136', '138', '140']));
  });
});
