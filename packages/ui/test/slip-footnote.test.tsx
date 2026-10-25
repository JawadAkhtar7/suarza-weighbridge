/**
 * The footnote under the photographs: who weighed it, and whose figure it is.
 *
 * Two lines with different audiences. The operator's name is a note for
 * whoever looks the slip up later and belongs only on the soft copy — the
 * paper has no room for it. The owner's declaration is a disclaimer and has
 * to be on BOTH: a disclaimer that appeared only on the copy nobody keeps
 * would be no disclaimer at all.
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
    second_weight_src: 'MANUAL',
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

const operator = { name: 'Imran Shah', shift: 'Morning' };

describe('the operator line', () => {
  it('names who weighed it on the soft copy', () => {
    render(<SlipA5 view="soft" values={slipValues({ weighment: weighment(), operator })} />);
    expect(screen.getByText('Operator: Imran Shah · Morning shift')).toBeInTheDocument();
  });

  it('keeps it off the paper, which has no room for it', () => {
    render(<SlipA5 view="overprint" values={slipValues({ weighment: weighment(), operator })} />);
    expect(screen.queryByText(/^Operator:/)).not.toBeInTheDocument();
  });

  it('says nothing at all when nobody is named', () => {
    render(<SlipA5 view="soft" values={slipValues({ weighment: weighment() })} />);
    expect(screen.queryByText(/^Operator:/)).not.toBeInTheDocument();
  });
});

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

describe("the owner's declaration", () => {
  it('prints on the paper as well as the screen', () => {
    for (const view of ['soft', 'overprint'] as const) {
      const { unmount } = render(
        <SlipA5
          view={view}
          values={slipValues({ weighment: weighment({ owner_declared: true }), operator })}
        />,
      );
      expect(screen.getByText(OWNER_DECLARATION)).toBeInTheDocument();
      unmount();
    }
  });

  it('is absent from an ordinary weighing', () => {
    render(
      <SlipA5
        view="soft"
        values={slipValues({ weighment: weighment({ owner_declared: false }), operator })}
      />,
    );
    expect(screen.queryByText(OWNER_DECLARATION)).not.toBeInTheDocument();
  });

  it('sits above the operator line rather than beside it', () => {
    /*
     * The two together run past the SCAN TO VERIFY box on one line —
     * measured on a render of the artwork. Stacking is what keeps a long
     * name from pushing the disclaimer off the sheet.
     */
    render(
      <SlipA5
        view="soft"
        values={slipValues({ weighment: weighment({ owner_declared: true }), operator })}
      />,
    );

    const top = (text: string | RegExp) =>
      Number.parseFloat((screen.getByText(text) as HTMLElement).style.top);

    expect(top(OWNER_DECLARATION)).toBeLessThan(top(/^Operator:/));
  });
});
