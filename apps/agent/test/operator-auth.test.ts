/**
 * Starting a shift at the bridge.
 *
 * The point of these is the offline promise: the accounts are a copy pulled
 * from the manager, and signing in must work against that copy with nothing
 * reachable. So nothing here talks to a cloud — the accounts are put in the
 * way the sync puts them in, and the routes are driven against them.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import bcrypt from 'bcryptjs';
import type { FastifyInstance } from 'fastify';
import { loadConfig } from '../src/config.js';
import { openDatabase, type Db } from '../src/db/connection.js';
import { OperatorRepository } from '../src/db/operators.js';
import { WeighmentService } from '../src/services/weighment-service.js';
import { createWeightReader, type WeightReader } from '../src/indicator/index.js';
import { buildServer } from '../src/server.js';

let app: FastifyInstance;
let db: Db;
let reader: WeightReader;
let operators: OperatorRepository;

/** As the cloud sends them: a bcrypt hash and nothing that can make one. */
const account = (overrides: Record<string, unknown> = {}) => ({
  username: 'imran',
  name: 'Imran Shah',
  slot: 'MORNING' as const,
  password_hash: bcrypt.hashSync('morning-pass', 8),
  updated_at: '2026-10-16T03:00:00.000Z',
  ...overrides,
});

beforeEach(async () => {
  const config = loadConfig({
    USE_SIMULATOR: 'true',
    DATABASE_PATH: ':memory:',
    STATION_ID: 'A',
    LOG_LEVEL: 'fatal',
    NODE_ENV: 'test',
  } as NodeJS.ProcessEnv);

  db = openDatabase({ path: config.DATABASE_PATH });
  operators = new OperatorRepository(db);
  const service = new WeighmentService(db, { stationId: config.STATION_ID });
  reader = createWeightReader(config);
  await reader.start();

  app = await buildServer({ config, reader, service, operators, serveOperatorWeb: false });
});

afterEach(async () => {
  await app.close();
  await reader.stop();
  db.close();
});

const login = (username: string, password: string) =>
  app.inject({ method: 'POST', url: '/operator/auth/login', payload: { username, password } });

describe('starting a shift', () => {
  it('asks for nobody on a bridge that has no accounts yet', async () => {
    /*
     * A new install, or a bridge whose cloud is not configured. Locking the
     * yard out of weighing until a manager can be telephoned would be a
     * worse failure than no sign-in at all.
     */
    const response = await app.inject({ method: 'GET', url: '/operator/auth' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ required: false, session: null });
  });

  it('signs in against the copy the manager sent, with no cloud in sight', async () => {
    operators.applySync([account()]);

    const response = await login('imran', 'morning-pass');

    expect(response.statusCode).toBe(200);
    const { session } = response.json() as { session: Record<string, unknown> };
    expect(session.username).toBe('imran');
    expect(session.name).toBe('Imran Shah');
    expect(session.slot).toBe('MORNING');
    expect(session.shift).toBe('MORNING');
    expect(session.token).toEqual(expect.any(String));
  });

  it('refuses the wrong password, and says the same thing for an unknown name', async () => {
    operators.applySync([account()]);

    const wrong = await login('imran', 'not-the-password');
    const unknown = await login('nobody', 'morning-pass');

    expect(wrong.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    expect(unknown.json()).toEqual(wrong.json());
  });

  it('keeps the shift across a reload, and recognises its own token', async () => {
    operators.applySync([account()]);
    const { session } = (await login('imran', 'morning-pass')).json() as {
      session: { token: string };
    };

    const response = await app.inject({
      method: 'GET',
      url: '/operator/auth',
      headers: { authorization: `Bearer ${session.token}` },
    });

    expect(response.json()).toMatchObject({ required: true, session: { username: 'imran' } });
  });

  it('gives the administrator no shift, because they work none', async () => {
    operators.applySync([
      account({
        username: 'boss',
        name: 'Mr Khan',
        slot: 'ADMIN',
        password_hash: bcrypt.hashSync('admin-pass', 8),
      }),
    ]);

    const { session } = (await login('boss', 'admin-pass')).json() as {
      session: { slot: string; shift: string | null };
    };

    expect(session.slot).toBe('ADMIN');
    expect(session.shift).toBeNull();
  });
});

describe('ending a shift', () => {
  it('ends it, and the token stops meaning anything', async () => {
    operators.applySync([account()]);
    const { session } = (await login('imran', 'morning-pass')).json() as {
      session: { token: string };
    };

    const ended = await app.inject({
      method: 'POST',
      url: '/operator/auth/logout',
      headers: { authorization: `Bearer ${session.token}` },
    });
    expect(ended.json()).toEqual({ ended: true });

    const after = await app.inject({
      method: 'GET',
      url: '/operator/auth',
      headers: { authorization: `Bearer ${session.token}` },
    });
    expect((after.json() as { session: unknown }).session).toBeNull();
  });

  it('answers "signed out" to a token it has never heard of', async () => {
    operators.applySync([account()]);

    const response = await app.inject({
      method: 'POST',
      url: '/operator/auth/logout',
      headers: { authorization: 'Bearer not-a-token' },
    });

    // True, and what the screen needs to act on: there is no shift to end.
    expect(response.json()).toEqual({ ended: false });
  });
});

describe('the shift log waiting to go up', () => {
  it('records the start and the end, with how long it lasted', async () => {
    operators.applySync([account()]);
    const { session } = (await login('imran', 'morning-pass')).json() as {
      session: { token: string };
    };
    await app.inject({
      method: 'POST',
      url: '/operator/auth/logout',
      headers: { authorization: `Bearer ${session.token}` },
    });

    const entries = operators.unsyncedLogs();
    expect(entries.map((entry) => entry.kind)).toEqual(['SHIFT_START', 'SHIFT_END']);
    expect(entries[1]?.detail).toMatch(/^Shift lasted /);
  });

  it('stops offering an entry once the cloud has taken it', async () => {
    operators.applySync([account()]);
    await login('imran', 'morning-pass');

    const [entry] = operators.unsyncedLogs();
    operators.markLogsSynced([entry!.id]);

    expect(operators.unsyncedLogs()).toEqual([]);
  });
});

describe('the copy of the accounts', () => {
  it('is replaced wholesale, so an account the manager deleted stops working', async () => {
    /*
     * A merge would leave a removed account signing in for ever on the one
     * machine where it matters. The list IS the manager's.
     */
    operators.applySync([account(), account({ username: 'bilal', slot: 'NIGHT' })]);
    operators.applySync([account()]);

    expect(operators.count()).toBe(1);
    expect(operators.find('bilal')).toBeUndefined();
  });

  it('ends the shift of somebody the manager has removed', async () => {
    operators.applySync([account()]);
    const { session } = (await login('imran', 'morning-pass')).json() as {
      session: { token: string };
    };

    operators.applySync([account({ username: 'bilal', slot: 'NIGHT' })]);

    expect(operators.session(session.token)).toBeUndefined();
  });
});
