import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { currentSlipYear } from '@suarza/shared';
import { SlipSearch } from '../src/components/slip-search.js';

/* Not hard-coded: a slip number carries the year, so a fixture written as
   "2026123" quietly starts failing every January. */
const YEAR = currentSlipYear();

function setup(error: string | null = null) {
  const onSearch = vi.fn();
  const onErrorCleared = vi.fn();
  render(
    <SlipSearch
      onSearch={onSearch}
      isSearching={false}
      error={error}
      onErrorCleared={onErrorCleared}
    />,
  );
  return { onSearch, onErrorCleared, user: userEvent.setup() };
}

describe('SlipSearch', () => {
  it('asks only for the part after the year, and prints the year beside it', () => {
    // The point of the change: the first four digits are the same on every
    // slip for a whole year, so they are shown rather than typed.
    setup();
    expect(screen.getByLabelText(new RegExp(`slip number, after ${YEAR}`, 'i'))).toBeInTheDocument();
    expect(screen.getAllByText(String(YEAR)).length).toBeGreaterThan(0);
  });

  it('turns what the operator types into the whole slip number', async () => {
    const { onSearch, user } = setup();
    await user.type(screen.getByLabelText(/slip number/i), '123{Enter}');
    expect(onSearch).toHaveBeenCalledWith(`${YEAR}123`);
  });

  it('still accepts the whole number, for anyone who types all of it', async () => {
    const { onSearch, user } = setup();
    await user.type(screen.getByLabelText(/slip number/i), `${YEAR}123`);
    await user.click(screen.getByRole('button', { name: /fetch/i }));
    expect(onSearch).toHaveBeenCalledWith(`${YEAR}123`);
  });

  it('ignores stray spaces and punctuation off a creased slip', async () => {
    const { onSearch, user } = setup();
    await user.type(screen.getByLabelText(/slip number/i), '  1 2 3 {Enter}');
    expect(onSearch).toHaveBeenCalledWith(`${YEAR}123`);
  });

  it('does nothing on an empty submit', async () => {
    const { onSearch, user } = setup();
    await user.click(screen.getByRole('button', { name: /fetch/i }));
    expect(onSearch).not.toHaveBeenCalled();
  });

  it('shows a not-found error inline, next to the field', () => {
    setup('No weighment found for that slip number. Check the slip and try again.');
    expect(screen.getByText(/no weighment found/i)).toBeInTheDocument();
  });

  it('clears the error as soon as the operator starts retyping', async () => {
    const { onErrorCleared, user } = setup('No weighment found');
    await user.type(screen.getByLabelText(/slip number/i), '5');
    expect(onErrorCleared).toHaveBeenCalled();
  });

  it('focuses the field on mount so the operator can just start typing', () => {
    setup();
    expect(screen.getByLabelText(/slip number/i)).toHaveFocus();
  });
});
