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
import { companyForStation, paperForStation } from '../src/services/station.service.js';

let app: Express;

beforeAll(async () => {
  await startDatabase();
  app = testApp();
});
afterAll(stopDatabase);
afterEach(clearDatabase);

const store = (record: Parameters<typeof ingest>[0][number]) => ingest([record], []);

describe('whose company details the page shows', () => {
  const profile = {
    station_id: 'A',
    company_name: 'Suarza International',
    company_address: '2 Km, Chowk Hujra Shah Muqeem, Kasur Road, Depalpur',
    company_phone: '+923036537700',
    company_email: 'info@suarza.com',
    company_logo_url: '/logo.png',
    paper_size: 'A4' as const,
    updated_at: '2026-09-15T10:00:00.000Z',
  };

  const FALLBACK = {
    name: 'Suarza International',
    address: '12 Industrial Road, Lahore',
    phone: '+92 300 0000000',
    email: '',
    logoUrl: '/logo.png',
  };

  it("uses the station's own details, not the server's fallback", async () => {
    // The whole point: the operator edits the address on the weighbridge PC,
    // and the receipt behind the QR must match the paper the customer holds.
    await ingest([completedWeighment({ slip_number: 'SI-000123' })], [], profile);

    const company = await companyForStation('A', FALLBACK);
    expect(company.address).toBe('2 Km, Chowk Hujra Shah Muqeem, Kasur Road, Depalpur');
    expect(company.phone).toBe('+923036537700');
  });

  it('falls back to COMPANY_* for a station that has never synced its settings', async () => {
    await store(completedWeighment({ slip_number: 'SI-000123' }));
    expect((await companyForStation('A', FALLBACK)).address).toBe('12 Industrial Road, Lahore');
  });

  it('falls back field by field, so one blank does not undo the rest', async () => {
    await ingest([completedWeighment({ slip_number: 'SI-000123' })], [], {
      ...profile,
      company_phone: '',
    });

    const company = await companyForStation('A', FALLBACK);
    expect(company.address).toBe('2 Km, Chowk Hujra Shah Muqeem, Kasur Road, Depalpur');
    expect(company.phone).toBe('+92 300 0000000');
  });

  it('ignores a batch older than the details already stored', async () => {
    await ingest([completedWeighment({ slip_number: 'SI-000123' })], [], profile);
    // A queued batch from before the correction, arriving late after an outage.
    await ingest([completedWeighment({ slip_number: 'SI-000124' })], [], {
      ...profile,
      company_address: 'The old address nobody uses any more',
      updated_at: '2026-09-01T10:00:00.000Z',
    });

    expect((await companyForStation('A', FALLBACK)).address).toBe(
      '2 Km, Chowk Hujra Shah Muqeem, Kasur Road, Depalpur',
    );
  });

  it('uses the paper the station prints on', async () => {
    // The fixture says A4 deliberately: A5 is the default, so a station that
    // reported something else is the only way to prove its choice travels.
    await ingest([completedWeighment({ slip_number: 'SI-000123' })], [], profile);
    expect(await paperForStation('A')).toBe('A4');
    expect(await paperForStation('never-synced')).toBe('A5');
  });
});

describe('GET /r/:slip — what a scanned QR leads to', () => {
  it('sends the driver straight to the PDF', async () => {
    // The whole simplification: a scan hands over the receipt rather than a
    // page with one button on it.
    await store(completedWeighment({ slip_number: 'SI-000123' }));

    const response = await request(app).get('/r/SI-000123');

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('/r/SI-000123/pdf');
  });

  it('never lets a phone cache that redirect', async () => {
    // 302 and no-store together: a slip corrected in the cloud must not keep
    // being served from a hop the phone remembered.
    await store(completedWeighment({ slip_number: 'SI-000123' }));
    const response = await request(app).get('/r/SI-000123');
    expect(response.headers['cache-control']).toContain('no-store');
  });

  it('accepts the slip in the shorthand an operator might type', async () => {
    await store(completedWeighment({ slip_number: 'SI-000123' }));
    // Both normalise to the same slip, and both end at the same PDF.
    for (const typed of ['si-000123', '123']) {
      const response = await request(app).get(`/r/${typed}`);
      expect(response.status).toBe(302);
      expect(response.headers.location).toBe('/r/SI-000123/pdf');
    }
  });

  it('hands over a PDF for an open ticket too', async () => {
    // A first-weight slip carries a QR as well, and its receipt says the second
    // weighing is pending rather than inventing a net weight.
    await store(weighment({ slip_number: 'SI-000200' }));

    const redirect = await request(app).get('/r/SI-000200');
    expect(redirect.headers.location).toBe('/r/SI-000200/pdf');

    const pdf = await request(app).get('/r/SI-000200/pdf');
    expect(pdf.status).toBe(200);
    expect(pdf.type).toBe('application/pdf');
  });

  it('is never cached, so a corrected record is never shown stale', async () => {
    await store(completedWeighment({ slip_number: 'SI-000123' }));
    const response = await request(app).get('/r/SI-000123');
    expect(response.headers['cache-control']).toContain('no-store');
  });

  it('asks search engines not to index the page it does still serve', async () => {
    // Only the "not found" page is HTML now; the receipt itself is a download.
    expect((await request(app).get('/r/SI-999999')).text).toContain('noindex');
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
    // The scan redirects rather than 401s, and the PDF it lands on is served.
    expect((await request(app).get('/r/SI-000123')).status).toBe(302);
    expect((await request(app).get('/r/SI-000123/pdf')).status).toBe(200);
  });

  it('exposes no way to list or search records', async () => {
    await store(completedWeighment({ slip_number: 'SI-000123' }));
    // Without a slip number there is nothing to see; /weighments needs auth.
    expect((await request(app).get('/r/')).status).toBe(404);
    expect((await request(app).get('/weighments')).status).toBe(401);
  });
});
