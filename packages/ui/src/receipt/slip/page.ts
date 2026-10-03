/**
 * A slip as a complete HTML document.
 *
 * This is what the cloud serves behind the QR code, and what the browser turns
 * into a PDF when somebody saves it. There is no PDF generator any more: the
 * old one drew the receipt a second time with PDFKit, by hand, and could never
 * render Urdu at all — PDFKit does not shape Arabic script, so the generated
 * receipt silently dropped every Urdu label the client's design is built on.
 * A page the browser prints is the same markup the screen shows, so the three
 * forms cannot disagree, and "Save as PDF" at A5 produces the slip exactly.
 *
 * The document carries its own fonts and its own artwork, with no external
 * reference of any kind. That is what lets the public page run under a content
 * policy that permits no scripts and no network fetches, and it is also why the
 * weighbridge PC can print a slip with the internet unplugged.
 */

import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SlipA5, SLIP_PAGE_CSS } from './slip-a5.js';
import type { SlipValues, SlipView } from './layout.js';
import { SLIP_FONT_CSS } from './fonts-inline.js';
import { PAGE_MM } from './layout.js';

export interface SlipPageOptions {
  view: SlipView;
  values: SlipValues;
  /** Shown in the browser tab and used as the default filename when saved. */
  title: string;
  verifyUrl?: string;
  frontImageUrl?: string;
  sideImageUrl?: string;
  offsetXmm?: number;
  offsetYmm?: number;
  /**
   * Opens the print dialogue as soon as the page has rendered.
   *
   * Off by default, and off entirely on the public page: a stranger's phone
   * that throws up a print dialogue unasked is a page people close. The
   * operator's own reprint turns it on, because printing is the only reason
   * that page was opened.
   */
  autoPrint?: boolean;
}

export function renderSlipPage(options: SlipPageOptions): string {
  const {
    view,
    values,
    title,
    verifyUrl,
    frontImageUrl,
    sideImageUrl,
    offsetXmm,
    offsetYmm,
    autoPrint = false,
  } = options;

  const slip = renderToStaticMarkup(
    React.createElement(SlipA5, {
      view,
      values,
      verifyUrl,
      frontImageUrl,
      sideImageUrl,
      offsetXmm,
      offsetYmm,
    }),
  );

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${escapeHtml(title)}</title>
<style>
${SLIP_FONT_CSS}
${SLIP_PAGE_CSS}
html, body { margin: 0; padding: 0; background: #e9ecea; }
/* On a phone the sheet is wider than the screen, so it scales to fit rather
   than making the reader pan across an A5 page with two fingers. */
.sheet {
  margin: 0 auto;
  width: ${PAGE_MM.width}mm;
  transform-origin: top center;
  box-shadow: 0 2px 18px rgba(0, 0, 0, 0.18);
  background: #fff;
}
@media screen and (max-width: ${PAGE_MM.width}mm) {
  .sheet { transform: scale(calc(100vw / ${PAGE_MM.width}mm)); }
}
@media print {
  html, body { background: #fff; }
  .sheet { margin: 0; box-shadow: none; transform: none; }
}
</style>
</head>
<body>
<div class="sheet">${slip}</div>
${autoPrint ? '<script>window.addEventListener("load",function(){window.print()})</script>' : ''}
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (ch) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] as string,
  );
}
