/**
 * Passwords on the station, and the one rule about seeding them.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type Db } from '../src/db/connection.js';
import { UserRepository, hashPassword, verifyPassword } from '../src/db/users.js';

let db: Db;
let users: UserRepository;

beforeEach(() => {
  db = openDatabase({ path: ':memory:' });
  users = new UserRepository(db);
});

afterEach(() => db.close());

describe('hashing', () => {
  it('does not store the password', () => {
    // The SQLite file is copied into every scheduled backup, and a backup is
    // a thing people email to each other.
    const hash = hashPassword('pakistan1!');
    expect(hash).not.toContain('pakistan1!');
    expect(hash.startsWith('scrypt$')).toBe(true);
  });

  it('gives the same password a different hash each time', () => {
    // A salt per password: two stations sharing one must not be visibly the
    // same, and neither must two users who chose the same word.
    expect(hashPassword('pakistan1!')).not.toBe(hashPassword('pakistan1!'));
  });

  it('accepts the password and refuses everything else', () => {
    const hash = hashPassword('pakistan1!');
    expect(verifyPassword('pakistan1!', hash)).toBe(true);
    expect(verifyPassword('pakistan1', hash)).toBe(false);
    expect(verifyPassword('Pakistan1!', hash)).toBe(false);
    expect(verifyPassword('', hash)).toBe(false);
  });

  it('refuses a hash it cannot read rather than throwing', () => {
    // A hand-edited database should lock the screen, not bring the agent down
    // in the middle of a weighing.
    for (const broken of ['', 'plaintext', 'scrypt$x', 'bcrypt$1$2$3$4$5']) {
      expect(verifyPassword('pakistan1!', broken)).toBe(false);
    }
  });
});

describe('the station users', () => {
  it('verifies a stored login whatever case the name is typed in', () => {
    users.upsert('suarza', 'pakistan1!');
    expect(users.verify('suarza', 'pakistan1!')).toBe(true);
    expect(users.verify('SUARZA', 'pakistan1!')).toBe(true);
    expect(users.verify(' Suarza ', 'pakistan1!')).toBe(true);
    expect(users.verify('suarza', 'wrong')).toBe(false);
    expect(users.verify('nobody', 'pakistan1!')).toBe(false);
  });

  it('changes a password without making a second user', () => {
    users.upsert('suarza', 'pakistan1!');
    users.upsert('suarza', 'something else');

    expect(users.count()).toBe(1);
    expect(users.verify('suarza', 'pakistan1!')).toBe(false);
    expect(users.verify('suarza', 'something else')).toBe(true);
  });

  it('seeds only a station that has no users at all', () => {
    expect(users.seed('suarza', 'pakistan1!')).toBe(true);
    expect(users.verify('suarza', 'pakistan1!')).toBe(true);

    /*
     * The rule that matters. The agent seeds on every start, so if this put
     * the shipped password back whenever it differed, a station that had
     * changed its password would be returned to the published one on the
     * next restart — which is the same as having no password at all.
     */
    users.upsert('suarza', 'changed on site');
    expect(users.seed('suarza', 'pakistan1!')).toBe(false);
    expect(users.verify('suarza', 'pakistan1!')).toBe(false);
    expect(users.verify('suarza', 'changed on site')).toBe(true);
  });

  it('does not re-seed a station whose only user was renamed', () => {
    // Seeding on "the seed user is missing" rather than "there are no users"
    // would quietly undo a deliberate deletion.
    users.upsert('yard-manager', 'their own password');
    expect(users.seed('suarza', 'pakistan1!')).toBe(false);
    expect(users.find('suarza')).toBeUndefined();
  });
});
