/** The suggestion input used by the dashboard filters and the customer picker. */

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { Autocomplete, type AutocompleteOption } from '../src/components/ui/autocomplete.js';

const OPTIONS: AutocompleteOption<{ id: number }>[] = [
  { value: '1', label: 'Ali Raza', description: 'Raza Traders', data: { id: 1 } },
  { value: '2', label: 'Bilal Khan', description: 'Khan Brothers', data: { id: 2 } },
  { value: '3', label: 'Imran Sheikh', description: 'Sheikh Traders', data: { id: 3 } },
];

function Harness({
  options = OPTIONS,
  onSelect,
  isLoading = false,
}: {
  options?: AutocompleteOption<{ id: number }>[];
  onSelect?: (o: AutocompleteOption<{ id: number }>) => void;
  isLoading?: boolean;
}) {
  const [value, setValue] = useState('');
  return (
    <Autocomplete
      id="test-field"
      aria-label="Customer"
      value={value}
      onValueChange={setValue}
      options={options}
      onSelect={onSelect}
      isLoading={isLoading}
    />
  );
}

describe('suggesting', () => {
  it('shows matches once the operator starts typing', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.type(screen.getByRole('combobox'), 'a');
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    expect(screen.getByText('Ali Raza')).toBeInTheDocument();
  });

  it('shows the second line so two people with one name can be told apart', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(screen.getByRole('combobox'), 'a');
    expect(screen.getByText('Raza Traders')).toBeInTheDocument();
  });

  it('says so when nothing matches', async () => {
    const user = userEvent.setup();
    render(<Harness options={[]} />);
    await user.type(screen.getByRole('combobox'), 'zzz');
    expect(screen.getByText(/no matches/i)).toBeInTheDocument();
  });

  it('shows a searching state rather than "no matches" while loading', async () => {
    const user = userEvent.setup();
    render(<Harness options={[]} isLoading />);
    await user.type(screen.getByRole('combobox'), 'a');
    expect(screen.getByText(/searching/i)).toBeInTheDocument();
    expect(screen.queryByText(/no matches/i)).not.toBeInTheDocument();
  });
});

describe('choosing', () => {
  it('fills the input and hands the whole option back', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<Harness onSelect={onSelect} />);

    await user.type(screen.getByRole('combobox'), 'a');
    await user.click(screen.getByText('Bilal Khan'));

    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ data: { id: 2 } }));
    expect(screen.getByRole('combobox')).toHaveValue('Bilal Khan');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('works from the keyboard', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<Harness onSelect={onSelect} />);

    await user.type(screen.getByRole('combobox'), 'a');
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}');

    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ label: 'Bilal Khan' }));
  });

  it('wraps around rather than dead-ending at the last option', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<Harness onSelect={onSelect} />);

    await user.type(screen.getByRole('combobox'), 'a');
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}{Enter}');
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ label: 'Ali Raza' }));
  });

  it('closes on Escape without choosing anything', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<Harness onSelect={onSelect} />);

    await user.type(screen.getByRole('combobox'), 'a');
    await user.keyboard('{Escape}');

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(onSelect).not.toHaveBeenCalled();
  });
});

describe('typing something new', () => {
  it('never locks the operator to the list', async () => {
    // A truck is on the bridge and this customer has never been weighed here.
    const user = userEvent.setup();
    render(<Harness options={[]} />);

    await user.type(screen.getByRole('combobox'), 'Brand New Customer');
    expect(screen.getByRole('combobox')).toHaveValue('Brand New Customer');
  });

  it('leaves Enter alone when no suggestion is highlighted, so forms still submit', async () => {
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
    const user = userEvent.setup();
    render(
      <form onSubmit={onSubmit}>
        <Harness />
      </form>,
    );

    await user.type(screen.getByRole('combobox'), 'Ali{Enter}');
    expect(onSubmit).toHaveBeenCalled();
  });
});

describe('accessibility', () => {
  it('is announced as a combobox with its list', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const input = screen.getByRole('combobox');

    expect(input).toHaveAttribute('aria-expanded', 'false');
    await user.type(input, 'a');
    expect(input).toHaveAttribute('aria-expanded', 'true');
    expect(input).toHaveAttribute('aria-controls', screen.getByRole('listbox').id);
  });

  it('points at the highlighted option for a screen reader', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const input = screen.getByRole('combobox');

    await user.type(input, 'a');
    await user.keyboard('{ArrowDown}');
    expect(input.getAttribute('aria-activedescendant')).toBe(screen.getAllByRole('option')[0]?.id);
  });
});

describe('activation without a pointer', () => {
  it('responds to a plain click, which is what assistive tech dispatches', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<Harness onSelect={onSelect} />);

    await user.type(screen.getByRole('combobox'), 'a');
    // Dispatched directly, with no pointer events before it.
    screen.getAllByRole('option')[1]!.click();

    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ label: 'Bilal Khan' }));
  });

  it('does not choose twice when a real pointer press fires both events', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<Harness onSelect={onSelect} />);

    await user.type(screen.getByRole('combobox'), 'a');
    await user.click(screen.getByText('Ali Raza'));

    expect(onSelect).toHaveBeenCalledTimes(1);
  });
});
