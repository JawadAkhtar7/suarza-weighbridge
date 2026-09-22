/**
 * Chart colours, for both themes.
 *
 * Every chart here is single-series: identity is carried by the axis labels, so
 * colour encodes nothing and a categorical palette would be decoration. One
 * validated hue does the whole job and sidesteps the colourblind-separation
 * problem that a per-category palette would create.
 *
 * The brand green itself was rejected as the mark colour: at OKLCH L 0.393 /
 * C 0.090 it fails both the lightness band and the chroma floor, and reads
 * near-black at mark size. These two steps are the same hue family, stepped to
 * pass: light #15803d (L 0.527, C 0.137, 5.0:1 on white), dark #22c55e
 * (7.8:1 on the dark surface).
 *
 * Recharts paints into SVG attributes, not CSS, so it cannot inherit the theme
 * the way the rest of the dashboard does — the values below therefore mirror
 * the tokens in @suarza/ui's globals.css by hand. Change one, change the other.
 */

import type { CSSProperties } from 'react';
import type { ResolvedTheme } from '@suarza/ui';

export const CHART_SERIES_LIGHT = '#15803d';
export const CHART_SERIES_DARK = '#22c55e';

export interface ChartPalette {
  /** The one series colour: line, area fill and every bar. */
  series: string;
  /** Recessive, so the data reads before the scaffolding does. */
  grid: string;
  axisText: string;
  /** The band that follows the pointer across a bar chart. */
  cursorFill: string;
  tooltip: CSSProperties;
  tooltipLabel: CSSProperties;
}

const TOOLTIP_SHAPE = {
  borderRadius: '0.375rem',
  fontSize: '0.8125rem',
} as const;

const LIGHT: ChartPalette = {
  series: CHART_SERIES_LIGHT,
  grid: 'hsl(146 20% 90%)',
  axisText: 'hsl(215 16% 47%)',
  cursorFill: 'hsl(210 40% 96%)',
  tooltip: {
    ...TOOLTIP_SHAPE,
    border: '1px solid hsl(146 20% 86%)',
    background: 'hsl(0 0% 100%)',
    boxShadow: '0 4px 12px rgb(0 0 0 / 0.08)',
  },
  tooltipLabel: { color: 'hsl(222 47% 11%)' },
};

/* Surfaces track --card / --border / --muted-foreground in the dark block; the
   shadow is heavier because a soft one is invisible against a dark page. */
const DARK: ChartPalette = {
  series: CHART_SERIES_DARK,
  grid: 'hsl(217 33% 24%)',
  axisText: 'hsl(215 20% 65%)',
  cursorFill: 'hsl(217 33% 18%)',
  tooltip: {
    ...TOOLTIP_SHAPE,
    border: '1px solid hsl(217 33% 26%)',
    background: 'hsl(222 45% 12%)',
    boxShadow: '0 4px 14px rgb(0 0 0 / 0.5)',
    color: 'hsl(210 40% 98%)',
  },
  tooltipLabel: { color: 'hsl(210 40% 98%)' },
};

export function chartPalette(theme: ResolvedTheme): ChartPalette {
  return theme === 'dark' ? DARK : LIGHT;
}
