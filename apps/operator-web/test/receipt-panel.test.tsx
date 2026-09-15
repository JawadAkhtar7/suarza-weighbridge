/**
 * The receipt preview and its actions (operator feedback items 1 and 9).
 *
 * Printing opens the receipt in its own tab rather than firing a hidden print
 * frame, and the PDF comes from the agent so it works with no internet.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { netWeightAllUnits } from '@suarza/shared';
import { ReceiptPanel } from '../src/components/receipt-panel.js';
import { renderWithQuery, weighment } from './utils.js';

const openSpy = vi.fn();

beforeEach(() => {
  openSpy.mockReset();
  openSpy.mockReturnValue({ focus: vi.fn() });
  vi.stubGlobal('open', openSpy);
});

const completed = () =>
  weighment({
    status: 'COMPLETED',
    second_weight_kg: 20_000,
    second_weight_at: '2026-09-14T11:00:00.000Z',
    second_weight_src: 'SERIAL',
    net_weight_kg: 12_000,
  });

describe('the preview', () => {
  it('shows the soft form, header and all', () => {
    renderWithQuery(
      <ReceiptPanel weighment={weighment()} net={netWeightAllUnits(8000, null)} variant="FIRST" />,
    );

    expect(screen.getByText(/receipt 1 — first weight/i)).toBeInTheDocument();
    expect(screen.getByText('Suarza International')).toBeInTheDocument();
    expect(screen.getByText(/only the central block/i)).toBeInTheDocument();
  });
});

describe('printing', () => {
  it('opens the receipt in a new tab', async () => {
    renderWithQuery(
      <ReceiptPanel
        weighment={completed()}
        net={netWeightAllUnits(8000, 20_000)}
        variant="SECOND"
      />,
    );

    await userEvent.setup().click(screen.getByRole('button', { name: /^print$/i }));

    expect(openSpy).toHaveBeenCalledWith(expect.stringContaining('/print/SI-000001'), '_blank');
  });

  it('tells the tab which receipt to render', async () => {
    renderWithQuery(
      <ReceiptPanel weighment={completed()} net={netWeightAllUnits(8000, 20_000)} variant="SECOND" />,
    );

    await userEvent.setup().click(screen.getByRole('button', { name: /^print$/i }));

    const url = openSpy.mock.calls[0]?.[0] as string;
    expect(url).toContain('variant=SECOND');
  });

  it('says so when the browser blocks the tab', async () => {
    // A blocked pop-up would otherwise look like nothing happened and the
    // operator would keep pressing the button.
    openSpy.mockReturnValue(null);
    renderWithQuery(
      <ReceiptPanel
        weighment={completed()}
        net={netWeightAllUnits(8000, 20_000)}
        variant="SECOND"
      />,
    );

    await userEvent.setup().click(screen.getByRole('button', { name: /^print$/i }));
    expect(await screen.findByText(/blocked the receipt tab/i)).toBeInTheDocument();
  });

  it('opens the tab once when auto-print is on', async () => {
    renderWithQuery(
      <ReceiptPanel
        weighment={weighment()}
        net={netWeightAllUnits(8000, null)}
        variant="FIRST"
        autoPrint
      />,
    );

    await waitFor(() => expect(openSpy).toHaveBeenCalledTimes(1));
  });
});

describe('downloading', () => {
  it('offers the full receipt as a PDF from the agent', () => {
    // The agent, not the cloud: this has to work with the internet down.
    renderWithQuery(
      <ReceiptPanel
        weighment={completed()}
        net={netWeightAllUnits(8000, 20_000)}
        variant="SECOND"
      />,
    );

    const link = screen.getByRole('link', { name: /download pdf/i });
    expect(link).toHaveAttribute('href', '/weighments/SI-000001/pdf');
    expect(link).toHaveAttribute('download');
  });

  it('explains that the PDF keeps the header and footer', () => {
    renderWithQuery(
      <ReceiptPanel
        weighment={completed()}
        net={netWeightAllUnits(8000, 20_000)}
        variant="SECOND"
      />,
    );
    expect(screen.getByText(/header and footer included/i)).toBeInTheDocument();
  });
});
