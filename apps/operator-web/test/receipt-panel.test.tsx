/**
 * The receipt preview and its actions (operator feedback items 1 and 9).
 *
 * Printing opens the receipt in its own tab rather than firing a hidden print
 * frame, and the PDF comes from the agent so it works with no internet.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { COMPANY } from '@suarza/shared';
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
  it('shows the whole slip, design and all', () => {
    renderWithQuery(<ReceiptPanel weighment={weighment()} variant="FIRST" />);

    expect(screen.getByText(/receipt 1 — first weight/i)).toBeInTheDocument();
    // The same slip the printer and the QR page produce, not a second design.
    expect(screen.getByText('WEIGHT BRIDGE SLIP')).toBeInTheDocument();
    expect(screen.getByAltText('Suarza International')).toBeInTheDocument();
    expect(screen.getByText(/only the values/i)).toBeInTheDocument();
  });

  it("carries Suarza's own details, which come from code", () => {
    // Not from Settings and not from the station profile any more: one
    // constant, so the preview, the paper and the QR page cannot disagree.
    renderWithQuery(<ReceiptPanel weighment={weighment()} variant="FIRST" />);

    expect(screen.getByText(`Operator No.: ${COMPANY.phone}`)).toBeInTheDocument();
    expect(screen.getByText(COMPANY.website)).toBeInTheDocument();
    for (const line of COMPANY.addressLines) {
      expect(screen.getByText(line)).toBeInTheDocument();
    }
  });
});

describe('printing', () => {
  it('opens the receipt in a new tab', async () => {
    renderWithQuery(
      <ReceiptPanel
        weighment={completed()}
        variant="SECOND"
      />,
    );

    await userEvent.setup().click(screen.getByRole('button', { name: /^print$/i }));

    expect(openSpy).toHaveBeenCalledWith(expect.stringContaining('/print/20261'), '_blank');
  });

  it('tells the tab which receipt to render', async () => {
    renderWithQuery(
      <ReceiptPanel weighment={completed()} variant="SECOND" />,
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
        variant="FIRST"
        autoPrint
      />,
    );

    await waitFor(() => expect(openSpy).toHaveBeenCalledTimes(1));
  });
});

describe('getting a copy', () => {
  it('offers the print tab and no separate file to download', async () => {
    /*
     * There is no PDF builder any more. The old one drew the receipt a second
     * time with PDFKit, which cannot shape Arabic script, so it dropped every
     * Urdu label the client's design is built on and could never match the
     * paper slip. The print tab IS the slip, and the browser's own "Save as
     * PDF" produces the file at A5 — one rendering, nothing to drift.
     */
    renderWithQuery(
      <ReceiptPanel
        weighment={completed()}
        variant="SECOND"
      />,
    );

    expect(screen.queryByRole('link', { name: /download/i })).toBeNull();

    await userEvent.setup().click(screen.getByRole('button', { name: /^print$/i }));
    expect(openSpy).toHaveBeenCalledWith(expect.stringContaining('/print/20261'), '_blank');
  });
});
