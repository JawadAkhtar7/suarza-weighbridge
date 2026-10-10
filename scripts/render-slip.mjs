/**
 * Renders the A5 slip to a PNG, so it can be held against the client's artwork.
 *
 *   pnpm slip:render [soft|overprint|template] [out.png]
 *
 * This exists because "it should look identical" is a claim that can only be
 * checked by looking. It server-renders the real component with sample data,
 * wraps it in the real page CSS and the real fonts, and drives headless Chrome
 * to photograph it at exactly A5. What comes out is what a printer would put on
 * paper, which is the only thing worth comparing.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

/* Run it with tsx, not node — the component is TypeScript:
     pnpm slip:render soft out.png                                           */

const view = process.argv[2] ?? 'soft';
const outPng = resolve(process.argv[3] ?? join(root, `slip-${view}.png`));

/* pnpm does not hoist, so nothing in this folder can import react by name.
   Everything is resolved from the ui package, which actually depends on it. */
const requireFromUi = createRequire(resolve(root, 'packages/ui/package.json'));
const fromUi = (id) => import(pathToFileURL(requireFromUi.resolve(id)).href);

const React = (await fromUi('react')).default;
const { renderToStaticMarkup } = await fromUi('react-dom/server');
const { SlipA5, SLIP_PAGE_CSS, slipValues, PAGE_MM } = await import(
  pathToFileURL(resolve(root, 'packages/ui/src/receipt/slip/index.ts')).href
);

/** The client's own sample, so the render can be compared line for line. */
const weighment = {
  id: '00000000-0000-4000-8000-000000000000',
  slip_number: 'SU-0005236',
  status: 'COMPLETED',
  station_id: 'A',
  customer_name: 'Adnan Bhatti',
  customer_company: 'Ali Commision',
  customer_phone: '03084389603',
  vehicle_type: 'TRUCK',
  vehicle_type_label: 'TRUCK 2XL',
  vehicle_plate: 'LEW-14-1353',
  container_number: 'MNBU13596475',
  product: 'FRESH POTATO',
  payment_status: 'PAID',
  first_weight_kg: 32480,
  first_weight_at: '2026-10-02T05:53:00.000Z',
  first_weight_src: 'INDICATOR',
  second_weight_kg: 22480,
  second_weight_at: '2026-10-02T05:53:00.000Z',
  second_weight_src: 'MANUAL',
  net_weight_kg: 10000,
  amount_charged: 5000,
  currency: 'PKR',
  operator_username: 'operator',
  created_at: '2026-10-02T05:53:00.000Z',
  updated_at: '2026-10-02T05:53:00.000Z',
  void_reason: null,
  voided_at: null,
};

const company = {
  name: 'Suarza International',
  address: '2 Km, Chowk Hujra Shah Muqeem, Near Hansa Wala Morr,Kasur Road Depalpur',
  phone: '+92 300 1231231',
  website: 'www.suarza.com',
};

const values = slipValues({ weighment, company, printedAt: '2026-10-02T05:53:00.000Z' });

const body = renderToStaticMarkup(
  React.createElement(SlipA5, {
    view,
    values,
    verifyUrl: 'https://suarza.com/r/SU-0005236',
  }),
);

/* The fonts come from the installed packages as data URIs: Chrome is launched
   with no network, so a @font-face pointing at a file path or a CDN would
   silently fall back and the screenshot would be a lie. */
const fontCss = buildFontCss();

const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
${fontCss}
html,body{margin:0;padding:0;background:${view === 'overprint' ? '#ffffff' : '#ffffff'}}
${SLIP_PAGE_CSS}
</style></head><body>${body}</body></html>`;

const dir = mkdtempSync(join(tmpdir(), 'slip-'));
const page = join(dir, 'slip.html');
writeFileSync(page, html);

/* The page at 96 dpi, then x4 so the glyph edges are judgeable. Taken from
   PAGE_MM so a change of paper size needs no edit here. */
const scale = 4;
execFileSync(
  'google-chrome',
  [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--hide-scrollbars',
    '--force-device-scale-factor=' + scale,
    `--window-size=${Math.round(PAGE_MM.width / 25.4 * 96)},${Math.round(PAGE_MM.height / 25.4 * 96)}`,
    '--virtual-time-budget=4000',
    `--screenshot=${outPng}`,
    page,
  ],
  { stdio: 'inherit' },
);

console.log(`${view} -> ${outPng}`);

/** Every @fontsource face the slip uses, inlined. */
function buildFontCss() {
  const families = [
    ['montserrat', 'Montserrat', [500, 600, 700, 900], ['latin']],
    ['noto-naskh-arabic', 'Noto Naskh Arabic', [400, 600, 700], ['arabic']],
    ['archivo', 'Archivo', [500, 600], ['latin']],
    ['open-sans', 'Open Sans', [600, 700], ['latin']],
  ];
  const out = [];
  for (const [pkg, family, weights, subsets] of families) {
    for (const weight of weights) {
      for (const subset of subsets) {
        /* Resolved through the ui package, because pnpm does not hoist and the
           files live under its own node_modules. */
        let file;
        try {
          file = requireFromUi.resolve(
            `@fontsource/${pkg}/files/${pkg}-${subset}-${weight}-normal.woff2`,
          );
        } catch {
          console.warn(`missing font: @fontsource/${pkg} ${subset} ${weight}`);
          continue;
        }
        try {
          const b64 = readFileSync(file).toString('base64');
          out.push(
            `@font-face{font-family:'${family}';font-style:normal;font-weight:${weight};` +
              `src:url(data:font/woff2;base64,${b64}) format('woff2');font-display:block}`,
          );
        } catch {
          console.warn(`missing font file: ${file}`);
        }
      }
    }
  }
  return out.join('\n');
}
