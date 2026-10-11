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

const DETAILS = ['SLIP-1', 'PRINTED-AT', 'DRIVER', 'CUSTOMER'];
const WEIGHTS = ['FIRST-KG', 'SECOND-KG', 'NET-KG', 'MANN'];
const TIMES = ['FIRST-AT', 'SECOND-AT'];

/** The calibration shift on a printed value, in mm, or null if it is not moved. */
function shift(text: string): [number, number] | null {
  const match = /translate\(([-\d.]+)mm, ([-\d.]+)mm\)/.exec(
    screen.getByText(text).style.transform,
  );
  return match ? [Number(match[1]), Number(match[2])] : null;
}

describe('print alignment groups', () => {
  it('moves the slip number, date/time and customer details, and nothing in the weight boxes', () => {
    render(<SlipA5 view="overprint" values={values} calibration={{ details: { x: 0, y: -2 } }} />);

    for (const text of DETAILS) expect(shift(text)).toEqual([0, -2]);
    for (const text of [...WEIGHTS, ...TIMES]) expect(shift(text)).toBeNull();
  });

  it('moves the weight figures without the date/time beside the calendar icons', () => {
    render(
      <SlipA5 view="overprint" values={values} calibration={{ weights: { x: 1, y: 0.5 } }} />,
    );

    for (const text of WEIGHTS) expect(shift(text)).toEqual([1, 0.5]);
    for (const text of [...DETAILS, ...TIMES]) expect(shift(text)).toBeNull();
  });

  it('moves the date/time beside the calendar icons on its own', () => {
    render(
      <SlipA5
        view="overprint"
        values={values}
        calibration={{ 'weight-times': { x: 0, y: -0.75 } }}
      />,
    );

    for (const text of TIMES) expect(shift(text)).toEqual([0, -0.75]);
    for (const text of [...DETAILS, ...WEIGHTS]) expect(shift(text)).toBeNull();
  });

  it('never moves anything on screen', () => {
    render(
      <SlipA5
        view="soft"
        values={values}
        calibration={{
          details: { x: 0, y: -2 },
          weights: { x: 1, y: 0.5 },
          'weight-times': { x: 0, y: -0.75 },
        }}
      />,
    );

    for (const text of [...DETAILS, ...WEIGHTS, ...TIMES]) expect(shift(text)).toBeNull();
  });
});
