/**
 * Append-only audit log (brief §6, §12). There is deliberately no update and
 * no delete on this table — weights are never silently edited, and every state
 * change leaves a row behind.
 */

import type { AuditAction, AuditEntry } from '@suarza/shared';
import { newId, nowUtc } from '@suarza/shared';
import type { Db } from './connection.js';

interface AuditRow {
  id: string;
  weighment_id: string;
  action: string;
  actor_username: string;
  detail: string;
  at: string;
  synced: number;
}

function rowToEntry(row: AuditRow): AuditEntry {
  let detail: Record<string, unknown> = {};
  try {
    detail = JSON.parse(row.detail) as Record<string, unknown>;
  } catch {
    // A malformed detail blob must never make the trail unreadable — keep the
    // raw text so the event itself is still visible.
    detail = { raw: row.detail };
  }
  return {
    id: row.id,
    weighment_id: row.weighment_id,
    action: row.action as AuditAction,
    actor_username: row.actor_username,
    detail,
    at: row.at,
  };
}

export class AuditRepository {
  constructor(private readonly db: Db) {}

  append(entry: {
    weighment_id: string;
    action: AuditAction;
    actor_username: string;
    detail?: Record<string, unknown>;
    at?: string;
  }): AuditEntry {
    const row = {
      id: newId(),
      weighment_id: entry.weighment_id,
      action: entry.action,
      actor_username: entry.actor_username,
      detail: JSON.stringify(entry.detail ?? {}),
      at: entry.at ?? nowUtc(),
    };
    this.db
      .prepare(
        `INSERT INTO audit_log (id, weighment_id, action, actor_username, detail, at, synced)
         VALUES (@id, @weighment_id, @action, @actor_username, @detail, @at, 0)`,
      )
      .run(row);
    return rowToEntry({ ...row, synced: 0 });
  }

  listForWeighment(weighmentId: string): AuditEntry[] {
    const rows = this.db
      .prepare('SELECT * FROM audit_log WHERE weighment_id = ? ORDER BY at ASC')
      .all(weighmentId) as AuditRow[];
    return rows.map(rowToEntry);
  }

  listUnsynced(limit = 500): AuditEntry[] {
    const rows = this.db
      .prepare('SELECT * FROM audit_log WHERE synced = 0 ORDER BY at ASC LIMIT ?')
      .all(limit) as AuditRow[];
    return rows.map(rowToEntry);
  }

  /** Audit entries for a set of weighments — they sync alongside their record. */
  listUnsyncedForWeighments(weighmentIds: string[]): AuditEntry[] {
    if (weighmentIds.length === 0) return [];
    const placeholders = weighmentIds.map(() => '?').join(', ');
    const rows = this.db
      .prepare(
        `SELECT * FROM audit_log WHERE synced = 0 AND weighment_id IN (${placeholders}) ORDER BY at ASC`,
      )
      .all(...weighmentIds) as AuditRow[];
    return rows.map(rowToEntry);
  }

  markSynced(ids: string[]): void {
    if (ids.length === 0) return;
    const stmt = this.db.prepare('UPDATE audit_log SET synced = 1 WHERE id = ?');
    this.db.transaction((batch: string[]) => {
      for (const id of batch) stmt.run(id);
    })(ids);
  }

  countUnsynced(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM audit_log WHERE synced = 0').get() as {
      n: number;
    };
    return row.n;
  }
}
