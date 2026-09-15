/**
 * The public receipt page (brief §8: `GET /r/:slip`).
 *
 * This really is the operator app's receipt component, server-rendered — not a
 * second copy of the markup. The driver scanning the QR sees the same document
 * the operator previewed, because it IS the same component.
 *
 * Nothing is stored: every visit re-renders from the database record.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
/*
 * React is imported explicitly, and must stay imported.
 *
 * This file is server-rendered by the cloud API, whose dev runner (tsx) ignores
 * `"jsx": "react-jsx"` and always emits the CLASSIC transform — so the JSX below
 * becomes `React.createElement` and needs React in scope. The bundled build uses
 * the automatic runtime and does not, but an extra import costs nothing there.
 * Without this the public QR receipt page 500s in dev with
 * "ReferenceError: React is not defined".
 */
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Receipt, type ReceiptCompany } from '@suarza/ui/receipt';
import { netWeightAllUnits, type Weighment } from '@suarza/shared';

/**
 * The compiled stylesheet, built by `pnpm build:css`.
 *
 * The SOURCE it is built from is `receipt.tailwind.css` — deliberately a
 * different name. When both were called `receipt.css`, the dev server (running
 * from `src/`) picked up the uncompiled one, inlined `@tailwind base;` into the
 * page, and the browser silently ignored it: the receipt rendered as raw
 * unstyled HTML with no error anywhere. The `@tailwind` guard below is the
 * belt to that braces.
 *
 * Not cached in development, so an edit to the receipt shows up on refresh
 * instead of requiring a server restart.
 */
let cachedCss: string | null = null;

function loadCss(): string {
  const isDev = process.env['NODE_ENV'] !== 'production';
  if (cachedCss !== null && !isDev) return cachedCss;

  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(here, 'receipt.css'),
    resolve(here, '../dist/receipt.css'),
    resolve(here, '../../dist/receipt.css'),
  ];

  for (const candidate of candidates) {
    try {
      const css = readFileSync(candidate, 'utf8');
      if (css.includes('@tailwind')) {
        // Uncompiled source. Using it would produce a page that looks broken
        // and reports nothing, so it is skipped loudly instead.
        console.warn(`Ignoring uncompiled stylesheet at ${candidate} — run 'pnpm build:css'.`);
        continue;
      }
      cachedCss = css;
      return cachedCss;
    } catch {
      // Try the next location.
    }
  }

  console.warn('No compiled receipt stylesheet found — the receipt page will be unstyled.');
  // Readable beats a 500 on a driver's phone, but it should never get here.
  return 'body{font-family:system-ui,sans-serif;margin:0;padding:16px;background:#f5f5f5}';
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function shell(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${escapeHtml(title)}</title>
<style>${loadCss()}
/*
 * Printing gives the same thing here as anywhere else in the product: the
 * central block only, in plain ink. The branded header and footer are for the
 * screen and the PDF — on paper they are either already on the pad or simply
 * not wanted. The print: utilities on the component itself flatten the green
 * panels; this hides the parts that must not print at all.
 */
@media print {
  .print-hidden,
  .receipt-soft-only { display: none !important; }
  html, body { margin: 0 !important; padding: 0 !important; background: #fff !important; }
  main { max-width: none !important; }
  .receipt-print-block { box-shadow: none !important; }
}</style>
</head>
<body class="bg-neutral-100 py-6 px-4">
${body}
</body>
</html>`;
}

export interface ReceiptPageOptions {
  weighment: Weighment;
  company: ReceiptCompany;
  /** Absolute URL of this page, re-encoded into the QR on it. */
  pageUrl: string;
}

export function renderReceiptPage({ weighment, company, pageUrl }: ReceiptPageOptions): string {
  const net = netWeightAllUnits(weighment.first_weight_kg, weighment.second_weight_kg);
  const variant = weighment.status === 'COMPLETED' ? 'SECOND' : 'FIRST';

  const receiptHtml = renderToStaticMarkup(
    <Receipt
      weighment={weighment}
      net={net}
      variant={variant}
      company={company}
      receiptUrl={pageUrl}
    />,
  );

  const slip = encodeURIComponent(weighment.slip_number);

  // Laid out to match the operator's /print page exactly — same controls above
  // the slip, same 150mm column, same plain white card. Two pages showing the
  // same receipt should not look like two different documents.
  const body = `
<main class="mx-auto w-full max-w-[150mm]">
  <div class="print-hidden mb-4 flex flex-wrap gap-2">
    <button
      id="print-receipt"
      type="button"
      class="inline-flex items-center justify-center gap-2 rounded-md bg-[#155932] px-4 py-2 text-sm font-semibold text-white shadow-sm"
    >Print</button>
    <a
      href="/r/${slip}/pdf"
      class="inline-flex items-center justify-center gap-2 rounded-md border border-[#155932] bg-white px-4 py-2 text-sm font-semibold text-[#155932] no-underline shadow-sm"
    >Download PDF</a>
  </div>

  <div class="bg-white shadow-sm">${receiptHtml}</div>

  <p class="print-hidden mt-4 text-center text-xs text-neutral-500">
    Generated from the weighbridge record. Nothing is stored — this page is rebuilt each visit.
  </p>
</main>
<!-- An external file, not an inline handler: the page's CSP allows scripts
     from 'self' only, and inline handlers are exactly what that blocks. -->
<script src="/r/receipt-page.js"></script>`;

  return shell(`Receipt ${weighment.slip_number} — ${company.name}`, body);
}

/**
 * Shown when a slip isn't in the cloud yet. This is a normal state, not an
 * error: the QR is printed the instant the weighing happens, and if the PC is
 * offline the record arrives once sync catches up (brief §8, honest caveat).
 */
export function renderNotFoundPage(slipNumber: string, companyName: string): string {
  const body = `
<main class="mx-auto w-full max-w-[150mm]">
  <div class="rounded-lg bg-white p-8 text-center shadow-lg">
    <h1 class="text-xl font-bold text-neutral-900">Receipt not available yet</h1>
    <p class="mt-3 text-sm text-neutral-600">
      We have no record for slip
      <span class="font-semibold text-neutral-900">${escapeHtml(slipNumber)}</span>.
    </p>
    <p class="mt-3 text-sm text-neutral-600">
      If this slip was issued just now, the weighbridge may not have sent it yet —
      that happens within seconds of the connection returning. Try again shortly.
    </p>
    <p class="mt-6 text-xs text-neutral-500">
      Check the number on your slip, or contact ${escapeHtml(companyName)}.
    </p>
  </div>
</main>`;

  return shell(`Receipt ${slipNumber} — not found`, body);
}
