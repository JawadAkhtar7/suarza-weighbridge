/**
 * M5 acceptance, third part: `/r/:slip` shows the slip
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
import { paperForStation } from '../src/services/station.service.js';
import { COMPANY } from '@suarza/shared';

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
    paper_size: 'A4' as const,
    updated_at: '2026-09-15T10:00:00.000Z',
  };

  it("is Suarza's, from code, whatever the station ever reported", async () => {
    /*
     * The details used to be a per-station setting that rode up with every sync
     * batch, so the slip in a customer's hand and the page behind its own QR
     * code could disagree about the company's phone number. They are now one
     * constant, read at both ends, and there is nothing left to disagree about.
     */
    await ingest([completedWeighment({ slip_number: '2026123' })], [], profile);

    const { text } = await request(app).get('/r/2026123');

    /* Outlined in the artwork now, not text, so the page carries the vector
       rather than the words. See the slip's TEMPLATE item. */
    expect(text).toContain('Suarza International weight bridge slip');
    expect(text).toContain('data:image/svg+xml;base64,');
    expect(text).not.toContain(COMPANY.phone);
  });

  it('shows them for a station that has never synced anything', async () => {
    await store(completedWeighment({ slip_number: '2026123' }));
    expect((await request(app).get('/r/2026123')).text).toContain(
      'Suarza International weight bridge slip',
    );
  });

  it('uses the paper the station prints on', async () => {
    // The fixture says A4 deliberately: A5 is the default, so a station that
    // reported something else is the only way to prove its choice travels.
    await ingest([completedWeighment({ slip_number: '2026123' })], [], profile);
    expect(await paperForStation('A')).toBe('A4');
    expect(await paperForStation('never-synced')).toBe('A5');
  });
});

describe('GET /r/:slip — what a scanned QR leads to', () => {
  it('serves the slip itself, as a page', async () => {
    // It used to redirect to a generated PDF. That PDF was drawn a second time
    // by hand and could not render Urdu at all, so it could never match the
    // paper slip. This page IS the slip: same component, same coordinates.
    await store(completedWeighment({ slip_number: '2026123' }));

    const response = await request(app).get('/r/2026123');

    expect(response.status).toBe(200);
    expect(response.type).toBe('text/html');
    expect(response.text).toContain('2026123');
    expect(response.text).toContain('WEIGHT BRIDGE SLIP');
  });

  it('carries the Urdu the design is built on', async () => {
    // The thing the old PDF silently dropped. If this ever regresses, half the
    // labels on the client's slip vanish.
    await store(completedWeighment({ slip_number: '2026123' }));
    const { text } = await request(app).get('/r/2026123');

    for (const label of ['سلپ نمبر', 'پہلاوزن', 'دوسراوزن', 'صافی وزن']) {
      expect(text, label).toContain(label);
    }
  });

  it('fetches nothing from anywhere — artwork and fonts travel with it', async () => {
    // This is what lets the page run under a policy that permits no scripts and
    // no network, and what lets the weighbridge PC print with the line down.
    await store(completedWeighment({ slip_number: '2026123' }));
    const { text } = await request(app).get('/r/2026123');

    const external = text.match(/(?:src|href)="(?!data:)[^"]*"/g) ?? [];
    expect(external).toEqual([]);
  });

  it('never lets a phone cache it', async () => {
    // A slip corrected in the cloud must not keep being served from a copy the
    // phone remembered.
    await store(completedWeighment({ slip_number: '2026123' }));
    const response = await request(app).get('/r/2026123');
    expect(response.headers['cache-control']).toContain('no-store');
  });

  it('accepts the slip in the shorthand an operator might type', async () => {
    await store(completedWeighment({ slip_number: '2026123' }));
    for (const typed of ['si-000123', '123']) {
      const response = await request(app).get(`/r/${typed}`);
      expect(response.status, typed).toBe(200);
      expect(response.text, typed).toContain('2026123');
    }
  });

  it('shows an open ticket with the second weight simply absent', async () => {
    // A first-weight slip carries a QR as well. The boxes for the second
    // weighing stay empty rather than being filled with a dash or a zero —
    // the slip is printed onto a pad where an invented figure cannot be undone.
    await store(weighment({ slip_number: '2026200' }));

    const response = await request(app).get('/r/2026200');

    expect(response.status).toBe(200);
    expect(response.text).toContain('2026200');
    expect(response.text).not.toContain('(MANUAL)');
  });

  it('asks search engines not to index it', async () => {
    await store(completedWeighment({ slip_number: '2026123' }));
    expect((await request(app).get('/r/2026123')).text).toContain('noindex');
    expect((await request(app).get('/r/2026999999')).text).toContain('noindex');
  });
});

describe('GET /r/:slip — not synced yet', () => {
  it('explains itself rather than showing a bare 404', async () => {
    // The QR is printed the instant the weighing happens; if the PC is offline
    // the record arrives once sync catches up (brief §8 caveat).
    const response = await request(app).get('/r/2026999999');

    expect(response.status).toBe(404);
    expect(response.type).toBe('text/html');
    expect(response.text).toContain('Receipt not available yet');
    expect(response.text).toContain('2026999999');
    expect(response.text).toMatch(/try again shortly/i);
  });

  it('does not leak whether other slips exist', async () => {
    await store(completedWeighment({ slip_number: '2026123' }));
    const { text } = await request(app).get('/r/2026999999');
    expect(text).not.toContain('2026123');
  });
});

describe('GET /r/:slip/pdf — the address old slips were sent to', () => {
  it('still leads somewhere useful', async () => {
    // Every slip printed before the change carries a QR that was served as a
    // redirect to this path. A phone that cached it must not land on a 404.
    await store(completedWeighment({ slip_number: '2026123' }));

    const response = await request(app).get('/r/2026123/pdf');

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('/r/2026123');
  });

  it('redirects without a database lookup, so a missing slip still arrives', async () => {
    // The page it lands on gives the real answer, including "not synced yet".
    const response = await request(app).get('/r/2026999999/pdf');
    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('/r/2026999999');
  });
});

describe('the slip page writes nothing to disk', () => {
  it('rebuilds from the record on every visit', async () => {
    // Brief §15: no file storage, by design. There is no bucket and no
    // generated-files directory to grow, back up, or leak.
    const serverRoot = resolve(import.meta.dirname, '..');
    const before = readdirSync(serverRoot);

    await store(completedWeighment({ slip_number: '2026123' }));
    await request(app).get('/r/2026123');
    await request(app).get('/r/2026123');

    expect(readdirSync(serverRoot)).toEqual(before);
  });

  it('gives the same bytes for the same record', async () => {
    // Regenerating from data must be deterministic, or a customer's second look
    // at their slip would differ from their first.
    await store(completedWeighment({ slip_number: '2026123' }));

    const [first, second] = await Promise.all([
      request(app).get('/r/2026123'),
      request(app).get('/r/2026123'),
    ]);
    // The print timestamp is the one thing that moves, so compare everything up
    // to it rather than the whole document.
    const withoutPrintTime = (text: string) => text.replace(/\d\d-\d\d-\d{4}\s+\|\s+[\d:]+\s[AP]M/g, '');
    expect(withoutPrintTime(first.text)).toBe(withoutPrintTime(second.text));
  });
});

describe('the QR routes are public by design', () => {
  it('needs no token — the audience is a driver with a paper slip', async () => {
    await store(completedWeighment({ slip_number: '2026123' }));
    // The scan serves the slip rather than 401ing.
    expect((await request(app).get('/r/2026123')).status).toBe(200);
  });

  it('exposes no way to list or search records', async () => {
    await store(completedWeighment({ slip_number: '2026123' }));
    // Without a slip number there is nothing to see; /weighments needs auth.
    expect((await request(app).get('/r/')).status).toBe(404);
    expect((await request(app).get('/weighments')).status).toBe(401);
  });
});
