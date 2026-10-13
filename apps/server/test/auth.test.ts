/** Manager auth and role gating (brief §10, §12). */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import jwt from 'jsonwebtoken';
import {
  clearDatabase,
  createUser,
  startDatabase,
  stopDatabase,
  testApp,
  TEST_JWT_SECRET,
} from './helpers.js';
import { removeDefaultUsers, seedUsers } from '../src/services/auth.service.js';
import { UserModel } from '../src/models/user.model.js';
import { RETIRED_SEED_USERS, SEED_USERS } from '@suarza/shared';

let app: Express;

beforeAll(async () => {
  await startDatabase();
  app = testApp();
});
afterAll(stopDatabase);
afterEach(clearDatabase);
beforeEach(async () => {
  await seedUsers();
  /*
   * The roles the gating tests need, as accounts of their own.
   *
   * Not the shipped ones: role gating is a fact about roles, and a test that
   * proves it through an account that happens to be in the seed list is
   * really testing the seed list.
   */
  await createUser({ username: 'a-manager', password: 'manager-pw', role: 'MANAGER' });
  await createUser({ username: 'an-operator', password: 'operator-pw', role: 'OPERATOR' });
});

const ADMIN = SEED_USERS[0]!;

const login = (username: string, password: string) =>
  request(app).post('/auth/login').send({ username, password });

describe('seeding', () => {
  it('creates the station administrator', async () => {
    const admin = await UserModel.findOne({ username: ADMIN.username }).lean();
    expect(admin?.role).toBe('ADMIN');
  });

  it('never stores a password in plaintext', async () => {
    const admin = await UserModel.findOne({ username: ADMIN.username }).lean();
    expect(admin?.password_hash).not.toBe(ADMIN.password);
    expect(admin?.password_hash).toMatch(/^\$2[aby]\$/);
  });

  it('is safe to run again and does not reset a changed password', async () => {
    await UserModel.updateOne({ username: ADMIN.username }, { $set: { password_hash: 'CHANGED' } });
    await seedUsers();

    const admin = await UserModel.findOne({ username: ADMIN.username }).lean();
    expect(admin?.password_hash).toBe('CHANGED');
  });
});

describe('retiring the accounts this system used to ship with', () => {
  it('removes each one that still has its published password', async () => {
    for (const retired of RETIRED_SEED_USERS) {
      await createUser({ ...retired, role: 'ADMIN' });
    }

    const removed = await removeDefaultUsers();

    expect(removed.sort()).toEqual(RETIRED_SEED_USERS.map((u) => u.username).sort());
    for (const retired of RETIRED_SEED_USERS) {
      expect(await login(retired.username, retired.password)).toMatchObject({ status: 401 });
    }
  });

  it('leaves an account whose password somebody has since changed', async () => {
    /*
     * The check that stops this being a destructive migration. An account
     * still called `manager` but with a real password is somebody's account,
     * and deleting it would lock a person out of their own dashboard in the
     * name of security.
     */
    await createUser({ username: 'manager', password: 'a real password', role: 'MANAGER' });

    expect(await removeDefaultUsers()).toEqual([]);
    expect((await login('manager', 'a real password')).status).toBe(200);
  });

  it('says nothing and does nothing on a database that never had them', async () => {
    expect(await removeDefaultUsers()).toEqual([]);
  });
});

describe('POST /auth/login', () => {
  it('issues a token for correct credentials', async () => {
    const response = await login('a-manager', 'manager-pw');

    expect(response.status).toBe(200);
    expect(response.body.user).toMatchObject({ username: 'a-manager', role: 'MANAGER' });
    expect(typeof response.body.token).toBe('string');
    expect(new Date(response.body.expires_at).getTime()).toBeGreaterThan(Date.now());
  });

  it('signs a token the server itself will accept', async () => {
    const { body } = await login(ADMIN.username, ADMIN.password);
    const payload = jwt.verify(body.token, TEST_JWT_SECRET) as { sub: string; role: string };
    expect(payload).toMatchObject({ sub: ADMIN.username, role: 'ADMIN' });
  });

  it('rejects a wrong password', async () => {
    const response = await login(ADMIN.username, 'wrong');
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHORIZED');
  });

  it('gives the same answer for an unknown user as for a wrong password', async () => {
    // Telling an attacker which usernames exist is a free gift.
    const unknown = await login('nobody', 'whatever');
    const wrongPassword = await login(ADMIN.username, 'wrong');
    expect(unknown.status).toBe(wrongPassword.status);
    expect(unknown.body.error.message).toBe(wrongPassword.body.error.message);
  });

  it('rejects an empty submission with a validation error', async () => {
    const response = await request(app).post('/auth/login').send({});
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('protected routes', () => {
  it('refuses access with no token', async () => {
    const response = await request(app).get('/weighments');
    expect(response.status).toBe(401);
  });

  it('refuses a tampered token', async () => {
    const { body } = await login('a-manager', 'manager-pw');
    const tampered = `${body.token.slice(0, -3)}xyz`;
    const response = await request(app)
      .get('/weighments')
      .set('authorization', `Bearer ${tampered}`);
    expect(response.status).toBe(401);
  });

  it('refuses a token signed with a different secret', async () => {
    const forged = jwt.sign({ sub: 'manager', role: 'MANAGER', name: 'M' }, 'some-other-secret');
    const response = await request(app).get('/weighments').set('authorization', `Bearer ${forged}`);
    expect(response.status).toBe(401);
  });

  it('refuses an expired token', async () => {
    const expired = jwt.sign({ sub: 'manager', role: 'MANAGER', name: 'M' }, TEST_JWT_SECRET, {
      expiresIn: '-1h',
    });
    const response = await request(app)
      .get('/weighments')
      .set('authorization', `Bearer ${expired}`);
    expect(response.status).toBe(401);
    expect(response.body.error.message).toMatch(/sign in again/i);
  });

  it('allows a manager through', async () => {
    const { body } = await login('a-manager', 'manager-pw');
    const response = await request(app)
      .get('/weighments')
      .set('authorization', `Bearer ${body.token}`);
    expect(response.status).toBe(200);
  });

  it('allows an admin through', async () => {
    const { body } = await login(ADMIN.username, ADMIN.password);
    const response = await request(app)
      .get('/weighments')
      .set('authorization', `Bearer ${body.token}`);
    expect(response.status).toBe(200);
  });

  it('refuses an operator — they weigh trucks, they do not read the books', async () => {
    const { body } = await login('an-operator', 'operator-pw');
    const response = await request(app)
      .get('/weighments')
      .set('authorization', `Bearer ${body.token}`);
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('FORBIDDEN');
  });
});
