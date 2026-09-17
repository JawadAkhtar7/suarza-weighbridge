/**
 * The print CSS decides what reaches the paper. Getting it wrong means either
 * a blank slip or the company header printed on top of a pre-printed one.
 */

import { describe, expect, it } from 'vitest';
import { printSettingsSchema } from '@suarza/shared';
import {
  buildPageStyle,
  buildTestPrintStyle,
  PRINT_BLOCK_CLASS,
  SOFT_ONLY_CLASS,
} from '../src/receipt/print-style.js';

const settings = (overrides: Record<string, unknown> = {}) => printSettingsSchema.parse(overrides);

describe('buildPageStyle', () => {
  it('hides the branded header and footer when printing', () => {
    // The whole point of the hard form: the pad already carries the branding.
    const css = buildPageStyle(settings());
    expect(css).toContain(`.${SOFT_ONLY_CLASS}`);
    expect(css).toMatch(new RegExp(`\\.${SOFT_ONLY_CLASS}\\s*\\{\\s*display:\\s*none`));
  });

  it('defaults to A5 with no page margin of its own', () => {
    // A5 is the client's pre-printed pad, and the only size in use since the
    // control was removed from the operator app.
    const css = buildPageStyle(settings());
    expect(css).toContain('size: A5');
    // Zero, so the operator's offsets are the only thing positioning the block.
    expect(css).toMatch(/@page\s*\{[^}]*margin:\s*0/);
  });

  it('applies the operator-calibrated offsets to the print block', () => {
    const css = buildPageStyle(settings({ offset_top_mm: 12, offset_left_mm: 7 }));
    expect(css).toContain(`.${PRINT_BLOCK_CLASS}`);
    expect(css).toContain('padding-top: 12mm');
    // The offset shifts the block on the pad; the side margin keeps the text
    // off the paper edge. Both apply, so they are added rather than one
    // replacing the other.
    expect(css).toContain('padding-left: calc(7mm + 4mm)');
  });

  it('keeps the same margin on both sides', () => {
    // The right side used to carry a margin the left did not, which printed
    // the block hard against the left edge of the page.
    const css = buildPageStyle(settings());
    expect(css).toContain('padding-left: calc(0mm + 4mm)');
    expect(css).toContain('padding-right: 4mm');
  });

  it('accepts negative offsets for a printer that starts too low', () => {
    const css = buildPageStyle(settings({ offset_top_mm: -6 }));
    expect(css).toContain('padding-top: -6mm');
  });

  it('converts the scale percentage to a transform', () => {
    expect(buildPageStyle(settings({ scale_percent: 90 }))).toContain('scale(0.9)');
    expect(buildPageStyle(settings({ scale_percent: 100 }))).toContain('scale(1)');
  });

  it('supports each paper size', () => {
    expect(buildPageStyle(settings({ paper_size: 'A4' }))).toContain('size: A4');
    expect(buildPageStyle(settings({ paper_size: 'LETTER' }))).toContain('size: letter');
    expect(
      buildPageStyle(
        settings({ paper_size: 'CUSTOM', custom_width_mm: 120, custom_height_mm: 180 }),
      ),
    ).toContain('size: 120mm 180mm');
  });

  it('keeps a receipt from splitting across two sheets of the pad', () => {
    // A second page would carry the net weight onto paper with no header.
    const css = buildPageStyle(settings());
    expect(css).toContain('break-inside: avoid');
    expect(css).toContain('page-break-inside: avoid');
  });
});

describe('buildTestPrintStyle', () => {
  it('keeps the page rules and adds the calibration outline', () => {
    const css = buildTestPrintStyle(settings({ offset_top_mm: 9 }));
    expect(css).toContain('padding-top: 9mm');
    expect(css).toContain('.receipt-test-outline');
  });
});
