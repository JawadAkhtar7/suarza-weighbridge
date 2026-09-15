/** Station settings and the local backup job (brief §12, §13-M8). */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { openDatabase, type Db } from '../src/db/connection.js';
import { SettingsService } from '../src/services/settings-service.js';
import { WeighmentService } from '../src/services/weighment-service.js';
import { runBackup } from '../src/backup.js';
import { AppError } from '../src/errors.js';

let db: Db;
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'wb-backup-'));
  db = openDatabase({ path: resolve(dir, 'agent.sqlite') });
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('SettingsService', () => {
  it('starts from the schema defaults', () => {
    const settings = new SettingsService(db).get();
    expect(settings.print.paper_size).toBe('A5');
    expect(settings.company_name).toBe('Suarza International');
  });

  it('seeds from the environment on a fresh install', () => {
    const settings = new SettingsService(db, { station_id: 'B', backup_path: '/tmp/x' }).get();
    expect(settings.station_id).toBe('B');
    expect(settings.backup_path).toBe('/tmp/x');
  });

  it('persists a change across a fresh read', () => {
    const service = new SettingsService(db);
    const current = service.get();
    service.replace({ ...current, print: { ...current.print, offset_top_mm: 14 } });

    // A new instance, as a restarted agent would build.
    expect(new SettingsService(db).get().print.offset_top_mm).toBe(14);
  });

  it('keeps an edited pricing table', () => {
    const service = new SettingsService(db);
    service.replace({ ...service.get(), pricing: { truck: 450, container: 750 } });
    expect(new SettingsService(db).get().pricing.truck).toBe(450);
  });

  it('rejects settings that are not valid rather than storing them', () => {
    const service = new SettingsService(db);
    expect(() => service.replace({ print: { paper_size: 'FOOLSCAP' } })).toThrow(AppError);
    // The stored settings are untouched.
    expect(service.get().print.paper_size).toBe('A5');
  });

  it('falls back to defaults if the stored blob is unreadable', () => {
    // Weighing must keep working; settings can be fixed afterwards.
    db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)').run('station_settings', '{not json');
    expect(new SettingsService(db).get().print.paper_size).toBe('A5');
  });

  it('tells listeners so the sync worker can pick up a new cadence', () => {
    const service = new SettingsService(db);
    let seen = 0;
    service.onChange((next) => (seen = next.sync_interval_seconds));
    service.replace({ ...service.get(), sync_interval_seconds: 600 });
    expect(seen).toBe(600);
  });
});

describe('backup', () => {
  it('writes a usable copy of the database', async () => {
    const service = new WeighmentService(db, { stationId: 'A' });
    service.createFirstWeight({
      customer_name: 'Ali Raza',
      customer_company: 'Raza Traders',
      vehicle_type: 'truck',
      vehicle_plate: 'LES-1234',
      product: 'Cement',
      first_weight_kg: 8000,
      first_weight_src: 'SERIAL',
      amount_charged: 300,
      operator_username: 'operator',
    });

    const target = await runBackup(db, resolve(dir, 'backups'));
    expect(existsSync(target)).toBe(true);

    // Opened as a real database, not just checked for existence — a file copy
    // taken mid-write would be corrupt, which is the whole reason SQLite's
    // online backup API is used instead.
    const restored = openDatabase({ path: target });
    const row = restored.prepare('SELECT slip_number, first_weight_kg FROM weighments').get() as {
      slip_number: string;
      first_weight_kg: number;
    };
    expect(row).toEqual({ slip_number: 'SI-000001', first_weight_kg: 8000 });
    restored.close();
  });

  it('keeps a rotating set rather than one file', async () => {
    const backupDir = resolve(dir, 'backups');
    await runBackup(db, backupDir);
    await new Promise((r) => setTimeout(r, 5));
    await runBackup(db, backupDir);

    const files = readdirSync(backupDir).filter((f) => f.endsWith('.sqlite'));
    expect(files.length).toBe(2);
  });

  it('creates the backup directory if it does not exist', async () => {
    const nested = resolve(dir, 'deep', 'nested', 'backups');
    await runBackup(db, nested);
    expect(existsSync(nested)).toBe(true);
  });
});
