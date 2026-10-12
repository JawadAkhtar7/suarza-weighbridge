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
import type { ViewFrame } from '@suarza/shared';

export interface SlipPageOptions {
  view: SlipView;
  values: SlipValues;
  /** Shown in the browser tab and used as the default filename when saved. */
  title: string;
  verifyUrl?: string;
  frontImageUrl?: string;
  sideImageUrl?: string;
  /** How the station frames its front view; the design's own crop if absent. */
  frontViewFrame?: ViewFrame;
  /** How the station frames its side view; the whole frame if absent. */
  sideViewFrame?: ViewFrame;
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
  /**
   * Share as PDF, Download PDF, Share as image and Download image buttons
   * above the slip, on screen only — for the page behind the QR code.
   *
   * The work is done on the phone by the scripts named here, served by the
   * host page's own origin: one draws this page's slip into an image, the
   * other wraps it in a PDF and shares or downloads it. The buttons start
   * disabled and those scripts enable them, so a page whose scripts did not
   * load shows buttons that do nothing rather than ones that pretend to.
   */
  shareActions?: { fileName: string; scripts: readonly string[] };
}

export function renderSlipPage(options: SlipPageOptions): string {
  const {
    view,
    values,
    title,
    verifyUrl,
    frontImageUrl,
    sideImageUrl,
    frontViewFrame,
    sideViewFrame,
    offsetXmm,
    offsetYmm,
    autoPrint = false,
    shareActions,
  } = options;

  const slip = renderToStaticMarkup(
    React.createElement(SlipA5, {
      view,
      values,
      verifyUrl,
      frontImageUrl,
      sideImageUrl,
      frontViewFrame,
      sideViewFrame,
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
<style id="slip-fonts">
${SLIP_FONT_CSS}
</style>
<style>
${SLIP_PAGE_CSS}
html, body { margin: 0; padding: 0; background: #e9ecea; }
/* The share and download buttons: two by two on a phone, one row on a
   screen wide enough, never on paper. */
.actions {
  box-sizing: border-box;
  max-width: ${PAGE_MM.width}mm;
  margin: 0 auto;
  padding: 12px;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
}
@media (min-width: 560px) {
  .actions { grid-template-columns: repeat(4, minmax(0, 1fr)); }
}
.actions button {
  min-height: 44px;
  padding: 8px 10px;
  border: 0;
  border-radius: 8px;
  background: #125b31;
  color: #fff;
  font: inherit;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}
.actions button.secondary { background: #fff; color: #125b31; box-shadow: inset 0 0 0 1.5px #125b31; }
.actions button:disabled { opacity: 0.55; cursor: default; }
.actions .status { grid-column: 1 / -1; margin: 0; min-height: 1.2em; font-size: 13px; color: #374151; text-align: center; }
@media print { .actions { display: none; } }
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
${shareActions ? renderShareActions(shareActions, title) : ''}
<div class="sheet">${slip}</div>
${autoPrint ? '<script>window.addEventListener("load",function(){window.print()})</script>' : ''}
</body>
</html>`;
}

/** The four buttons, their status line, and the scripts that drive them. */
function renderShareActions(
  actions: NonNullable<SlipPageOptions['shareActions']>,
  title: string,
): string {
  const button = (action: string, label: string, secondary: boolean) =>
    `<button type="button" data-action="${action}"${secondary ? ' class="secondary"' : ''} disabled>${label}</button>`;
  /* In order: the library first, as a classic script that defines its global;
     ours after it, as a module, which always runs once the page is parsed. */
  const [library, ...ours] = actions.scripts;
  const scripts = [
    library ? `<script src="${escapeHtml(library)}"></script>` : '',
    ...ours.map((src) => `<script type="module" src="${escapeHtml(src)}"></script>`),
  ].join('\n');

  return `<div class="actions" data-slip-actions data-file-name="${escapeHtml(actions.fileName)}" data-title="${escapeHtml(title)}">
${button('share-pdf', 'Share as PDF', false)}
${button('download-pdf', 'Download PDF', true)}
${button('share-image', 'Share as image', false)}
${button('download-image', 'Download image', true)}
<p class="status" data-slip-status role="status" aria-live="polite"></p>
</div>
${scripts}`;
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (ch) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] as string,
  );
}
