/**
 * Chart colours.
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
 */

export const CHART_SERIES_LIGHT = '#15803d';
export const CHART_SERIES_DARK = '#22c55e';

/** Recessive, so the data reads before the scaffolding does. */
export const CHART_GRID = 'hsl(146 20% 90%)';
export const CHART_AXIS_TEXT = 'hsl(215 16% 47%)';

export const CHART_TOOLTIP_STYLE = {
  borderRadius: '0.375rem',
  border: '1px solid hsl(146 20% 86%)',
  background: 'hsl(0 0% 100%)',
  fontSize: '0.8125rem',
  boxShadow: '0 4px 12px rgb(0 0 0 / 0.08)',
} as const;
