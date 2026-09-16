/** Tiny key/value store on the `meta` table. */

import type { Db } from './connection.js';

export class MetaStore {
  constructor(private readonly db: Db) {}

  get(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as
      { value: string } | undefined;
    return row?.value ?? null;
  }

  set(key: string, value: string): void {
    this.db
      .prepare(
        'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
      )
      .run(key, value);
  }

  getNumber(key: string, fallback = 0): number {
    const raw = this.get(key);
    if (raw === null) return fallback;
    const n = Number(raw);
    return Number.isFinite(n) ? n : fallback;
  }

  getJson<T>(key: string, fallback: T): T {
    const raw = this.get(key);
    if (raw === null) return fallback;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  }

  setJson(key: string, value: unknown): void {
    this.set(key, JSON.stringify(value));
  }
}

export const META_KEYS = {
  slipCounter: 'slip_counter',
  lastSyncSuccessAt: 'last_sync_success_at',
  lastSyncError: 'last_sync_error',
  /** When the settings were last edited, so the cloud can spot a stale copy. */
  settingsUpdatedAt: 'settings_updated_at',
  /** When the operator last pulled each manager-kept list. */
  customersSyncedAt: 'customers_synced_at',
  vehicleTypesSyncedAt: 'vehicle_types_synced_at',
} as const;
