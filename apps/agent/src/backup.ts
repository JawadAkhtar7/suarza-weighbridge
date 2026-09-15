/**
 * Scheduled SQLite backup (brief §12).
 *
 * Uses SQLite's own online backup API rather than copying the file: a plain
 * file copy taken mid-write produces a corrupt database, and this is the copy
 * that matters precisely when the original has been lost.
 *
 * Backups are kept in a rotating set so a fault that corrupts today's data
 * does not immediately overwrite the last good copy.
 */

import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Db } from './db/connection.js';

const KEEP_BACKUPS = 14;
const FILE_PREFIX = 'weighbridge-';

export interface BackupOptions {
  db: Db;
  /** Blank disables backups entirely. */
  directory: string;
  intervalHours: number;
  onLog?: (level: 'info' | 'warn' | 'error', message: string) => void;
}

export async function runBackup(db: Db, directory: string): Promise<string> {
  mkdirSync(directory, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const target = resolve(directory, `${FILE_PREFIX}${stamp}.sqlite`);

  await db.backup(target);
  pruneOldBackups(directory);
  return target;
}

function pruneOldBackups(directory: string): void {
  if (!existsSync(directory)) return;

  const backups = readdirSync(directory)
    .filter((name) => name.startsWith(FILE_PREFIX) && name.endsWith('.sqlite'))
    .map((name) => ({ name, path: resolve(directory, name) }))
    .map((entry) => ({ ...entry, mtime: statSync(entry.path).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);

  for (const stale of backups.slice(KEEP_BACKUPS)) {
    try {
      unlinkSync(stale.path);
    } catch {
      // A backup that cannot be deleted is not worth failing the job over.
    }
  }
}

export class BackupJob {
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly options: BackupOptions) {}

  start(): void {
    if (!this.options.directory) {
      this.options.onLog?.('info', 'Local backups disabled — no backup path configured');
      return;
    }
    if (this.timer) return;

    const intervalMs = Math.max(1, this.options.intervalHours) * 60 * 60 * 1000;
    // One on startup: a PC that is switched off every night would otherwise
    // never reach the interval.
    void this.runOnce();
    this.timer = setInterval(() => void this.runOnce(), intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async runOnce(): Promise<void> {
    try {
      const target = await runBackup(this.options.db, this.options.directory);
      this.options.onLog?.('info', `Database backed up to ${target}`);
    } catch (error) {
      // A failed backup must never take the weighbridge down with it.
      this.options.onLog?.(
        'error',
        `Backup failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
