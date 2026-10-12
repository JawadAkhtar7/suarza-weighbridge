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
    expect(settings.print.paper_size).toBe('CUSTOM');
    expect(settings.auto_print).toBe(true);
    /* The company's details are deliberately NOT here: they are the same on
       every station and live in code, so there is nothing to default. */
    expect(settings).not.toHaveProperty('company_name');
  });

  it('seeds from the environment on a fresh install', () => {
    const settings = new SettingsService(db, { station_id: 'B', backup_path: '/tmp/x' }).get();
    expect(settings.station_id).toBe('B');
    expect(settings.backup_path).toBe('/tmp/x');
  });

  it('persists a change across a fresh read', () => {
    const service = new SettingsService(db);
    const current = service.get();
    service.replace({ ...current, receipt_base_url: 'https://weighbridge.example.com' });

    // A new instance, as a restarted agent would build.
    expect(new SettingsService(db).get().receipt_base_url).toBe(
      'https://weighbridge.example.com',
    );
  });

  it('normalises paper and alignment, which the operator can no longer edit', () => {
    // The controls were removed once the station settled on A5 pads. A value
    // stored by an older version must not survive, or it would be stuck with
    // nothing in the app able to correct it.
    const service = new SettingsService(db);
    const current = service.get();
    service.replace({
      ...current,
      print: { ...current.print, paper_size: 'A4', offset_top_mm: 14, scale_percent: 80 },
    });

    const read = new SettingsService(db).get().print;
    expect(read.paper_size).toBe('CUSTOM');
    /* Whole-sheet offsets are normalised away again: moving everything to
       correct one element was tried on site and made the slip harder to
       judge, not easier. qr_offset_x_mm is the adjustment that survives. */
    expect(read.offset_top_mm).toBe(0);
    expect(read.scale_percent).toBe(100);
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
    expect(service.get().print.paper_size).toBe('CUSTOM');
  });

  it('keeps the weights where the details offset put them, on settings saved before they had their own', () => {
    // As the weighbridge PC stores it today: details calibrated, no weights
    // fields yet. Until now the weights moved with the details offset.
    db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)').run(
      'station_settings',
      JSON.stringify({ print: { details_offset_x_mm: 0.5, details_offset_y_mm: -2 } }),
    );

    const read = new SettingsService(db).get().print;
    expect(read.weights_offset_x_mm).toBe(0.5);
    expect(read.weights_offset_y_mm).toBe(-2);
    // ...the slip number, which moved with the details...
    expect(read.slip_number_offset_x_mm).toBe(0.5);
    expect(read.slip_number_offset_y_mm).toBe(-2);
    // ...and through the weights to both date/times, which moved with them.
    expect(read.first_time_offset_y_mm).toBe(-2);
    expect(read.second_time_offset_y_mm).toBe(-2);
  });

  it('starts each date/time where the old shared date/time group put them', () => {
    // As the weighbridge PC stores it now: one figure for both date/times,
    // tuned on site, and nothing yet for either on its own.
    db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)').run(
      'station_settings',
      JSON.stringify({
        print: {
          details_offset_x_mm: 0,
          details_offset_y_mm: -2,
          weights_offset_x_mm: 0,
          weights_offset_y_mm: 0,
          weight_times_offset_x_mm: 0,
          weight_times_offset_y_mm: -1,
        },
      }),
    );

    const read = new SettingsService(db).get().print;
    expect([read.first_time_offset_x_mm, read.first_time_offset_y_mm]).toEqual([0, -1]);
    expect([read.second_time_offset_x_mm, read.second_time_offset_y_mm]).toEqual([0, -1]);
    expect([read.slip_number_offset_x_mm, read.slip_number_offset_y_mm]).toEqual([0, -2]);
  });

  it('moves each date/time and the slip number on its own once saved', () => {
    const service = new SettingsService(db);
    const current = service.get();
    service.replace({
      ...current,
      print: {
        ...current.print,
        first_time_offset_y_mm: -0.75,
        second_time_offset_y_mm: -1.25,
        slip_number_offset_x_mm: 0.5,
      },
    });

    const read = new SettingsService(db).get().print;
    expect(read.first_time_offset_y_mm).toBe(-0.75);
    expect(read.second_time_offset_y_mm).toBe(-1.25);
    expect(read.slip_number_offset_x_mm).toBe(0.5);
    expect(read.details_offset_x_mm).toBe(0);
  });

  it('moves the details and the weights independently once both are saved', () => {
    const service = new SettingsService(db);
    const current = service.get();
    service.replace({
      ...current,
      print: { ...current.print, details_offset_y_mm: -3, weights_offset_y_mm: 0 },
    });

    const read = new SettingsService(db).get().print;
    expect(read.details_offset_y_mm).toBe(-3);
    // Saved as 0, and stays 0: the carry-over is only for older blobs.
    expect(read.weights_offset_y_mm).toBe(0);
  });

  it('starts the front framing from the zoom saved before the front view could be panned', () => {
    db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)').run(
      'station_settings',
      JSON.stringify({ front_view_zoom: 1.6 }),
    );

    const service = new SettingsService(db);
    expect(service.get().front_view_frame).toEqual({ zoom: 1.6, x: 0, y: 0 });
    // ...and keeps telling a cloud that predates framing the same zoom.
    expect(service.profile().front_view_zoom).toBe(1.6);
  });

  it('never sends a cloud from before framing a front zoom it would reject', () => {
    const service = new SettingsService(db);
    service.replace({ ...service.get(), front_view_frame: { zoom: 8, x: 0, y: 0 } });
    const profile = new SettingsService(db).profile();
    expect(profile.front_view_frame?.zoom).toBe(8);
    expect(profile.front_view_zoom).toBe(3);
  });

  it('keeps a front framing once it has been saved', () => {
    const service = new SettingsService(db);
    service.replace({ ...service.get(), front_view_frame: { zoom: 2, x: 0.2, y: -0.1 } });

    const read = new SettingsService(db);
    expect(read.get().front_view_frame).toEqual({ zoom: 2, x: 0.2, y: -0.1 });
    expect(read.profile().front_view_frame).toEqual({ zoom: 2, x: 0.2, y: -0.1 });
  });

  it('falls back to defaults if the stored blob is unreadable', () => {
    // Weighing must keep working; settings can be fixed afterwards.
    db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)').run('station_settings', '{not json');
    expect(new SettingsService(db).get().print.paper_size).toBe('CUSTOM');
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
    expect(row).toEqual({ slip_number: '20261', first_weight_kg: 8000 });
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
