import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SlipSearch } from '../src/components/slip-search.js';

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
  it('accepts the slip exactly as printed', async () => {
    const { onSearch, user } = setup();
    await user.type(screen.getByLabelText(/slip number/i), 'SI-000123');
    await user.click(screen.getByRole('button', { name: /fetch/i }));
    expect(onSearch).toHaveBeenCalledWith('SI-000123');
  });

  it('accepts the shorthand an operator actually types', async () => {
    // Typing "123" off a slip is far quicker than the full form, and is
    // unambiguous — so it is normalised rather than rejected.
    const { onSearch, user } = setup();
    await user.type(screen.getByLabelText(/slip number/i), '123{Enter}');
    expect(onSearch).toHaveBeenCalledWith('SI-000123');
  });

  it('is case-insensitive and tolerates stray spaces', async () => {
    const { onSearch, user } = setup();
    await user.type(screen.getByLabelText(/slip number/i), '  si-000123 {Enter}');
    expect(onSearch).toHaveBeenCalledWith('SI-000123');
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
    await user.type(screen.getByLabelText(/slip number/i), 'S');
    expect(onErrorCleared).toHaveBeenCalled();
  });

  it('focuses the field on mount so the operator can just start typing', () => {
    setup();
    expect(screen.getByLabelText(/slip number/i)).toHaveFocus();
  });
});
