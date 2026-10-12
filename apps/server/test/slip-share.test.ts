/**
 * The slip page's PDF, built on the phone around the slip's JPEG
 * (public/slip-share.js). Built by hand, so what makes it a valid PDF is
 * pinned here: every cross-reference offset lands on its object, and the page
 * is the pads' 140 x 200 mm.
 */

import { describe, expect, it } from 'vitest';
// @ts-expect-error - a plain browser module, with no type declarations.
import { jpegToPdf } from '../public/slip-share.js';

/** A stand-in for a JPEG: the start and end markers around arbitrary bytes. */
const fakeJpeg = new Uint8Array([0xff, 0xd8, 0x00, 0x0a, 0x0d, 0x25, 0x25, 0x45, 0xff, 0xd9]);

const latin1 = (bytes: Uint8Array) => Buffer.from(bytes).toString('latin1');

describe('jpegToPdf', () => {
  const pdf: Uint8Array = jpegToPdf(fakeJpeg, 1588, 2268);
  const text = latin1(pdf);

  it('is a PDF that ends where a reader looks for its table', () => {
    expect(text.startsWith('%PDF-1.4\n')).toBe(true);
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);

    const startxref = Number(/startxref\n(\d+)\n%%EOF/.exec(text)?.[1]);
    expect(text.slice(startxref, startxref + 4)).toBe('xref');
  });

  it('points every cross-reference entry at the object it names', () => {
    const table = text.slice(text.indexOf('xref\n'));
    const offsets = [...table.matchAll(/^(\d{10}) 00000 n $/gm)].map((match) => Number(match[1]));
    expect(offsets).toHaveLength(5);
    offsets.forEach((offset, index) => {
      expect(text.slice(offset, offset + `${index + 1} 0 obj`.length)).toBe(`${index + 1} 0 obj`);
    });
  });

  it('is one page of exactly 140 x 200 mm, filled by the image', () => {
    const mediaBox = /\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/.exec(text)!;
    expect((Number(mediaBox[1]) / 72) * 25.4).toBeCloseTo(140, 1);
    expect((Number(mediaBox[2]) / 72) * 25.4).toBeCloseTo(200, 1);
    expect(text).toContain('/Count 1');
    expect(text).toContain(`q ${mediaBox[1]} 0 0 ${mediaBox[2]} 0 0 cm /Im0 Do Q`);
  });

  it('carries the JPEG byte for byte, declared at its own size and length', () => {
    expect(text).toContain('/Width 1588 /Height 2268');
    expect(text).toContain('/Filter /DCTDecode');
    expect(text).toContain(`/Length ${fakeJpeg.length} >>\nstream\n`);
    const start = text.indexOf('stream\n', text.indexOf('/Subtype /Image')) + 'stream\n'.length;
    expect([...pdf.slice(start, start + fakeJpeg.length)]).toEqual([...fakeJpeg]);
  });
});
