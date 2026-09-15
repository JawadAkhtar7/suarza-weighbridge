/** The sales table and its server-side pagination (brief §9). */

import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SalesTable } from '../src/components/sales-table.js';
import { page, renderWithQuery, weighment } from './utils.js';
import { setViewport } from './setup.js';

function setup(overrides: Partial<Parameters<typeof SalesTable>[0]> = {}) {
  const onPageChange = vi.fn();
  const onSelect = vi.fn();
  renderWithQuery(
    <SalesTable
      data={page([weighment()], 1)}
      isLoading={false}
      page={1}
      pageSize={25}
      onPageChange={onPageChange}
      onSelect={onSelect}
      {...overrides}
    />,
  );
  return { onPageChange, onSelect, user: userEvent.setup() };
}

describe('rows', () => {
  it('shows the slip, customer, vehicle, net weight and amount', () => {
    setup();
    expect(screen.getByText('SI-000001')).toBeInTheDocument();
    expect(screen.getByText('Ali Raza')).toBeInTheDocument();
    expect(screen.getByText('Raza Traders')).toBeInTheDocument();
    expect(screen.getByText('LES-1234')).toBeInTheDocument();
    expect(screen.getByText('12,000 kg')).toBeInTheDocument();
    expect(screen.getByText('Rs 300')).toBeInTheDocument();
  });

  it('shows a dash instead of a net weight for an unfinished weighing', () => {
    // Printing "0 kg" would read as a real measurement of nothing.
    setup({
      data: page([weighment({ status: 'OPEN', second_weight_kg: null, net_weight_kg: 0 })]),
    });
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.queryByText('0 kg')).not.toBeInTheDocument();
  });

  it('marks a voided ticket', () => {
    setup({ data: page([weighment({ status: 'VOID' })]) });
    expect(screen.getByText('VOID')).toBeInTheDocument();
  });

  it('opens the receipt when a row is clicked', async () => {
    const { onSelect, user } = setup();
    await user.click(screen.getByText('SI-000001'));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ slip_number: 'SI-000001' }));
  });

  it('says so plainly when nothing matches', () => {
    setup({ data: page([], 0) });
    expect(screen.getByText(/no weighments match these filters/i)).toBeInTheDocument();
  });
});

describe('pagination', () => {
  it('reports which rows are on screen out of the whole result', () => {
    setup({
      data: page(
        Array.from({ length: 25 }, () => weighment()),
        137,
        2,
      ),
      page: 2,
    });
    expect(screen.getByText('26–50 of 137')).toBeInTheDocument();
    expect(screen.getByText('Page 2 of 6')).toBeInTheDocument();
  });

  it('disables Previous on the first page', () => {
    setup({
      data: page(
        Array.from({ length: 25 }, () => weighment()),
        137,
        1,
      ),
    });
    expect(screen.getByRole('button', { name: /previous/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /next/i })).toBeEnabled();
  });

  it('disables Next on the last page', () => {
    setup({ data: page([weighment()], 26, 2), page: 2 });
    expect(screen.getByRole('button', { name: /next/i })).toBeDisabled();
  });

  it('asks the server for the next page rather than slicing locally', async () => {
    const { onPageChange, user } = setup({
      data: page(
        Array.from({ length: 25 }, () => weighment()),
        137,
        1,
      ),
    });
    await user.click(screen.getByRole('button', { name: /next/i }));
    expect(onPageChange).toHaveBeenCalledWith(2);
  });

  it('does not let a page be turned mid-load', () => {
    setup({
      isLoading: true,
      data: page(
        Array.from({ length: 25 }, () => weighment()),
        137,
        1,
      ),
    });
    expect(screen.getByRole('button', { name: /next/i })).toBeDisabled();
  });
});

describe('on a phone', () => {
  it('shows a card list instead of a table, with the amount visible', () => {
    // Eight columns need ~970px; a phone has ~360. Scrolling sideways to reach
    // the amount is not an acceptable answer for the figure they came for.
    setViewport(false);
    setup();

    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByText('SI-000001')).toBeInTheDocument();
    expect(screen.getByText('Ali Raza')).toBeInTheDocument();
    expect(screen.getByText('Rs 300')).toBeInTheDocument();
    expect(screen.getByText('COMPLETED')).toBeInTheDocument();
  });

  it('renders each row exactly once, so a screen reader does not repeat them', () => {
    setViewport(false);
    setup();
    expect(screen.getAllByText('SI-000001')).toHaveLength(1);
  });

  it('opens the receipt from a card', async () => {
    setViewport(false);
    const { onSelect, user } = setup();
    await user.click(screen.getByText('SI-000001'));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ slip_number: 'SI-000001' }));
  });

  it('still paginates', () => {
    setViewport(false);
    setup({
      data: page(
        Array.from({ length: 25 }, () => weighment()),
        137,
        1,
      ),
    });
    expect(screen.getByText('1–25 of 137')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /next/i })).toBeEnabled();
  });
});
