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
     pnpm ledger:render out.png

   Sample data below, not a fixture from the database: it carries one of each
   kind of entry including a voided one, so a layout change can be judged
   against every row type at once.                                           */

const outPng = resolve(process.argv[2] ?? join(root, 'ledger-report.png'));

/* pnpm does not hoist, so nothing in this folder can import react by name.
   Everything is resolved from the ui package, which actually depends on it. */
const requireFromUi = createRequire(resolve(root, 'packages/ui/package.json'));
const fromUi = (id) => import(pathToFileURL(requireFromUi.resolve(id)).href);

const React = (await fromUi('react')).default;
const { renderToStaticMarkup } = await fromUi('react-dom/server');
const { LedgerReport, LEDGER_REPORT_PAGE_CSS } = await import(
  pathToFileURL(resolve(root, 'packages/ui/src/reports/index.ts')).href
);

const customer = {
  id: 'cus_7Q2F4K',
  match_key: 'adnan bhatti|ali commision',
  name: 'Adnan Bhatti',
  company: 'Ali Commision',
  phone: '0308 4389603',
  balance_pkr: -7400,
  total_charged_pkr: 21400,
  total_paid_pkr: 14000,
  entry_count: 7,
  last_entry_at: '2026-10-02T05:53:00.000Z',
};

const E = (id, at, direction, kind, amount, balance, extra = {}) => ({
  id, customer_id: customer.id, direction, kind,
  amount_pkr: amount, at, note: null, weighment_id: null, slip_number: null,
  created_by: 'manager', created_at: at, voided: false, voided_at: null,
  voided_by: null, void_reason: null, balance_after_pkr: balance, ...extra,
});

const entries = [
  E('1', '2026-09-02T05:30:00.000Z', 'DEBIT',  'WEIGHING',   5000,  -5000, { slip_number: '20261' }),
  E('2', '2026-09-08T07:10:00.000Z', 'DEBIT',  'WEIGHING',   4200,  -9200, { slip_number: '20262' }),
  E('3', '2026-09-12T11:45:00.000Z', 'CREDIT', 'PAYMENT',    9000,   -200, { note: 'Cash at the gate' }),
  E('4', '2026-09-19T06:05:00.000Z', 'DEBIT',  'WEIGHING',   5200,  -5400, { slip_number: '20263' }),
  E('5', '2026-09-23T09:20:00.000Z', 'CREDIT', 'ADJUSTMENT',  800,  -4600, { note: 'Discount agreed for the damaged load' }),
  E('6', '2026-09-28T04:40:00.000Z', 'DEBIT',  'WEIGHING',   7000, -11600, { slip_number: '20264' }),
  E('7', '2026-09-29T10:00:00.000Z', 'DEBIT',  'ADJUSTMENT', 1500, -11600, { voided: true, void_reason: 'Keyed twice' }),
  E('8', '2026-10-02T05:53:00.000Z', 'CREDIT', 'PAYMENT',    4200,  -7400, { note: 'Bank transfer' }),
];

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

const body = renderToStaticMarkup(
  React.createElement(LedgerReport, {
    customer,
    entries,
    printedAt: '2026-10-02T05:53:00.000Z',
  }),
);

/* The fonts come from the installed packages as data URIs: Chrome is launched
   with no network, so a @font-face pointing at a file path or a CDN would
   silently fall back and the screenshot would be a lie. */
const fontCss = buildFontCss();

const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
${fontCss}
html,body{margin:0;padding:0;background:#ffffff}
${LEDGER_REPORT_PAGE_CSS}
</style></head><body>${body}</body></html>`;

const dir = mkdtempSync(join(tmpdir(), 'slip-'));
const page = join(dir, 'slip.html');
writeFileSync(page, html);

/* 210 x 297 mm at 96 dpi. */
const scale = 2;
execFileSync(
  'google-chrome',
  [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--hide-scrollbars',
    '--force-device-scale-factor=' + scale,
    `--window-size=${Math.round(210 / 25.4 * 96)},${Math.round(297 / 25.4 * 96)}`,
    '--virtual-time-budget=4000',
    `--screenshot=${outPng}`,
    page,
  ],
  { stdio: 'inherit' },
);

console.log(`ledger report -> ${outPng}`);

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
