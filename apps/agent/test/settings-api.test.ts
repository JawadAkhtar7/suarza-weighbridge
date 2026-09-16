/** The settings HTTP surface. */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { loadConfig } from '../src/config.js';
import { openDatabase, type Db } from '../src/db/connection.js';
import { WeighmentService } from '../src/services/weighment-service.js';
import { SettingsService } from '../src/services/settings-service.js';
import { createWeightReader, type WeightReader } from '../src/indicator/index.js';
import { buildServer } from '../src/server.js';

let app: FastifyInstance;
let db: Db;
let reader: WeightReader;

beforeEach(async () => {
  const config = loadConfig({
    USE_SIMULATOR: 'true',
    DATABASE_PATH: ':memory:',
    LOG_LEVEL: 'fatal',
  } as NodeJS.ProcessEnv);

  db = openDatabase({ path: config.DATABASE_PATH });
  reader = createWeightReader(config);
  await reader.start();

  app = await buildServer({
    config,
    reader,
    service: new WeighmentService(db, { stationId: 'A' }),
    settings: new SettingsService(db),
    serveOperatorWeb: false,
  });
});

afterEach(async () => {
  await app.close();
  await reader.stop();
  db.close();
});

describe('GET /settings', () => {
  it('returns the current settings', async () => {
    const response = await app.inject({ url: '/settings' });
    expect(response.statusCode).toBe(200);
    expect(response.json().print.paper_size).toBe('A5');
  });
});

describe('PUT /settings', () => {
  it('saves and returns the new settings', async () => {
    const current = (await app.inject({ url: '/settings' })).json();
    const response = await app.inject({
      method: 'PUT',
      url: '/settings',
      payload: {
        ...current,
        company_phone: '+92 300 2222222',
        pricing: { truck: 450 },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().company_phone).toBe('+92 300 2222222');
    expect((await app.inject({ url: '/settings' })).json().pricing.truck).toBe(450);
  });

  it('rejects invalid settings and names the field', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: '/settings',
      payload: { print: { paper_size: 'FOOLSCAP' } },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('leaves the stored settings alone when a save is rejected', async () => {
    await app.inject({
      method: 'PUT',
      url: '/settings',
      payload: { print: { paper_size: 'FOOLSCAP' } },
    });
    expect((await app.inject({ url: '/settings' })).json().print.paper_size).toBe('A5');
  });
});
