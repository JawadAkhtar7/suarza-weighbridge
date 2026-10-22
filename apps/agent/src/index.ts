/**
 * Agent entrypoint: the headless service that runs on the weighbridge PC.
 *
 * Boot order matters. The database opens first and the HTTP API starts last, so
 * the agent never accepts a save it has nowhere to put. The indicator and the
 * cloud are both allowed to fail — neither may stop the operator working,
 * because manual entry is always available and sync is always retried
 * (brief §3B, §7.3, §7.5, §11).
 */

import { cameraSettings, cloudSettings, settingsLogin } from './deployment.js';
import { loadConfig } from './config.js';
import { closeDatabase, openDatabase } from './db/connection.js';
import { UserRepository } from './db/users.js';
import { OperatorRepository } from './db/operators.js';
import { PendingCaptureStore } from './cameras/pending-captures.js';
import { WeighmentRepository } from './db/weighments.js';
import { AuditRepository } from './db/audit.js';
import { createWeightReader } from './indicator/index.js';
import { WeighmentService } from './services/weighment-service.js';
import { createCloudClient, SyncWorker } from './sync/index.js';
import { CatalogueSync } from './sync/catalogue-sync.js';
import { createRequire } from 'node:module';
import { CameraClient, type CameraView } from './cameras/camera-client.js';
import { LiveVideo } from './cameras/live-video.js';
import { CaptureService } from './cameras/capture-service.js';
import { SettingsService } from './services/settings-service.js';
import { BackupJob } from './backup.js';
import { buildServer } from './server.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const log = (message: string) => process.stdout.write(`${message}\n`);

  /* Where this weighbridge syncs to - in code so it can be changed by pushing
     rather than by visiting the site. See deployment.ts. */
  const cloud = cloudSettings();
  const cameraConfig = cameraSettings();

  const db = openDatabase({ path: config.DATABASE_PATH, verbose: log });

  /*
   * Who may change this station's settings.
   *
   * Seeded only on a station that has no users at all, so the password on a
   * machine that has been given its own is never reset by a deploy — see
   * UserRepository.seed.
   */
  const users = new UserRepository(db);
  const login = settingsLogin();
  if (users.seed(login.username, login.password)) {
    log(`Created the first settings login: ${login.username}`);
  }

  /* The operator accounts the manager keeps, and the shift somebody is in
     the middle of. The accounts arrive with the other lists; this machine
     only ever compares against them — see db/operators.ts. */
  const operators = new OperatorRepository(db);

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
    receipt_base_url: cloud.url,
  });

  // --- Sync worker ---------------------------------------------------------
  // Built before the service so every commit can trigger it. With no cloud URL
  // configured the agent runs purely offline, which is a valid way to work.
  /*
   * The cameras, from deployment.ts. Blank addresses disable them, which is
   * how a bridge with no cameras runs unchanged — every slip simply prints
   * the bundled placeholder.
   *
   * Built before the sync worker because the worker drains their stills.
   */
  const cameras = new CameraClient({
    frontUrl: cameraConfig.frontUrl,
    sideUrl: cameraConfig.sideUrl,
    frontLiveUrl: cameraConfig.frontLiveUrl,
    sideLiveUrl: cameraConfig.sideLiveUrl,
    username: cameraConfig.username,
    password: cameraConfig.password,
    timeoutMs: cameraConfig.timeoutMs,
    onLog: (level, message) => log(`[camera:${level}] ${message}`),
  });

  /*
   * Photographs are taken when the weight is, not when the weighing is saved
   * — by then the truck has often pulled off the bridge. This holds them in
   * between; see PendingCaptureStore.
   */
  const pendingCaptures = new PendingCaptureStore({
    cameras,
    onLog: (level, message) => log(`[camera:${level}] ${message}`),
  });

  const capture = new CaptureService({
    db,
    cameras,
    pending: pendingCaptures,
    directory: cameraConfig.capturePath,
    keepDays: cameraConfig.keepDays,
    onLog: (level, message) => log(`[camera:${level}] ${message}`),
  });

  if (capture.enabled) {
    log(`[camera:info] Watching with ${cameras.configuredViews().join(' and ')}`);
  } else {
    log('[camera:info] No cameras configured — slips print the placeholder');
  }

  /* The live panel's video, one per camera that has a video URL. Nothing runs
     until somebody opens the weighing screen. ffmpeg-static is CommonJS and
     exports the binary's path, or null on a platform it has no build for. */
  const ffmpegPath = createRequire(import.meta.url)('ffmpeg-static') as string | null;
  const liveVideo: Partial<Record<CameraView, LiveVideo>> = {};
  for (const [view, url] of [
    ['FRONT', cameraConfig.frontVideoUrl],
    ['SIDE', cameraConfig.sideVideoUrl],
  ] as const) {
    if (!url) continue;
    liveVideo[view] = new LiveVideo({
      url,
      username: cameraConfig.username,
      password: cameraConfig.password,
      fps: cameraConfig.videoFps,
      width: cameraConfig.videoWidth,
      ffmpegPath: process.env['FFMPEG_PATH']?.trim() || ffmpegPath,
      onLog: (level, message) => log(`[camera:${level}] ${view}: ${message}`),
    });
  }
  const videoViews = Object.entries(liveVideo).filter(([, video]) => video.available);
  log(
    videoViews.length > 0
      ? `[camera:info] Live view from video: ${videoViews.map(([view]) => view).join(' and ')}`
      : '[camera:info] Live view from stills (no ffmpeg or no video URL)',
  );

  let syncWorker: SyncWorker | null = null;

  if (cloud.url && cloud.apiKey) {
    syncWorker = new SyncWorker({
      weighments: new WeighmentRepository(db),
      audit: new AuditRepository(db),
      operatorLogs: {
        unsynced: (limit) => operators.unsyncedLogs(limit),
        markSynced: (ids) => operators.markLogsSynced(ids),
      },
      shiftCash: {
        unsynced: (limit) => operators.unsyncedCash(limit),
        markSynced: (ids) => operators.markCashSynced(ids),
      },
      client: createCloudClient({
        baseUrl: cloud.url,
        apiKey: cloud.apiKey,
        stationId: config.STATION_ID,
        // Read per send, so editing the address in Settings reaches the public
        // receipt page on the next sync rather than on the next restart.
        profile: () => settings.profile(),
      }),
      // Only when this bridge has cameras; otherwise the drain is skipped
      // rather than querying an empty table on every tick.
      captures: capture.enabled
        ? {
            unsynced: (limit) => capture.repository().unsynced(limit),
            markSynced: (ids) => capture.repository().markSynced(ids),
            read: (row) => capture.readFile(row),
          }
        : undefined,
      periodicMs: settings.get().sync_interval_seconds * 1000,
      profileVersion: () => settings.profile().updated_at,
      onLog: (level, message) => log(`[sync:${level}] ${message}`),
    });
    // A change to the station's settings — re-framing a camera, above all —
    // reaches the page behind the QR now, not with the next truck.
    settings.onChange(() => syncWorker?.requestSync());
  } else {
    log('[sync:info] Cloud sync disabled — no cloud address set in deployment.ts');
  }

  // The manager's lists, pulled on the operator's button. Absent with no cloud
  // configured, which is a valid way to run a bridge.
  const catalogueSync =
    cloud.url && cloud.apiKey
      ? new CatalogueSync({
          db,
          baseUrl: cloud.url,
          apiKey: cloud.apiKey,
        })
      : undefined;

  const service = new WeighmentService(db, {
    stationId: config.STATION_ID,
    onChange: () => syncWorker?.requestSync(),
    // Not awaited: the operator is at the window and the record is already
    // safe. The picture catches up on its own.
    onWeighed: (weighment, pass, sources) => void capture.capture(weighment, pass, sources),
  });

  const reader = createWeightReader(config, {
    onLog: (level, message) => log(`[indicator:${level}] ${message}`),
  });

  const app = await buildServer({
    config,
    reader,
    service,
    settings,
    users,
    operators,
    // A shift starting is worth telling the manager about now, not at the
    // next five-minute tick.
    onOperatorLog: () => syncWorker?.requestSync(),
    cameras,
    pendingCaptures,
    capture,
    liveVideo,
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
      cloud: cloud.url || '(disabled)',
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
    // ffmpeg would also end when its pipe closes, but not before it had
    // reconnected to the camera once more for nobody.
    for (const video of Object.values(liveVideo)) video.stop();
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
