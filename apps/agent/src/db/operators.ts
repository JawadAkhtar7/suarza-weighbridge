/**
 * Who is signed in at the window, and who is allowed to be.
 *
 * Three small tables behind one repository, because they are one subject:
 * the accounts the manager set, the shift somebody is in the middle of, and
 * the record of shifts beginning and ending that the manager will read back.
 *
 * None of it is authoritative. The accounts are a copy of the cloud's, pulled
 * with the other lists; the log is written here and pushed up. What IS local
 * is the session, and that is the point of the whole arrangement — a shift
 * must be able to start with the internet down.
 */

import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { newId, nowUtc, shiftForSlot } from '@suarza/shared';
import type { OperatorSession, OperatorSlot } from '@suarza/shared';
import type { Db } from './connection.js';

export interface OperatorAccountRow {
  username: string;
  name: string;
  slot: OperatorSlot;
  password_hash: string;
  updated_at: string;
  synced_at: string;
}

export interface OperatorSessionRow {
  token: string;
  username: string;
  name: string;
  slot: OperatorSlot;
  started_at: string;
  last_seen_at: string;
}

export interface OperatorLogRow {
  id: string;
  kind: 'SHIFT_START' | 'SHIFT_END';
  username: string;
  name: string;
  slot: OperatorSlot;
  detail: string | null;
  at: string;
}

/** One account, as the cloud describes it. */
export interface IncomingOperatorAccount {
  username: string;
  name: string;
  slot: OperatorSlot;
  password_hash: string;
  updated_at: string;
}

function normalise(username: string): string {
  return username.trim().toLowerCase();
}

export function toSession(row: OperatorSessionRow): OperatorSession {
  return {
    token: row.token,
    username: row.username,
    name: row.name,
    slot: row.slot,
    shift: shiftForSlot(row.slot),
    started_at: row.started_at,
  };
}

export class OperatorRepository {
  constructor(private readonly db: Db) {}

  // --- The accounts --------------------------------------------------------

  find(username: string): OperatorAccountRow | undefined {
    return this.db
      .prepare<[string], OperatorAccountRow>('SELECT * FROM operator_accounts WHERE username = ?')
      .get(normalise(username));
  }

  count(): number {
    return (
      this.db.prepare<[], { n: number }>('SELECT COUNT(*) AS n FROM operator_accounts').get()?.n ??
      0
    );
  }

  /**
   * Replace the local copy with what the cloud sent.
   *
   * Wholesale, inside one transaction, because the list IS the cloud's: an
   * account the manager deleted has to stop opening the screen here, and a
   * merge would leave it working for ever on the one machine it matters on.
   */
  applySync(accounts: readonly IncomingOperatorAccount[]): { total: number } {
    const at = nowUtc();
    const apply = this.db.transaction((rows: readonly IncomingOperatorAccount[]) => {
      this.db.prepare('DELETE FROM operator_accounts').run();
      const insert = this.db.prepare(
        `INSERT INTO operator_accounts (username, name, slot, password_hash, updated_at, synced_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      );
      for (const row of rows) {
        insert.run(
          normalise(row.username),
          row.name,
          row.slot,
          row.password_hash,
          row.updated_at,
          at,
        );
      }

      /* A session belonging to an account that no longer exists ends here.
         Not doing this would leave somebody the manager has removed working
         until they happened to press "End shift". */
      this.db
        .prepare(
          `DELETE FROM operator_sessions
            WHERE username NOT IN (SELECT username FROM operator_accounts)`,
        )
        .run();
    });

    apply(accounts);
    return { total: this.count() };
  }

  // --- Starting and ending a shift ----------------------------------------

  /**
   * Check a password against the manager's copy.
   *
   * bcrypt, because that is the shape the cloud stores and this machine must
   * not need the password to make a hash of its own. An unknown username is
   * still made to cost a comparison, so the time taken says nothing about
   * which names exist.
   */
  verify(username: string, password: string): OperatorAccountRow | null {
    const row = this.find(username);
    if (!row) {
      bcrypt.compareSync(
        password,
        '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinv',
      );
      return null;
    }
    return bcrypt.compareSync(password, row.password_hash) ? row : null;
  }

  /**
   * Start a shift.
   *
   * Signing in a second time replaces the earlier session for that person
   * rather than adding one: a browser refreshed on a different tab is the
   * same shift, and two "started" entries for one arrival would make the log
   * harder to read rather than more accurate.
   */
  startShift(account: OperatorAccountRow): OperatorSession {
    const at = nowUtc();
    const token = randomBytes(24).toString('base64url');

    const begin = this.db.transaction(() => {
      this.db.prepare('DELETE FROM operator_sessions WHERE username = ?').run(account.username);
      this.db
        .prepare(
          `INSERT INTO operator_sessions (token, username, name, slot, started_at, last_seen_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(token, account.username, account.name, account.slot, at, at);
      this.appendLog({
        kind: 'SHIFT_START',
        username: account.username,
        name: account.name,
        slot: account.slot,
        detail: null,
        at,
      });
    });

    begin();

    return toSession({
      token,
      username: account.username,
      name: account.name,
      slot: account.slot,
      started_at: at,
      last_seen_at: at,
    });
  }

  session(token: string): OperatorSessionRow | undefined {
    return this.db
      .prepare<[string], OperatorSessionRow>('SELECT * FROM operator_sessions WHERE token = ?')
      .get(token);
  }

  /** End a shift. Returns the session that ended, or null if there was none. */
  endShift(token: string): OperatorSessionRow | null {
    const row = this.session(token);
    if (!row) return null;

    const at = nowUtc();
    const finish = this.db.transaction(() => {
      this.db.prepare('DELETE FROM operator_sessions WHERE token = ?').run(token);
      this.appendLog({
        kind: 'SHIFT_END',
        username: row.username,
        name: row.name,
        slot: row.slot,
        detail: describeLength(row.started_at, at),
        at,
      });
    });

    finish();
    return row;
  }

  // --- The log on its way up ----------------------------------------------

  appendLog(entry: Omit<OperatorLogRow, 'id'> & { id?: string }): void {
    this.db
      .prepare(
        `INSERT INTO operator_logs (id, kind, username, name, slot, detail, at, synced)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
      )
      .run(
        entry.id ?? newId(),
        entry.kind,
        entry.username,
        entry.name,
        entry.slot,
        entry.detail,
        entry.at,
      );
  }

  unsyncedLogs(limit = 100): OperatorLogRow[] {
    return this.db
      .prepare<[number], OperatorLogRow>(
        'SELECT id, kind, username, name, slot, detail, at FROM operator_logs WHERE synced = 0 ORDER BY at LIMIT ?',
      )
      .all(limit);
  }

  markLogsSynced(ids: readonly string[]): void {
    if (ids.length === 0) return;
    const mark = this.db.prepare('UPDATE operator_logs SET synced = 1 WHERE id = ?');
    this.db.transaction((rows: readonly string[]) => {
      for (const id of rows) mark.run(id);
    })(ids);
  }
}

/** "Shift lasted 7h 40m", for the manager reading the log afterwards. */
function describeLength(from: string, to: string): string | null {
  const minutes = Math.round((new Date(to).getTime() - new Date(from).getTime()) / 60_000);
  if (!Number.isFinite(minutes) || minutes < 0) return null;
  const hours = Math.floor(minutes / 60);
  return `Shift lasted ${hours > 0 ? `${hours}h ` : ''}${minutes % 60}m`;
}
