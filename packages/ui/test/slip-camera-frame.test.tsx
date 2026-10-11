/** The operator's camera framing reaches every form of the slip. */

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SlipA5 } from '../src/receipt/slip/slip-a5.js';
import type { SlipValues } from '../src/receipt/slip/layout.js';

const values = { net_kg: '12,000' } as SlipValues;
const SIDE = 'Truck on the weighbridge, side view';
const FRONT = 'Truck on the weighbridge, front view';

describe('camera framing on the slip', () => {
  for (const view of ['soft', 'overprint'] as const) {
    it(`draws both views' framing in the ${view} view`, () => {
      render(
        <SlipA5
          view={view}
          values={values}
          frontViewFrame={{ zoom: 1.5, x: -0.1, y: 0.05 }}
          sideViewFrame={{ zoom: 2, x: 0.1, y: -0.05 }}
        />,
      );
      expect(screen.getByAltText(FRONT).style.transform).toBe(
        'scale(1.5) translate(-10.000%, 5.000%)',
      );
      expect(screen.getByAltText(SIDE).style.transform).toBe(
        'scale(2) translate(10.000%, -5.000%)',
      );
    });
  }

  it("falls back to the design's front crop and the whole side frame", () => {
    render(<SlipA5 view="soft" values={values} />);
    expect(screen.getByAltText(FRONT).style.transform).toBe('scale(1.3)');
    expect(screen.getByAltText(SIDE).style.transform).toBe('');
  });
});
