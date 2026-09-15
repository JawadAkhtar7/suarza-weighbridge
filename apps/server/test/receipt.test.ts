/**
 * M5 acceptance, third part: `/r/:slip` shows the receipt and the button
 * downloads a correct PDF built on the fly, with nothing persisted server-side.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import request from 'supertest';
import type { Express } from 'express';
import {
  clearDatabase,
  completedWeighment,
  startDatabase,
  stopDatabase,
  testApp,
  weighment,
} from './helpers.js';
import { ingest } from '../src/services/ingest.service.js';

let app: Express;

beforeAll(async () => {
  await startDatabase();
  app = testApp();
});
afterAll(stopDatabase);
afterEach(clearDatabase);

const store = (record: Parameters<typeof ingest>[0][number]) => ingest([record], []);

describe('GET /r/:slip — the page a driver scans', () => {
  it('renders the receipt for a completed weighment', async () => {
    await store(completedWeighment({ slip_number: 'SI-000123', customer_name: 'Ali Raza' }));

    const response = await request(app).get('/r/SI-000123');

    expect(response.status).toBe(200);
    expect(response.type).toBe('text/html');
    expect(response.text).toContain('SI-000123');
    expect(response.text).toContain('Ali Raza');
    // The slip number is labelled, not floating loose: the client's design has
    // no title banner, so this label is what identifies the number on the page.
    expect(response.text).toContain('Slip No.');
  });

  it('shows the branded soft form, header and footer included', async () => {
    // Opposite of the printed slip: here there is no pre-printed pad, so the
    // page must carry the branding itself (brief §8).
    await store(completedWeighment({ slip_number: 'SI-000123' }));
    const { text } = await request(app).get('/r/SI-000123');

    expect(text).toContain('Suarza International');
    expect(text).toContain('12 Industrial Road, Lahore');
    expect(text).toContain('valid without a signature');
  });

  it('shows the net weight in kg, ton and maund', async () => {
    await store(completedWeighment({ slip_number: 'SI-000123', net_weight_kg: 12_000 }));
    const { text } = await request(app).get('/r/SI-000123');

    expect(text).toContain('12,000 kg');
    expect(text).toContain('12.000 ton');
    // Maunds are shown as a trader reads them — `300 Mann`, not `300.000` —
    // with the figure and its unit in one line of markup.
    expect(text).toMatch(/300 <span[^>]*>Mann<\/span>/);
  });

  it('offers the PDF download', async () => {
    await store(completedWeighment({ slip_number: 'SI-000123' }));
    const { text } = await request(app).get('/r/SI-000123');

    expect(text).toContain('/r/SI-000123/pdf');
    expect(text).toContain('Download PDF');
  });

  it('ships its stylesheet inline, because a phone may be on a bad connection', async () => {
    await store(completedWeighment({ slip_number: 'SI-000123' }));
    const { text } = await request(app).get('/r/SI-000123');
    expect(text).toMatch(/<style>[\s\S]+<\/style>/);
    // No external stylesheet: a blocked or slow CDN would leave the driver
    // looking at unstyled markup.
    expect(text).not.toMatch(/<link[^>]+rel="stylesheet"/);
  });

  it('loads its only script from this origin, so the CSP cannot break the buttons', async () => {
    await store(completedWeighment({ slip_number: 'SI-000123' }));
    const { text } = await request(app).get('/r/SI-000123');

    // Print and Download need a script, and the server sets script-src 'self'.
    // Inlining it would need a nonce or 'unsafe-inline'; a same-origin file
    // needs neither. Any OTHER script source would be silently blocked.
    const sources = [...text.matchAll(/<script[^>]*src="([^"]+)"/g)].map((m) => m[1]);
    expect(sources).toEqual(['/r/receipt-page.js']);
    expect(text).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?\S[\s\S]*?<\/script>/);
  });

  it('accepts the slip in the shorthand an operator might type', async () => {
    await store(completedWeighment({ slip_number: 'SI-000123' }));
    expect((await request(app).get('/r/si-000123')).status).toBe(200);
    expect((await request(app).get('/r/123')).status).toBe(200);
  });

  it('renders an open ticket without inventing a net weight', async () => {
    await store(weighment({ slip_number: 'SI-000200' }));
    const { text } = await request(app).get('/r/SI-000200');

    expect(text).toContain('Pending second weighing');
    // The net card keeps its heading but must carry no figure: a net weight on
    // a half-finished ticket is a number someone could act on.
    expect(text).not.toMatch(/<span[^>]*>Mann<\/span>/);
  });

  it('is never cached, so a corrected record is never shown stale', async () => {
    await store(completedWeighment({ slip_number: 'SI-000123' }));
    const response = await request(app).get('/r/SI-000123');
    expect(response.headers['cache-control']).toContain('no-store');
  });

  it('asks search engines not to index a customer receipt', async () => {
    await store(completedWeighment({ slip_number: 'SI-000123' }));
    expect((await request(app).get('/r/SI-000123')).text).toContain('noindex');
  });
});

describe('GET /r/:slip — not synced yet', () => {
  it('explains itself rather than showing a bare 404', async () => {
    // The QR is printed the instant the weighing happens; if the PC is offline
    // the record arrives once sync catches up (brief §8 caveat).
    const response = await request(app).get('/r/SI-999999');

    expect(response.status).toBe(404);
    expect(response.type).toBe('text/html');
    expect(response.text).toContain('Receipt not available yet');
    expect(response.text).toContain('SI-999999');
    expect(response.text).toMatch(/try again shortly/i);
  });

  it('does the same for the PDF route', async () => {
    const response = await request(app).get('/r/SI-999999/pdf');
    expect(response.status).toBe(404);
    expect(response.text).toContain('Receipt not available yet');
  });

  it('does not leak whether other slips exist', async () => {
    await store(completedWeighment({ slip_number: 'SI-000123' }));
    const { text } = await request(app).get('/r/SI-999999');
    expect(text).not.toContain('SI-000123');
  });
});

describe('GET /r/:slip/pdf — built in memory, on the fly', () => {
  it('streams a real PDF', async () => {
    await store(completedWeighment({ slip_number: 'SI-000123' }));

    const response = await request(app)
      .get('/r/SI-000123/pdf')
      .buffer()
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('application/pdf');
    // Every PDF starts with %PDF- and ends with %%EOF.
    const body = response.body as Buffer;
    expect(body.subarray(0, 5).toString()).toBe('%PDF-');
    expect(body.subarray(-1024).toString()).toContain('%%EOF');
    expect(body.byteLength).toBeGreaterThan(1000);
  });

  it('offers it as a download named after the slip', async () => {
    await store(completedWeighment({ slip_number: 'SI-000123' }));
    const response = await request(app).get('/r/SI-000123/pdf');
    expect(response.headers['content-disposition']).toContain('attachment');
    expect(response.headers['content-disposition']).toContain('SI-000123-receipt.pdf');
  });

  it('writes nothing to disk — every download is rebuilt from the record', async () => {
    // Brief §15: no file storage, by design. There is no bucket and no
    // generated-files directory to grow, back up, or leak.
    const serverRoot = resolve(import.meta.dirname, '..');
    const before = readdirSync(serverRoot);

    await store(completedWeighment({ slip_number: 'SI-000123' }));
    await request(app).get('/r/SI-000123/pdf');
    await request(app).get('/r/SI-000123/pdf');

    expect(readdirSync(serverRoot)).toEqual(before);
  });

  it('produces a byte-identical PDF for the same record', async () => {
    // Regenerating from data must be deterministic, or "rebuilt each visit"
    // would mean the customer's second download differs from their first.
    await store(completedWeighment({ slip_number: 'SI-000123' }));

    const fetchPdf = () =>
      request(app)
        .get('/r/SI-000123/pdf')
        .buffer()
        .parse((res, cb) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => cb(null, Buffer.concat(chunks)));
        });

    const [first, second] = await Promise.all([fetchPdf(), fetchPdf()]);
    expect((first.body as Buffer).byteLength).toBe((second.body as Buffer).byteLength);
  });

  it('builds a PDF for an open ticket too', async () => {
    await store(weighment({ slip_number: 'SI-000200' }));
    const response = await request(app).get('/r/SI-000200/pdf');
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('application/pdf');
  });
});

describe('the QR routes are public by design', () => {
  it('needs no token — the audience is a driver with a paper slip', async () => {
    await store(completedWeighment({ slip_number: 'SI-000123' }));
    expect((await request(app).get('/r/SI-000123')).status).toBe(200);
    expect((await request(app).get('/r/SI-000123/pdf')).status).toBe(200);
  });

  it('exposes no way to list or search records', async () => {
    await store(completedWeighment({ slip_number: 'SI-000123' }));
    // Without a slip number there is nothing to see; /weighments needs auth.
    expect((await request(app).get('/r/')).status).toBe(404);
    expect((await request(app).get('/weighments')).status).toBe(401);
  });
});
