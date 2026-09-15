/** Manager auth and role gating (brief §10, §12). */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import jwt from 'jsonwebtoken';
import { clearDatabase, startDatabase, stopDatabase, testApp, TEST_JWT_SECRET } from './helpers.js';
import { seedUsers } from '../src/services/auth.service.js';
import { UserModel } from '../src/models/user.model.js';

let app: Express;

beforeAll(async () => {
  await startDatabase();
  app = testApp();
});
afterAll(stopDatabase);
afterEach(clearDatabase);
beforeEach(seedUsers);

const login = (username: string, password: string) =>
  request(app).post('/auth/login').send({ username, password });

describe('seeding', () => {
  it('creates the dummy accounts', async () => {
    expect(await UserModel.countDocuments()).toBe(3);
  });

  it('never stores a password in plaintext', async () => {
    const manager = await UserModel.findOne({ username: 'manager' }).lean();
    expect(manager?.password_hash).not.toBe('manager');
    expect(manager?.password_hash).toMatch(/^\$2[aby]\$/);
  });

  it('is safe to run again and does not reset a changed password', async () => {
    await UserModel.updateOne({ username: 'manager' }, { $set: { password_hash: 'CHANGED' } });
    await seedUsers();

    const manager = await UserModel.findOne({ username: 'manager' }).lean();
    expect(manager?.password_hash).toBe('CHANGED');
    expect(await UserModel.countDocuments()).toBe(3);
  });
});

describe('POST /auth/login', () => {
  it('issues a token for correct credentials', async () => {
    const response = await login('manager', 'manager');

    expect(response.status).toBe(200);
    expect(response.body.user).toMatchObject({ username: 'manager', role: 'MANAGER' });
    expect(typeof response.body.token).toBe('string');
    expect(new Date(response.body.expires_at).getTime()).toBeGreaterThan(Date.now());
  });

  it('signs a token the server itself will accept', async () => {
    const { body } = await login('admin', 'admin');
    const payload = jwt.verify(body.token, TEST_JWT_SECRET) as { sub: string; role: string };
    expect(payload).toMatchObject({ sub: 'admin', role: 'ADMIN' });
  });

  it('rejects a wrong password', async () => {
    const response = await login('manager', 'wrong');
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHORIZED');
  });

  it('gives the same answer for an unknown user as for a wrong password', async () => {
    // Telling an attacker which usernames exist is a free gift.
    const unknown = await login('nobody', 'whatever');
    const wrongPassword = await login('manager', 'wrong');
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
    const { body } = await login('manager', 'manager');
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
    const { body } = await login('manager', 'manager');
    const response = await request(app)
      .get('/weighments')
      .set('authorization', `Bearer ${body.token}`);
    expect(response.status).toBe(200);
  });

  it('allows an admin through', async () => {
    const { body } = await login('admin', 'admin');
    const response = await request(app)
      .get('/weighments')
      .set('authorization', `Bearer ${body.token}`);
    expect(response.status).toBe(200);
  });

  it('refuses an operator — they weigh trucks, they do not read the books', async () => {
    const { body } = await login('operator', 'operator');
    const response = await request(app)
      .get('/weighments')
      .set('authorization', `Bearer ${body.token}`);
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('FORBIDDEN');
  });
});
