/**
 * Authentication (brief §6, §10). No registration — the user list is seeded and
 * config-driven, so real accounts replace the dummies without a code change.
 */

import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import {
  RETIRED_SEED_USERS,
  SEED_USERS,
  type AuthUser,
  type LoginResponse,
  type UserRole,
} from '@suarza/shared';
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

/**
 * Delete the accounts this system used to ship with, while they still have
 * their shipped password.
 *
 * Seeding a new administrator does not secure anything on its own: the old
 * `admin/admin` would still be there, and a way in is only as strong as the
 * weakest account that still opens it. So the defaults go.
 *
 * The password check is what keeps this from being a destructive migration.
 * An account called `manager` whose password someone has since changed is
 * somebody's account — it is left exactly where it is, and only an account
 * still answering to the password printed in the brief is removed.
 */
export async function removeDefaultUsers(): Promise<string[]> {
  const removed: string[] = [];

  for (const retired of RETIRED_SEED_USERS) {
    const user = await UserModel.findOne({ username: retired.username });
    if (!user) continue;
    if (!(await bcrypt.compare(retired.password, user.password_hash))) continue;

    await UserModel.deleteOne({ _id: user._id });
    removed.push(retired.username);
  }

  return removed;
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
