/**
 * The footnote under the photographs: the disclaimer, and when it appears.
 *
 * It is on the paper as well as the screen, because a disclaimer that
 * appeared only on the copy nobody keeps would be no disclaimer at all. It
 * appears whenever a figure on the slip was typed rather than weighed —
 * whichever of the three ways that happened.
 */

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { OWNER_DECLARATION, type Weighment } from '@suarza/shared';
import { SlipA5 } from '../src/receipt/slip/slip-a5.js';
import { slipValues } from '../src/receipt/slip/values.js';

const weighment = (overrides: Partial<Weighment> = {}): Weighment =>
  ({
    id: '11111111-1111-4111-8111-111111111111',
    slip_number: '20261',
    status: 'COMPLETED',
    station_id: 'A',
    customer_name: 'Ali Raza',
    customer_company: 'Raza Traders',
    vehicle_type: 'container',
    vehicle_type_label: 'Container',
    vehicle_plate: 'LES-1234',
    product: 'Cement',
    first_weight_kg: 8000,
    first_weight_at: '2026-10-25T09:00:00.000Z',
    first_weight_src: 'SERIAL',
    second_weight_kg: 20_000,
    second_weight_at: '2026-10-25T11:00:00.000Z',
    second_weight_src: 'SERIAL',
    net_weight_kg: 12_000,
    amount_charged: 300,
    currency: 'PKR',
    payment_status: 'PAID',
    operator_username: 'imran',
    created_at: '2026-10-25T09:00:00.000Z',
    updated_at: '2026-10-25T11:00:00.000Z',
    void_reason: null,
    voided_at: null,
    owner_declared: false,
    ...overrides,
  }) as Weighment;

describe('the amount', () => {
  it('prints a zero rather than leaving the box empty', () => {
    /*
     * The container re-weigh charges nothing. A blank amount box on that
     * slip reads as a figure somebody forgot, which is the opposite of what
     * it means.
     */
    render(
      <SlipA5 view="soft" values={slipValues({ weighment: weighment({ amount_charged: 0 }) })} />,
    );
    expect(screen.getByText('PKR 0/-')).toBeInTheDocument();
  });
});

describe('the declaration', () => {
  const showsIt = (weighing: Partial<Weighment>, view: 'soft' | 'overprint' = 'soft') => {
    const { unmount } = render(
      <SlipA5 view={view} values={slipValues({ weighment: weighment(weighing) })} />,
    );
    const present = screen.queryByText(OWNER_DECLARATION) !== null;
    unmount();
    return present;
  };

  it('prints on the paper as well as the screen', () => {
    expect(showsIt({ owner_declared: true }, 'soft')).toBe(true);
    expect(showsIt({ owner_declared: true }, 'overprint')).toBe(true);
  });

  it('appears when the owner declared the load', () => {
    expect(
      showsIt({ owner_declared: true, first_weight_src: 'SERIAL', second_weight_src: 'SERIAL' }),
    ).toBe(true);
  });

  it('appears when either weight was typed rather than weighed', () => {
    /*
     * A hand-typed figure is a figure nobody measured, whichever half of
     * the weighing it belongs to — so the slip says so either way.
     */
    expect(showsIt({ first_weight_src: 'MANUAL', second_weight_src: 'SERIAL' })).toBe(true);
    expect(showsIt({ first_weight_src: 'SERIAL', second_weight_src: 'MANUAL' })).toBe(true);
  });

  it('is absent when the bridge weighed both figures itself', () => {
    expect(showsIt({ first_weight_src: 'SERIAL', second_weight_src: 'SERIAL' })).toBe(false);
  });
});
