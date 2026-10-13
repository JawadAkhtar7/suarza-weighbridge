/**
 * The A5 weighbridge slip: the client's own artwork, as one component.
 *
 * Start at layout.ts — it explains the three views and why every coordinate
 * lives in one place.
 */

export { SlipA5, SLIP_PAGE_CSS, SLIP_CANVAS } from './slip-a5.js';
export { MeasureSheet, offsetMarks, rulerMarks } from './measure-sheet.js';
export type { MeasureSheetProps, RulerMark } from './measure-sheet.js';
export { renderSlipPage } from './page.js';
export type { SlipPageOptions } from './page.js';
export type { SlipA5Props } from './slip-a5.js';
export {
  slipValues,
  slipDate,
  slipTime,
  slipDateTime,
  slipKg,
  slipMann,
  slipAmount,
} from './values.js';
export type { SlipValuesOptions } from './values.js';
export { CANVAS, PAGE_MM, UNIT_MM, COLOURS, FONTS, SLIP, LAYERS, VIEW_ASPECT } from './layout.js';
export type { SlipView, SlipItem, Layer, ValueField, SlipValues } from './layout.js';
