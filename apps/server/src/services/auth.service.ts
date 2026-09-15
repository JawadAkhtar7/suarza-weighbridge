/**
 * Authentication (brief §6, §10). No registration — the user list is seeded and
 * config-driven, so real accounts replace the dummies without a code change.
 */

import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { SEED_USERS, type AuthUser, type LoginResponse, type UserRole } from '@suarza/shared';
import { UserModel } from '../models/user.model.js';
import { ApiError } from '../errors.js';
import type { JwtPayload } from '../middleware/auth.js';

const BCRYPT_ROUNDS = 10;

/**
 * Creates any seed user that is missing. Existing users are left alone, so a
 * password changed in the database is never silently reset back to the dummy
 * on the next deploy.
 */
export async function seedUsers(): Promise<number> {
  let created = 0;
  for (const seed of SEED_USERS) {
    const exists = await UserModel.exists({ username: seed.username });
    if (exists) continue;
    await UserModel.create({
      username: seed.username,
      // Hashed even for the dummies (brief §6) — nothing in this system ever
      // holds a plaintext password at rest.
      password_hash: await bcrypt.hash(seed.password, BCRYPT_ROUNDS),
      display_name: seed.displayName,
      role: seed.role,
    });
    created += 1;
  }
  return created;
}

export interface LoginOptions {
  secret: string;
  expiresIn: string;
}

export async function login(
  username: string,
  password: string,
  options: LoginOptions,
): Promise<LoginResponse> {
  const user = await UserModel.findOne({ username: username.trim().toLowerCase() }).lean();

  // Same message and roughly the same work either way: telling an attacker
  // that a username exists is a free gift.
  const hash =
    user?.password_hash ?? '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinv';
  const ok = await bcrypt.compare(password, hash);

  if (!user || !ok) {
    throw new ApiError('UNAUTHORIZED', 'Incorrect username or password.');
  }

  const authUser: AuthUser = {
    username: user.username,
    display_name: user.display_name,
    role: user.role as UserRole,
  };

  const payload: JwtPayload = {
    sub: authUser.username,
    role: authUser.role,
    name: authUser.display_name,
  };

  const token = jwt.sign(payload, options.secret, {
    expiresIn: options.expiresIn as jwt.SignOptions['expiresIn'],
  });

  const decoded = jwt.decode(token) as { exp?: number } | null;
  const expiresAt = decoded?.exp
    ? new Date(decoded.exp * 1000).toISOString()
    : new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();

  return { token, user: authUser, expires_at: expiresAt };
}
