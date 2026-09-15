// The full-product check (brief §13-M9): one truck, all the way through.
//
// Run it with `./scripts/end-to-end.sh` — that script starts MongoDB, the
// cloud server, the agent on its simulator, and a headless browser, then drives
// this file against them. Nothing here needs the weighbridge hardware.
//   weigh in → weigh out → receipts → sync → dashboard → QR page → PDF
//   → reprint → void an abandoned ticket → audit trail
const CDP_PORT = 9350;
const AGENT = 'http://127.0.0.1:3099';
const CLOUD = 'http://127.0.0.1:4099';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
const check = (label, ok, extra = '') => {
  console.log(`   ${ok ? '✓' : '✗'}  ${label}${extra ? ' — ' + extra : ''}`);
  if (!ok) failures++;
};
const step = (n, title) => console.log(`\n── ${n}. ${title} ${'─'.repeat(Math.max(0, 52 - title.length))}`);

async function findTarget() {
  for (let i = 0; i < 80; i++) {
    try {
      const t = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
      const p = t.find((x) => x.type === 'page' && x.webSocketDebuggerUrl);
      if (p) return p;
    } catch { /* starting */ }
    await wait(250);
  }
  throw new Error('no CDP target');
}
const target = await findTarget();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pending = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); const p = pending.get(m.id); if (p) { pending.delete(m.id); p(m); } };
const send = (method, params = {}) => { const i = ++id; ws.send(JSON.stringify({ id: i, method, params })); return new Promise((r) => pending.set(i, r)); };
const ev = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? 'eval error');
  return r.result.result.value;
};
const HELPERS = `
  window.__openedTabs = window.__openedTabs ?? [];
  window.open = (url) => { window.__openedTabs.push(url); return { focus: () => {}, close: () => {} }; };
  window.__btn = (t) => [...document.querySelectorAll('button')].find((b) => b.textContent.trim().toLowerCase() === t.toLowerCase());
  window.__btnLike = (t) => [...document.querySelectorAll('button')].find((b) => b.textContent.trim().toLowerCase().includes(t.toLowerCase()));
  window.__set = (sel, v) => { const el = document.querySelector(sel); const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement : window.HTMLInputElement; Object.getOwnPropertyDescriptor(proto.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input',{bubbles:true})); };
  window.__setPh = (ph, v) => { const el = [...document.querySelectorAll('input')].find(i => i.placeholder === ph); Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set.call(el, v); el.dispatchEvent(new Event('input',{bubbles:true})); };
  window.__has = (t) => document.body.innerText.toLowerCase().includes(t.toLowerCase());
`;
const park = (kg) => fetch(AGENT + '/simulator/weight', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ weight_kg: kg }) });
const api = (base, path, init) => fetch(base + path, init).then((r) => r.json());
async function waitFor(fn, label, timeoutMs = 30_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) { if (await fn()) return true; await wait(500); }
  console.log(`      (timed out waiting for ${label})`);
  return false;
}

await send('Runtime.enable');
await send('Page.enable');

// Auto-print off: headless Chrome has no printer, and the receipt is checked
// on screen instead.
await send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.print = () => { window.__printed = (window.__printed ?? 0) + 1; };' });

step(1, 'Configure the station');
await fetch(AGENT + '/settings', {
  method: 'PUT', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    ...(await api(AGENT, '/settings')),
    company_name: 'Suarza International',
    company_address: '12 Industrial Road, Lahore, Pakistan',
    company_phone: '+92 300 0000000',
    receipt_base_url: CLOUD,
    auto_print: false,
  }),
});
const settings = await api(AGENT, '/settings');
check('settings saved to the agent', settings.receipt_base_url === CLOUD);

step(2, 'Operator app loads from the agent');
await send('Page.navigate', { url: AGENT + '/' });
await wait(2500);
await ev(HELPERS);
check('operator app served by the agent', await ev("__has('Weighbridge — Operator')"));
check('live weight is streaming', (await api(AGENT, '/live-weight')).connected === true);

step(3, 'Pass 1 — empty truck at 8,000 kg');
await park(8000);
await wait(600);
await ev("__btnLike('Capture weight').click()");
await wait(400);
check('weight captured as a frozen snapshot', await ev("__has('First weight captured')"));
for (const [ph, v] of [['Ali Raza', 'Imran Sheikh'], ['Raza Traders', 'Sheikh Traders'], ['LES-1234', 'LHR-4521'], ['Cement', 'Wheat']]) {
  await ev(`__setPh(${JSON.stringify(ph)}, ${JSON.stringify(v)})`);
}
await wait(200);
await ev("__btnLike('Save first weight').click()");
await wait(1500);
const slip = await ev("(() => { const p = [...document.querySelectorAll('p')].find(e => e.textContent.trim() === 'Slip number'); return p?.nextElementSibling?.textContent?.trim() ?? null; })()");
check('slip number issued', /^SI-\d{6}$/.test(slip ?? ''), slip);
check('receipt 1 shown, ready to print', await ev("__has('Receipt 1 — first weight')"));
check('receipt carries a QR code', await ev("!!document.querySelector('.receipt-print-block svg')"));

step(4, 'Pass 2 — loaded truck at 20,500 kg');
await ev("__btn('Main').click()");
await wait(600);
await ev(`__set('input[aria-label="Slip number"]', ${JSON.stringify(slip.replace('SI-', '').replace(/^0+/, ''))})`);
await ev("__btnLike('Fetch').click()");
await wait(1200);
check('record fetched by the digits off the slip', await ev("__has('Imran Sheikh')"));
await park(20500);
await wait(600);
await ev("__btnLike('Capture weight').click()");
await wait(500);
check('net previewed before committing', await ev("__has('12,500 kg') && __has('12.500 ton') && __has('312.500 maund')"));
await ev("__btnLike('Complete weighing').click()");
await wait(1800);
check('weighing completed', await ev("__has('Weighing completed')"));
check('receipt 2 shown', await ev("__has('Receipt 2 — completed')"));

step(5, 'Sync to the cloud');
const synced = await waitFor(async () => (await api(AGENT, '/sync-status')).pending_count === 0, 'the outbox to drain');
check('outbox drained on its own', synced);
check('agent reports cloud connected', (await api(AGENT, '/sync-status')).online === true);

const { token } = await api(CLOUD, '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'manager', password: 'manager' }) });
const cloudRecord = await api(CLOUD, `/weighments/${slip}`, { headers: { authorization: `Bearer ${token}` } });
check('record is in the cloud', cloudRecord.weighment?.slip_number === slip);
check('net weight matches end to end', cloudRecord.weighment?.net_weight_kg === 12_500);

step(6, 'Manager dashboard');
await send('Page.navigate', { url: CLOUD + '/' });
await wait(2500);
await ev(HELPERS);
await ev("__set('#username', 'manager'); __set('#password', 'manager');");
await ev("__btn('Sign in').click()");
await wait(3500);
await ev(HELPERS);
await ev("__btn('All time')?.click()");
await wait(2500);
check('manager signed in', await ev("__has('Weighbridge — Manager')"));
check('the weighing appears on the dashboard', await ev(`__has(${JSON.stringify(slip)})`));
// Truck at the configured rate — the form's default vehicle type.
check('revenue counted', await ev("__has('Rs 300')"));
await send('Page.captureScreenshot', {}).then(async (s) => (await import('node:fs')).writeFileSync(process.env.SHOT_DASH, Buffer.from(s.result.data, 'base64')));

step(7, 'Receipt from the dashboard');
await ev("document.querySelector('tbody tr').click()");
await wait(1500);
check('receipt opens', await ev("__has('Weighbridge Slip')"));
const pdfFromDash = await ev(`(async () => { const a = document.querySelector('a[href*="/pdf"]'); const r = await fetch(a.getAttribute('href')); const b = await r.arrayBuffer(); return { ok: r.ok, head: new TextDecoder().decode(b.slice(0,5)), bytes: b.byteLength }; })()`);
check('PDF downloads from the dashboard', pdfFromDash.ok && pdfFromDash.head === '%PDF-', `${pdfFromDash.bytes} bytes`);

step(8, 'The QR code a driver scans');
const qrUrl = `${CLOUD}/r/${slip}`;
await send('Page.navigate', { url: qrUrl });
await wait(2000);
await ev(HELPERS);
check('public receipt page loads with no sign-in', await ev("__has('Weighbridge Slip')"));
check('branded for a customer', await ev("__has('Suarza International') && __has('12 Industrial Road')"));
check('shows the net in all three units', await ev("__has('12,500 kg') && __has('12.500 ton') && __has('312.500 maund')"));
const qrPdf = await ev(`(async () => { const r = await fetch('/r/${slip}/pdf'); const b = await r.arrayBuffer(); return { ok: r.ok, head: new TextDecoder().decode(b.slice(0,5)), bytes: b.byteLength, disp: r.headers.get('content-disposition') }; })()`);
check('Download PDF works', qrPdf.ok && qrPdf.head === '%PDF-', `${qrPdf.bytes} bytes`);
check('named after the slip', qrPdf.disp?.includes(`${slip}-receipt.pdf`) === true);
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await wait(1200);
await send('Page.captureScreenshot', {}).then(async (s) => (await import('node:fs')).writeFileSync(process.env.SHOT_QR, Buffer.from(s.result.data, 'base64')));
await send('Emulation.clearDeviceMetricsOverride');

step(9, 'Reprint and void, back in the operator app');
await send('Page.navigate', { url: AGENT + '/' });
await wait(2500);
await ev(HELPERS);
await ev("__btn('Main').click()");
await wait(500);
await ev(`__set('input[aria-label="Slip number"]', ${JSON.stringify(slip)})`);
await ev("__btnLike('Fetch').click()");
await wait(1200);
check('completed slip cannot be weighed again', await ev("__has('already completed')"));
await ev("__btnLike('Reprint receipt').click()");
await wait(1500);
check('reprint offered and recorded', await ev("__has('Reprint sent to the printer')"));
// Auto-print is off for this run (headless Chrome has no printer), so the
// tab is opened the way an operator would: by pressing Print.
await ev("__btn('Print')?.click()");
await wait(600);
const reprintTabs = await ev('window.__openedTabs');
check('Print opens the receipt in its own tab', reprintTabs.some((u) => /\/print\/SI-\d{6}\?variant=/.test(u)),
  reprintTabs.at(-1) ?? 'none');

const abandoned = (await api(AGENT, '/weighments', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ customer_name: 'Never Returned', customer_company: 'Abandoned Co', vehicle_type: 'dumper', vehicle_plate: 'ISB-9999', product: 'Gravel', first_weight_kg: 7000, amount_charged: 400 }) })).weighment;
await ev("__btnLike('Another slip').click()");
await wait(500);
await ev(`__set('input[aria-label="Slip number"]', ${JSON.stringify(abandoned.slip_number)})`);
await ev("__btnLike('Fetch').click()");
await wait(1200);
await ev("__btnLike('Void ticket').click()");
await wait(700);
await ev("__set('#void-reason', 'Truck never returned')");
await wait(300);
await ev("(() => { const d = document.querySelector('[role=dialog]'); [...d.querySelectorAll('button')].find(b => /void ticket/i.test(b.textContent) && !b.disabled).click(); })()");
await wait(1800);
check('abandoned ticket voided, record kept', await ev("__has('This ticket was voided')"));

step(10, 'Everything reconciles');
await waitFor(async () => (await api(AGENT, '/sync-status')).pending_count === 0, 'final sync');
const trail = await api(AGENT, `/weighments/${slip}/audit`);
const actions = trail.entries.map((e) => e.action);
check('audit trail complete', JSON.stringify(actions) === JSON.stringify(['CREATED', 'SECOND_WEIGHT', 'COMPLETED', 'REPRINTED']), actions.join(' → '));

const analytics = await api(CLOUD, '/analytics', { headers: { authorization: `Bearer ${token}` } });
// One completed truck at Rs 300. The abandoned dumper carried Rs 400 and is
// voided, so revenue must be 300 and never 700.
check('cloud revenue excludes the voided ticket', analytics.total_revenue === 300,
  `Rs ${analytics.total_revenue} — the voided ticket's Rs 400 is ${analytics.total_revenue === 700 ? 'WRONGLY INCLUDED' : 'excluded'}`);
check('cloud counts one completed weighing', analytics.completed_weighments === 1);

const voidedInCloud = await api(CLOUD, `/weighments/${abandoned.slip_number}`, { headers: { authorization: `Bearer ${token}` } });
check('voided record synced with its reason', voidedInCloud.weighment?.void_reason === 'Truck never returned');

console.log(`\n${'═'.repeat(58)}`);
console.log(failures === 0 ? '  END-TO-END RUN CLEAN — every flow passed' : `  ${failures} CHECK(S) FAILED`);
console.log('═'.repeat(58));
process.exit(failures === 0 ? 0 : 1);
