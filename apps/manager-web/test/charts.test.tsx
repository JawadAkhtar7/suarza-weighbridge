/** Chart data shaping and the headline tiles. */

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { foldTail } from '../src/components/charts.js';
import { StatTiles } from '../src/components/stat-tiles.js';
import { chartPalette } from '../src/lib/chart-theme.js';
import { analytics } from './utils.js';

describe('foldTail', () => {
  it('leaves a short list alone, sorted by size', () => {
    const result = foldTail([
      { label: 'b', value: 2 },
      { label: 'a', value: 9 },
    ]);
    expect(result.map((r) => r.label)).toEqual(['a', 'b']);
  });

  it('drops categories with no revenue rather than drawing empty bars', () => {
    const result = foldTail([
      { label: 'a', value: 5 },
      { label: 'b', value: 0 },
    ]);
    expect(result.map((r) => r.label)).toEqual(['a']);
  });

  it('folds a long tail into one "Other" bar', () => {
    // Eleven vehicle types would otherwise become unreadable slivers, and
    // inventing eleven distinguishable hues is not possible anyway.
    const rows = Array.from({ length: 11 }, (_, i) => ({ label: `v${i}`, value: 11 - i }));
    const result = foldTail(rows);

    expect(result).toHaveLength(7);
    expect(result.at(-1)!.label).toBe('Other (5)');
    // Nothing is lost — the tail is summed, not discarded.
    expect(result.reduce((sum, r) => sum + r.value, 0)).toBe(rows.reduce((s, r) => s + r.value, 0));
  });
});

describe('StatTiles', () => {
  it('shows the headline figures', () => {
    render(<StatTiles analytics={analytics()} isLoading={false} />);
    expect(screen.getByText('Rs 1,500')).toBeInTheDocument();
    expect(screen.getByText('39,000 kg')).toBeInTheDocument();
    expect(screen.getByText('3 completed')).toBeInTheDocument();
  });

  it('says out loud that voided tickets are excluded', () => {
    // The manager is looking at a revenue number; how it was computed matters.
    render(<StatTiles analytics={analytics()} isLoading={false} />);
    expect(screen.getByText(/voided tickets excluded/i)).toBeInTheDocument();
  });

  it('shows placeholders rather than zeros while loading', () => {
    render(<StatTiles analytics={undefined} isLoading />);
    expect(screen.queryByText('Rs 0')).not.toBeInTheDocument();
  });
});

describe('chartPalette', () => {
  it('gives each theme its own set — nothing is shared by accident', () => {
    const light = chartPalette('light');
    const dark = chartPalette('dark');

    // Recharts paints into SVG attributes, so a value left over from the other
    // theme does not merely look off — it is invisible. Every slot differs.
    expect(dark.series).not.toBe(light.series);
    expect(dark.grid).not.toBe(light.grid);
    expect(dark.axisText).not.toBe(light.axisText);
    expect(dark.cursorFill).not.toBe(light.cursorFill);
    expect(dark.tooltip.background).not.toBe(light.tooltip.background);
  });

  it('gives the dark tooltip a text colour of its own', () => {
    // Without it the tooltip inherits near-black body text onto a dark card
    // and the figure the manager hovered for cannot be read.
    expect(chartPalette('dark').tooltip.color).toBeTruthy();
    expect(chartPalette('dark').tooltipLabel.color).toBeTruthy();
  });
});
