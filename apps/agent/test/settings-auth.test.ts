/**
 * Who may change this station's settings, and who may not.
 *
 * The protection is worth testing from the HTTP edge rather than against the
 * repository, because what actually guards the settings is a header being
 * read on one route and deliberately not required on another. A unit test of
 * the hashing would pass just as happily with the check never wired up.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { DEFAULT_SIDE_VIEW_FRAME } from '@suarza/shared';
import { loadConfig } from '../src/config.js';
import { openDatabase, type Db } from '../src/db/connection.js';
import { WeighmentService } from '../src/services/weighment-service.js';
import { SettingsService } from '../src/services/settings-service.js';
import { UserRepository } from '../src/db/users.js';
import { createWeightReader, type WeightReader } from '../src/indicator/index.js';
import { buildServer } from '../src/server.js';

const LOGIN = { username: 'suarza', password: 'pakistan1!' };

const basic = (username: string, password: string) =>
  `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;

let app: FastifyInstance;
let db: Db;
let reader: WeightReader;
let users: UserRepository;

beforeEach(async () => {
  const config = loadConfig({
    USE_SIMULATOR: 'true',
    DATABASE_PATH: ':memory:',
    LOG_LEVEL: 'fatal',
  } as NodeJS.ProcessEnv);

  db = openDatabase({ path: config.DATABASE_PATH });
  reader = createWeightReader(config);
  await reader.start();

  users = new UserRepository(db);
  users.seed(LOGIN.username, LOGIN.password);

  app = await buildServer({
    config,
    reader,
    service: new WeighmentService(db, { stationId: 'A' }),
    settings: new SettingsService(db),
    users,
    serveOperatorWeb: false,
  });
});

afterEach(async () => {
  await app.close();
  await reader.stop();
  db.close();
});

/** A whole settings body, as the operator app sends it. */
async function settingsBody(changes: Record<string, unknown> = {}) {
  const current = (await app.inject({ url: '/settings' })).json();
  return { ...current, ...changes };
}

describe('saving the settings', () => {
  it('refuses without a login, and changes nothing', async () => {
    const before = (await app.inject({ url: '/settings' })).json();

    const response = await app.inject({
      method: 'PUT',
      url: '/settings',
      payload: await settingsBody({ auto_print: false }),
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('INVALID_CREDENTIALS');
    // The refusal has to be a refusal, not a message over a save that happened.
    expect((await app.inject({ url: '/settings' })).json()).toEqual(before);
  });

  it('refuses a wrong password', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: '/settings',
      headers: { authorization: basic(LOGIN.username, 'pakistan1') },
      payload: await settingsBody({ auto_print: false }),
    });

    expect(response.statusCode).toBe(401);
    expect((await app.inject({ url: '/settings' })).json().auto_print).toBe(true);
  });

  it('refuses a username nobody has', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: '/settings',
      headers: { authorization: basic('admin', LOGIN.password) },
      payload: await settingsBody({ auto_print: false }),
    });

    expect(response.statusCode).toBe(401);
  });

  it('refuses a header that is not Basic at all', async () => {
    // A bearer token from somewhere else must not be read as a username.
    const response = await app.inject({
      method: 'PUT',
      url: '/settings',
      headers: { authorization: 'Bearer pakistan1!' },
      payload: await settingsBody({ auto_print: false }),
    });

    expect(response.statusCode).toBe(401);
  });

  it('saves with the station login', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: '/settings',
      headers: { authorization: basic(LOGIN.username, LOGIN.password) },
      payload: await settingsBody({ auto_print: false }),
    });

    expect(response.statusCode).toBe(200);
    expect((await app.inject({ url: '/settings' })).json().auto_print).toBe(false);
  });

  it('takes the username however it was typed', async () => {
    // Nobody types their own name the same way twice, and a password that
    // works in the morning and not in the afternoon reads as a broken system.
    const response = await app.inject({
      method: 'PUT',
      url: '/settings',
      headers: { authorization: basic('  SuarZa ', LOGIN.password) },
      payload: await settingsBody({ auto_print: false }),
    });

    expect(response.statusCode).toBe(200);
  });

  it('reading the settings needs no login', async () => {
    // What is protected is the change. The operator has every reason to look
    // at an alignment or a rate without being asked for a password.
    expect((await app.inject({ url: '/settings' })).statusCode).toBe(200);
  });
});

describe('reframing a camera', () => {
  const frame = { zoom: 2, x: 0.1, y: -0.05 };

  it('needs no login — the operator does it with a truck on the bridge', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: '/settings/framing',
      payload: { front_view_frame: frame },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().front_view_frame).toEqual(frame);
  });

  it('cannot be used to change anything else', async () => {
    /*
     * The whole reason this route may be open. If it took a settings object
     * it would be the full PUT without the password — and the password would
     * be beside a door with no lock on it.
     */
    const response = await app.inject({
      method: 'PUT',
      url: '/settings/framing',
      payload: { front_view_frame: frame, auto_print: false, pricing: { TRUCK: 9999 } },
    });

    expect(response.statusCode).toBe(400);
    expect((await app.inject({ url: '/settings' })).json().auto_print).toBe(true);
  });

  it('leaves the other view, and everything else, alone', async () => {
    await app.inject({
      method: 'PUT',
      url: '/settings',
      headers: { authorization: basic(LOGIN.username, LOGIN.password) },
      payload: await settingsBody({ receipt_base_url: 'https://example.test' }),
    });

    await app.inject({
      method: 'PUT',
      url: '/settings/framing',
      payload: { front_view_frame: frame },
    });

    const saved = (await app.inject({ url: '/settings' })).json();
    expect(saved.front_view_frame).toEqual(frame);
    expect(saved.side_view_frame).toEqual(DEFAULT_SIDE_VIEW_FRAME);
    expect(saved.receipt_base_url).toBe('https://example.test');
  });

  it('refuses a body that reframes nothing', async () => {
    const response = await app.inject({ method: 'PUT', url: '/settings/framing', payload: {} });
    expect(response.statusCode).toBe(400);
  });
});
