/**
 * The agent serves the Operator PWA (brief §4): one service on the weighbridge
 * PC owns the data, the scale and the UI.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { loadConfig } from '../src/config.js';
import { openDatabase, type Db } from '../src/db/connection.js';
import { WeighmentService } from '../src/services/weighment-service.js';
import { createWeightReader, type WeightReader } from '../src/indicator/index.js';
import { buildServer } from '../src/server.js';
import { resolveOperatorWebDir } from '../src/static.js';

let app: FastifyInstance;
let db: Db;
let reader: WeightReader;
let webDir: string;

beforeEach(async () => {
  webDir = mkdtempSync(join(tmpdir(), 'operator-web-'));
  writeFileSync(join(webDir, 'index.html'), '<!doctype html><title>Operator</title>');
  mkdirSync(join(webDir, 'assets'));
  writeFileSync(join(webDir, 'assets', 'app.js'), 'console.log("app")');

  const config = loadConfig({
    USE_SIMULATOR: 'true',
    DATABASE_PATH: ':memory:',
    LOG_LEVEL: 'fatal',
  } as NodeJS.ProcessEnv);

  db = openDatabase({ path: config.DATABASE_PATH });
  const service = new WeighmentService(db, { stationId: config.STATION_ID });
  reader = createWeightReader(config);
  await reader.start();

  app = await buildServer({ config, reader, service, operatorWebDir: webDir });
});

afterEach(async () => {
  await app.close();
  await reader.stop();
  db.close();
  rmSync(webDir, { recursive: true, force: true });
});

describe('serving the Operator PWA', () => {
  it('serves index.html at the root', async () => {
    const response = await app.inject({ url: '/' });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('<title>Operator</title>');
  });

  it('serves built assets', async () => {
    const response = await app.inject({ url: '/assets/app.js' });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('console.log');
  });

  it('falls back to the app shell for a client-side route', async () => {
    const response = await app.inject({ url: '/some/deep/link' });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('<title>Operator</title>');
  });

  it('does NOT swallow API routes with the SPA fallback', async () => {
    // A missing slip must stay a 404 with its error code, not silently become
    // an HTML page that the operator app would fail to parse.
    const response = await app.inject({ url: '/weighments/SI-999999' });
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('SLIP_NOT_FOUND');
  });

  it('keeps the live-weight route working alongside the static files', async () => {
    const response = await app.inject({ url: '/live-weight' });
    expect(response.statusCode).toBe(200);
    expect(response.json().simulated).toBe(true);
  });

  it('404s a non-GET request to an unknown route rather than returning HTML', async () => {
    const response = await app.inject({ method: 'POST', url: '/nope' });
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('NOT_FOUND');
  });
});

describe('resolveOperatorWebDir', () => {
  it('returns null when the given directory does not exist', () => {
    expect(resolveOperatorWebDir('/definitely/not/here')).toBeNull();
  });

  it('accepts an explicit directory that does exist', () => {
    expect(resolveOperatorWebDir(webDir)).toBe(webDir);
  });
});
