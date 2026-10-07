/**
 * Where this weighbridge sends its records.
 *
 * In code on purpose, not in `.env`.
 *
 * The weighbridge PC is hundreds of kilometres away and nobody can walk up to
 * it to edit a file. A value kept here travels with the software: change it,
 * push, and the operator pressing "Update Weighbridge" picks it up like any
 * other change. A value kept in `.env` would need a site visit.
 *
 * `.env` stays for what is genuinely about THAT machine - which COM port the
 * indicator is on, and little else.
 */

/** The cloud API. Empty disables sync entirely and records simply queue. */
export const CLOUD_API_URL = 'https://manager.147-182-184-238.sslip.io';

/** Must match INGEST_API_KEY on the cloud server, or every sync is rejected. */
export const CLOUD_API_KEY = '26748deb31e29caa7f93d5a6f981b39f0c387d62310b46c0';

/**
 * Development override.
 *
 * Only `.env` on a developer's machine sets these, which is how `pnpm dev`
 * points at a local server without the production address ever being edited -
 * and therefore without localhost being pushed to the weighbridge by accident.
 * The operator PC has no such entries, so the values above are what it uses.
 */
/**
 * The value that switches sync off.
 *
 * A word, not an empty string, and that is the whole point. Blank entries
 * must keep falling through to the constants above: a `.env` copied from the
 * example with its lines emptied out would otherwise disable sync on the
 * weighbridge PC silently, and nobody would notice until a month of records
 * had piled up locally. Switching sync off has to be something somebody
 * typed on purpose.
 */
export const CLOUD_DISABLED = 'none';

export function cloudSettings(env: NodeJS.ProcessEnv = process.env): {
  url: string;
  apiKey: string;
} {
  const url = env['CLOUD_API_URL']?.trim();

  // The preview droplet runs a second operator app purely to check slip
  // layouts. Its practice weighings must never reach the real records, so it
  // sets CLOUD_API_URL=none and syncs nowhere.
  if (url?.toLowerCase() === CLOUD_DISABLED) {
    return { url: '', apiKey: '' };
  }

  return {
    url: url || CLOUD_API_URL,
    apiKey: env['CLOUD_API_KEY']?.trim() || CLOUD_API_KEY,
  };
}

// ---------------------------------------------------------------------------
// Cameras
// ---------------------------------------------------------------------------

/**
 * The two cameras watching the bridge.
 *
 * In code, for the same reason the cloud address is: the weighbridge PC is
 * hundreds of kilometres away and nobody can walk up to it to edit a file.
 * Change these, push, and the operator pressing "Update Weighbridge" picks
 * them up like any other change.
 *
 * These are Hikvision, whose stills live at
 *   http://<ip>/ISAPI/Streaming/channels/102/picture
 * where 102 is the sub-stream — 640x360 at roughly 23 KB, which is within 2%
 * of what the slip's photo box needs at 300 dpi. The main stream (101) would
 * be four times the file for no more detail on paper.
 *
 * Empty disables a camera, and a bridge with none runs unchanged: every slip
 * simply prints the bundled placeholder.
 */
export const CAMERA_FRONT_URL = 'http://192.168.1.83/ISAPI/Streaming/channels/102/picture';
export const CAMERA_SIDE_URL = 'http://192.168.1.66/ISAPI/Streaming/channels/102/picture';
export const CAMERA_USERNAME = 'admin';
export const CAMERA_PASSWORD = 'Cctvins247';

/**
 * Short on purpose. A camera that is slow or unplugged must never hold up a
 * truck on the bridge — the weighing is saved either way, and the slip prints
 * the placeholder.
 */
export const CAMERA_TIMEOUT_MS = 2500;

/** Frames a second for the operator's live view. */
export const CAMERA_LIVE_FPS = 3;

/** Where stills are kept, relative to the agent folder. */
export const CAPTURE_PATH = './data/captures';

/** Local stills older than this are pruned once the cloud has them. */
export const CAPTURE_KEEP_DAYS = 60;

export interface CameraSettings {
  frontUrl: string;
  sideUrl: string;
  username: string;
  password: string;
  timeoutMs: number;
  liveFps: number;
  capturePath: string;
  keepDays: number;
}

/**
 * The camera settings this machine should use.
 *
 * Same shape as `cloudSettings`: only a developer's own `.env` overrides
 * anything, so a laptop can point at a webcam bridge or a mock without the
 * site's addresses being edited. The weighbridge PC sets none of these and
 * therefore uses the constants above.
 */
export function cameraSettings(env: NodeJS.ProcessEnv = process.env): CameraSettings {
  const number = (raw: string | undefined, fallback: number) => {
    const parsed = Number(raw);
    return raw !== undefined && Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  };

  return {
    frontUrl: env['CAMERA_FRONT_URL']?.trim() || CAMERA_FRONT_URL,
    sideUrl: env['CAMERA_SIDE_URL']?.trim() || CAMERA_SIDE_URL,
    username: env['CAMERA_USERNAME']?.trim() || CAMERA_USERNAME,
    password: env['CAMERA_PASSWORD']?.trim() || CAMERA_PASSWORD,
    timeoutMs: number(env['CAMERA_TIMEOUT_MS'], CAMERA_TIMEOUT_MS),
    liveFps: number(env['CAMERA_LIVE_FPS'], CAMERA_LIVE_FPS),
    capturePath: env['CAPTURE_PATH']?.trim() || CAPTURE_PATH,
    keepDays: number(env['CAPTURE_KEEP_DAYS'], CAPTURE_KEEP_DAYS),
  };
}
