/**
 * Agent entrypoint: the headless service that runs on the weighbridge PC.
 *
 * Boot order matters. The database opens first and the HTTP API starts last, so
 * the agent never accepts a save it has nowhere to put. The indicator and the
 * cloud are both allowed to fail — neither may stop the operator working,
 * because manual entry is always available and sync is always retried
 * (brief §3B, §7.3, §7.5, §11).
 */

import { loadConfig } from './config.js';
import { closeDatabase, openDatabase } from './db/connection.js';
import { WeighmentRepository } from './db/weighments.js';
import { AuditRepository } from './db/audit.js';
import { createWeightReader } from './indicator/index.js';
import { WeighmentService } from './services/weighment-service.js';
import { createCloudClient, SyncWorker } from './sync/index.js';
import { CatalogueSync } from './sync/catalogue-sync.js';
import { SettingsService } from './services/settings-service.js';
import { BackupJob } from './backup.js';
import { buildServer } from './server.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const log = (message: string) => process.stdout.write(`${message}\n`);

  const db = openDatabase({ path: config.DATABASE_PATH, verbose: log });

  // Settings live in the database so a print calibration or an edited rate
  // card survives a browser profile being cleared (brief §13-M8).
  const settings = new SettingsService(db, {
    station_id: config.STATION_ID,
    sync_interval_seconds: config.SYNC_INTERVAL_SECONDS,
    backup_path: config.BACKUP_PATH,
    backup_interval_hours: config.BACKUP_INTERVAL_HOURS,
    // The public receipt page is served by the cloud API, on the same host the
    // agent already syncs to — so an unconfigured QR address defaults to it
    // instead of printing slips with no QR at all.
    receipt_base_url: config.CLOUD_API_URL,
  });

  // --- Sync worker ---------------------------------------------------------
  // Built before the service so every commit can trigger it. With no cloud URL
  // configured the agent runs purely offline, which is a valid way to work.
  let syncWorker: SyncWorker | null = null;

  if (config.CLOUD_API_URL && config.CLOUD_API_KEY) {
    syncWorker = new SyncWorker({
      weighments: new WeighmentRepository(db),
      audit: new AuditRepository(db),
      client: createCloudClient({
        baseUrl: config.CLOUD_API_URL,
        apiKey: config.CLOUD_API_KEY,
        stationId: config.STATION_ID,
        // Read per send, so editing the address in Settings reaches the public
        // receipt page on the next sync rather than on the next restart.
        profile: () => settings.profile(),
      }),
      periodicMs: settings.get().sync_interval_seconds * 1000,
      onLog: (level, message) => log(`[sync:${level}] ${message}`),
    });
  } else {
    log('[sync:info] Cloud sync disabled — no CLOUD_API_URL/CLOUD_API_KEY configured');
  }

  // The manager's lists, pulled on the operator's button. Absent with no cloud
  // configured, which is a valid way to run a bridge.
  const catalogueSync =
    config.CLOUD_API_URL && config.CLOUD_API_KEY
      ? new CatalogueSync({
          db,
          baseUrl: config.CLOUD_API_URL,
          apiKey: config.CLOUD_API_KEY,
        })
      : undefined;

  const service = new WeighmentService(db, {
    stationId: config.STATION_ID,
    onChange: () => syncWorker?.requestSync(),
  });

  const reader = createWeightReader(config, {
    onLog: (level, message) => log(`[indicator:${level}] ${message}`),
  });

  const app = await buildServer({
    config,
    reader,
    service,
    settings,
    catalogueSync,
    syncStatus: syncWorker ?? undefined,
    serveOperatorWeb: config.SERVE_OPERATOR_WEB,
  });

  // Backups follow the settings, not the environment, so an operator can point
  // them at a USB stick without editing a .env file.
  const current = settings.get();
  const backup = new BackupJob({
    db,
    directory: current.backup_path || config.BACKUP_PATH,
    intervalHours: current.backup_interval_hours,
    onLog: (level, message) => log(`[backup:${level}] ${message}`),
  });

  try {
    await reader.start();
  } catch (error) {
    // Deliberately not fatal.
    app.log.error({ err: error }, 'Indicator failed to start — manual weight entry is available');
  }

  syncWorker?.start();
  backup.start();

  await app.listen({ port: config.PORT, host: config.HOST });
  app.log.info(
    {
      station_id: config.STATION_ID,
      indicator: reader.kind,
      database: config.DATABASE_PATH,
      cloud: config.CLOUD_API_URL || '(disabled)',
    },
    `Weighbridge agent listening on http://${config.HOST}:${config.PORT}`,
  );

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info({ signal }, 'Shutting down');
    syncWorker?.stop();
    backup.stop();
    await app.close();
    await reader.stop();
    // Last, so nothing can still be mid-write when the file is checkpointed.
    closeDatabase(db);
    process.exit(0);
  };

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => void shutdown(signal));
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`Agent failed to start: ${(error as Error).message}\n`);
  process.exit(1);
});
