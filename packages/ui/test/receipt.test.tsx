/** The receipt's two forms and two variants (brief §8). */

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QRCodeSVG } from 'qrcode.react';
import { netWeightAllUnits, type Weighment } from '@suarza/shared';
import { Receipt } from '../src/receipt/receipt.js';
import { PRINT_BLOCK_CLASS, SOFT_ONLY_CLASS } from '../src/receipt/print-style.js';

const company = {
  name: 'Suarza International',
  address: '12 Industrial Road, Lahore',
  phone: '+92 300 0000000',
};

const base = (overrides: Partial<Weighment> = {}): Weighment =>
  ({
    id: '11111111-1111-4111-8111-111111111111',
    slip_number: 'SI-000123',
    status: 'OPEN',
    station_id: 'A',
    customer_name: 'Ali Raza',
    customer_company: 'Raza Traders',
    customer_phone: undefined,
    vehicle_type: 'truck',
    vehicle_plate: 'LES-1234',
    container_number: undefined,
    product: 'Cement',
    first_weight_kg: 8000,
    first_weight_at: '2026-09-14T09:00:00.000Z',
    first_weight_src: 'SERIAL',
    second_weight_kg: null,
    second_weight_at: null,
    second_weight_src: null,
    net_weight_kg: 0,
    amount_charged: 300,
    currency: 'PKR',
    operator_username: 'operator',
    created_at: '2026-09-14T09:00:00.000Z',
    updated_at: '2026-09-14T09:00:00.000Z',
    void_reason: null,
    voided_at: null,
    ...overrides,
  }) as Weighment;

const completed = () =>
  base({
    status: 'COMPLETED',
    second_weight_kg: 20_000,
    second_weight_at: '2026-09-14T11:00:00.000Z',
    second_weight_src: 'SERIAL',
    net_weight_kg: 12_000,
  });

function renderReceipt(
  weighment: Weighment,
  variant: 'FIRST' | 'SECOND',
  url: string | null = null,
) {
  return render(
    <Receipt
      weighment={weighment}
      net={netWeightAllUnits(weighment.first_weight_kg, weighment.second_weight_kg)}
      variant={variant}
      company={company}
      receiptUrl={url}
    />,
  );
}

describe('soft and hard forms', () => {
  it('marks the header and footer as screen-only', () => {
    const { container } = renderReceipt(base(), 'FIRST');
    const softParts = container.querySelectorAll(`.${SOFT_ONLY_CLASS}`);

    // Exactly two: the branded header and the branded footer. They are hidden
    // by the print stylesheet because the pad already carries them.
    expect(softParts).toHaveLength(2);
    expect(screen.getByText('Suarza International')).toBeInTheDocument();
  });

  it('puts everything that must print inside the print block', () => {
    const { container } = renderReceipt(completed(), 'SECOND');
    const block = container.querySelector(`.${PRINT_BLOCK_CLASS}`);

    expect(block).not.toBeNull();
    // The figures the receipt exists for must survive the header being hidden.
    for (const text of ['SI-000123', 'Ali Raza', '12,000 kg', 'Rs 300']) {
      expect(block!.textContent).toContain(text);
    }
  });

  it('keeps the company name out of the print block', () => {
    const { container } = renderReceipt(completed(), 'SECOND');
    const block = container.querySelector(`.${PRINT_BLOCK_CLASS}`);
    expect(block!.textContent).not.toContain('Suarza International');
  });
});

describe('receipt 1 — after the first weight', () => {
  it('shows the details, the first weight and the slip number', () => {
    renderReceipt(base(), 'FIRST');
    expect(screen.getByText('SI-000123')).toBeInTheDocument();
    expect(screen.getByText('8,000 kg')).toBeInTheDocument();
    expect(screen.getByText(/second weighing pending/i)).toBeInTheDocument();
  });

  it('carries no net weight, because there is not one yet', () => {
    renderReceipt(base(), 'FIRST');
    expect(screen.queryByText(/net weight/i)).not.toBeInTheDocument();
    // The second-weight row says so explicitly rather than printing "0 kg",
    // which a customer could read as a real weighing.
    expect(screen.getByText('pending')).toBeInTheDocument();
    expect(screen.queryByText('0 kg')).not.toBeInTheDocument();
  });
});

describe('receipt 2 — after completion', () => {
  it('shows both weights and the net in all three units', () => {
    renderReceipt(completed(), 'SECOND');
    expect(screen.getByText('8,000 kg')).toBeInTheDocument();
    expect(screen.getByText('20,000 kg')).toBeInTheDocument();
    expect(screen.getByText('12,000 kg')).toBeInTheDocument();
    expect(screen.getByText(/12\.000 ton/)).toBeInTheDocument();
    expect(screen.getByText(/300\.000 maund/)).toBeInTheDocument();
  });

  it('shows the amount charged', () => {
    renderReceipt(completed(), 'SECOND');
    expect(screen.getByText('Rs 300')).toBeInTheDocument();
  });
});

describe('honesty markers', () => {
  it('flags a manually entered weight on the paper, not just in the database', () => {
    renderReceipt(base({ first_weight_src: 'MANUAL' }), 'FIRST');
    expect(screen.getByText(/\(manual\)/i)).toBeInTheDocument();
  });

  it('carries no reprint marking — every copy reads as the receipt itself', () => {
    // Reprints are still recorded in the audit log; they are simply not
    // stamped on the paper the customer is handed.
    renderReceipt(completed(), 'SECOND');
    expect(screen.queryByText(/^reprint$/i)).not.toBeInTheDocument();
  });

  it('states the void reason on a voided ticket', () => {
    renderReceipt(base({ status: 'VOID', void_reason: 'Truck never returned' }), 'FIRST');
    expect(screen.getByText(/voided — truck never returned/i)).toBeInTheDocument();
  });
});

describe('QR code', () => {
  it('encodes the cloud receipt URL for this slip', () => {
    const { container } = renderReceipt(
      completed(),
      'SECOND',
      'https://wb.example.com/r/SI-000123',
    );
    expect(container.querySelector('svg')).not.toBeNull();
    expect(screen.getByText(/scan for a copy/i)).toBeInTheDocument();
  });

  it('encodes exactly the URL it is given, and nothing else', () => {
    // No QR decoder here, so the proof is by construction: the receipt's QR
    // must be byte-identical to one rendered directly from the same string,
    // and must differ for a different slip.
    const url = 'https://wb.example.com/r/SI-000123';
    const pathOf = (root: HTMLElement) =>
      root.querySelector('svg path:last-of-type')?.getAttribute('d');

    const receipt = renderReceipt(completed(), 'SECOND', url);
    const receiptPath = pathOf(receipt.container);
    receipt.unmount();

    const reference = render(<QRCodeSVG value={url} size={76} level="M" marginSize={0} />);
    expect(receiptPath).toBe(pathOf(reference.container));
    reference.unmount();

    const otherSlip = renderReceipt(completed(), 'SECOND', 'https://wb.example.com/r/SI-000999');
    expect(pathOf(otherSlip.container)).not.toBe(receiptPath);
  });

  it('prints no QR at all when the cloud address is not configured', () => {
    // A QR that resolves nowhere on a customer's receipt is worse than none.
    const { container } = renderReceipt(completed(), 'SECOND', null);
    expect(container.querySelector('svg')).toBeNull();
    expect(screen.queryByText(/scan for a copy/i)).not.toBeInTheDocument();
  });
});
