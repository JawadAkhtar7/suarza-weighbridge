/** SQLite connection and pragmas. */

import { dirname, isAbsolute, resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import Database from 'better-sqlite3';
import { migrate } from './schema.js';

export type Db = Database.Database;

export interface OpenDbOptions {
  /** File path, or `:memory:` for tests. */
  path: string;
  /** Base directory relative paths resolve against. Defaults to cwd. */
  baseDir?: string;
  verbose?: (message: string) => void;
}

export function openDatabase({ path, baseDir = process.cwd(), verbose }: OpenDbOptions): Db {
  const resolved = path === ':memory:' || isAbsolute(path) ? path : resolve(baseDir, path);

  if (resolved !== ':memory:') {
    mkdirSync(dirname(resolved), { recursive: true });
  }

  const db = new Database(resolved);

  // WAL keeps the ~300ms live-weight polling from ever blocking a save.
  db.pragma('journal_mode = WAL');
  // FULL, not the usual NORMAL: this is a factory floor with unreliable mains
  // power, and a weighment that the operator saw saved must survive the cut.
  // The cost is one fsync per transaction, which is nothing at this volume.
  db.pragma('synchronous = FULL');
  db.pragma('foreign_keys = ON');
  // A save must never fail because the live-weight query holds a read lock.
  db.pragma('busy_timeout = 5000');

  const applied = migrate(db);
  if (applied > 0) verbose?.(`Applied ${applied} database migration(s)`);

  return db;
}

export function closeDatabase(db: Db): void {
  // Fold the WAL back into the main file so the scheduled backup copy (§12)
  // is a single self-contained file.
  try {
    db.pragma('wal_checkpoint(TRUNCATE)');
  } catch {
    // Checkpointing is best-effort; a failure here must not block shutdown.
  }
  db.close();
}
