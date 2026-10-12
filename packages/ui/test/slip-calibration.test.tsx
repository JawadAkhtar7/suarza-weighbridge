/** Which printed values each Settings -> Print alignment group moves. */

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SlipA5 } from '../src/receipt/slip/slip-a5.js';
import type { SlipValues } from '../src/receipt/slip/layout.js';

/* Distinct strings, so each value can be found by its text. */
const values = {
  slip_number: 'SLIP-1',
  printed_at: 'PRINTED-AT',
  driver_name: 'DRIVER',
  customer: 'CUSTOMER',
  first_at: 'FIRST-AT',
  first_kg: 'FIRST-KG',
  second_at: 'SECOND-AT',
  second_kg: 'SECOND-KG',
  net_kg: 'NET-KG',
  mann: 'MANN',
} as SlipValues;

/** Each group, and the printed values it alone should move. */
const GROUPS = {
  'slip-number': ['SLIP-1'],
  details: ['PRINTED-AT', 'DRIVER', 'CUSTOMER'],
  weights: ['FIRST-KG', 'SECOND-KG', 'NET-KG', 'MANN'],
  'first-time': ['FIRST-AT'],
  'second-time': ['SECOND-AT'],
} as const;
const ALL = Object.values(GROUPS).flat();

/** The calibration shift on a printed value, in mm, or null if it is not moved. */
function shift(text: string): [number, number] | null {
  const match = /translate\(([-\d.]+)mm, ([-\d.]+)mm\)/.exec(
    screen.getByText(text).style.transform,
  );
  return match ? [Number(match[1]), Number(match[2])] : null;
}

describe('print alignment groups', () => {
  for (const [group, moved] of Object.entries(GROUPS)) {
    it(`moves ${moved.join(', ')} and nothing else for "${group}"`, () => {
      render(
        <SlipA5 view="overprint" values={values} calibration={{ [group]: { x: 0.5, y: -0.75 } }} />,
      );

      for (const text of ALL) {
        expect(shift(text)).toEqual((moved as readonly string[]).includes(text) ? [0.5, -0.75] : null);
      }
    });
  }

  it('never moves anything on screen', () => {
    const everything = Object.fromEntries(
      Object.keys(GROUPS).map((group) => [group, { x: 1, y: -1 }]),
    );
    render(<SlipA5 view="soft" values={values} calibration={everything} />);

    for (const text of ALL) expect(shift(text)).toBeNull();
  });
});
