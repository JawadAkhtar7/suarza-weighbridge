import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { netWeightAllUnits } from '@suarza/shared';
import { NetWeightDisplay } from '../src/components/net-weight-display.js';

describe('NetWeightDisplay', () => {
  it('shows the net in all three units', () => {
    render(<NetWeightDisplay net={netWeightAllUnits(8000, 20_000)} />);

    expect(screen.getByText('12,000 kg')).toBeInTheDocument();
    expect(screen.getByText('300.000 Mann')).toBeInTheDocument();
    // Ton is deliberately absent: nobody at the bridge weighs in it, and a
    // third figure is one more thing to read past.
    expect(screen.queryByText(/ton/i)).toBeNull();
  });

  it('is identical whichever order the truck was weighed in', () => {
    const { unmount } = render(<NetWeightDisplay net={netWeightAllUnits(20_000, 8000)} />);
    expect(screen.getByText('12,000 kg')).toBeInTheDocument();
    unmount();

    render(<NetWeightDisplay net={netWeightAllUnits(8000, 20_000)} />);
    expect(screen.getByText('12,000 kg')).toBeInTheDocument();
  });

  it('asks for the second weight instead of showing a net of zero', () => {
    render(<NetWeightDisplay net={netWeightAllUnits(8000, null)} pending />);

    expect(screen.getByText(/capture the second weight/i)).toBeInTheDocument();
    expect(screen.queryByText('0 kg')).not.toBeInTheDocument();
  });
});
