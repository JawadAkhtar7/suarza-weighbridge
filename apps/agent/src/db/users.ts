/**
 * Who is allowed to change this weighbridge's settings.
 *
 * A table rather than a constant pair, because a password that lives in the
 * source is a password that is the same on every station and can only be
 * changed by a developer with a laptop. This one is on the machine, and the
 * seed below is only what it starts life with.
 *
 * Passwords are stored as scrypt hashes. Not because anyone expects this
 * SQLite file to be stolen — it is on a PC in a weighbridge office — but
 * because the file is copied into every scheduled backup, and a backup is a
 * thing people email to each other. A plain password in one of those outlives
 * the machine it came from.
 *
 * scrypt comes with Node, so this adds no dependency to a PC that is hundreds
 * of kilometres away and cannot easily be given one.
 */

import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { Db } from './connection.js';
import { nowUtc } from '@suarza/shared';

/**
 * Deliberately the standard interactive-login cost, not a lower one.
 *
 * It is about 100 ms on this hardware, which nobody notices on a save they
 * made by pressing a button, and which is the whole defence if the hash ever
 * leaves the machine.
 */
const SCRYPT = { N: 16_384, r: 8, p: 1, keyLength: 32, saltLength: 16 } as const;

export interface UserRow {
  username: string;
  password_hash: string;
  created_at: string;
  updated_at: string;
}

/** `scrypt$N$r$p$salt$hash`, so the cost can be raised later without a flag day. */
export function hashPassword(password: string): string {
  const salt = randomBytes(SCRYPT.saltLength);
  const hash = scryptSync(password, salt, SCRYPT.keyLength, {
    N: SCRYPT.N,
    r: SCRYPT.r,
    p: SCRYPT.p,
  });
  return [
    'scrypt',
    SCRYPT.N,
    SCRYPT.r,
    SCRYPT.p,
    salt.toString('base64'),
    hash.toString('base64'),
  ].join('$');
}

/**
 * Check a password against a stored hash.
 *
 * False rather than a throw for a hash this cannot read: a settings file that
 * someone has edited by hand should lock the screen, not crash the agent in
 * the middle of a weighing.
 */
export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

  const [, n, r, p, salt, hash] = parts;
  const expected = Buffer.from(hash!, 'base64');

  let actual: Buffer;
  try {
    actual = scryptSync(password, Buffer.from(salt!, 'base64'), expected.byteLength, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
    });
  } catch {
    return false;
  }

  // Lengths must match before timingSafeEqual, which throws on a mismatch.
  if (actual.byteLength !== expected.byteLength) return false;
  return timingSafeEqual(actual, expected);
}

/** Usernames are matched without regard to case; nobody types their own name twice the same way. */
function normalise(username: string): string {
  return username.trim().toLowerCase();
}

export class UserRepository {
  constructor(private readonly db: Db) {}

  find(username: string): UserRow | undefined {
    return this.db
      .prepare<[string], UserRow>('SELECT * FROM users WHERE username = ?')
      .get(normalise(username));
  }

  count(): number {
    return this.db.prepare<[], { n: number }>('SELECT COUNT(*) AS n FROM users').get()?.n ?? 0;
  }

  /**
   * Whether these credentials may change this station's settings.
   *
   * An unknown username still costs a hash, so that the time taken cannot be
   * used to learn which names exist. It is a weighbridge office rather than a
   * bank, but the defence is two lines.
   */
  verify(username: string, password: string): boolean {
    const row = this.find(username);
    if (!row) {
      verifyPassword(password, hashPassword('no such user'));
      return false;
    }
    return verifyPassword(password, row.password_hash);
  }

  upsert(username: string, password: string): void {
    const now = nowUtc();
    this.db
      .prepare(
        `INSERT INTO users (username, password_hash, created_at, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT (username) DO UPDATE SET
           password_hash = excluded.password_hash,
           updated_at    = excluded.updated_at`,
      )
      .run(normalise(username), hashPassword(password), now, now);
  }

  /**
   * Put the first user in, once, on a station that has none.
   *
   * Only ever on an empty table. If it ran whenever the seed user was missing
   * it would undo a deliberate deletion, and if it ran whenever the password
   * differed it would undo every password change on the next restart — which
   * is the same as having no password at all.
   */
  seed(username: string, password: string): boolean {
    if (this.count() > 0) return false;
    this.upsert(username, password);
    return true;
  }
}
