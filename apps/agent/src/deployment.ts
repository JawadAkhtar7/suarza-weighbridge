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
 *   http://<ip>/ISAPI/Streaming/channels/<channel>/picture
 * where 101 is the main stream and 102 the sub-stream.
 *
 * TWO URLS PER CAMERA, and the difference is the point:
 *
 *   still   channel 101, the main stream. About 1.25 MB of 4 MP frame. Far
 *           more than the slip's 62.8 mm photo box can print, and kept
 *           anyway because it is also the yard's record of what arrived —
 *           a number plate nobody can read later is worth nothing.
 *
 *   live    channel 102, the sub-stream, 640x360 at roughly 23 KB. The
 *           operator's panel polls this several times a second, so the main
 *           stream here would be some 7 MB a second across the bridge's
 *           switch for two cameras. That is not a disk-space question: it
 *           would stutter, and the live view exists to show the operator a
 *           truck moving onto the plate.
 *
 * And a VIDEO URL, which is what the live view actually uses now:
 *
 *   video   the main stream as RTSP video, which ffmpeg on this PC turns into
 *           1920-wide frames a few times a second (cameras/live-video.ts).
 *           The 640x360 stills went soft the moment the operator zoomed in
 *           to frame the slip's pictures. Snapshots cannot do better on these
 *           cameras: a large one takes 1-1.5 s, and while it is being taken
 *           the camera refuses every other snapshot — the slip's own picture
 *           included (measured on site, October 2026). Video does not go
 *           through the snapshot engine at all; the recorder already takes
 *           two streams from each camera the same way. The `live` stills
 *           remain the fallback when there is no ffmpeg or no video.
 *
 *           NOT channel 103. On these models (DS-2CD2083G2, DS-2CD2063G2)
 *           "103" is the main stream under another name: setting it sets the
 *           main stream, which the recorder records.
 *
 * Empty disables a camera, and a bridge with none runs unchanged: every slip
 * simply prints the bundled placeholder.
 */
/* .75, not .83: the front camera was replaced on site in October 2026 and the
   new unit came up on a different address. */
export const CAMERA_FRONT_URL = 'http://192.168.1.75/ISAPI/Streaming/channels/101/picture';
export const CAMERA_SIDE_URL = 'http://192.168.1.66/ISAPI/Streaming/channels/101/picture';
export const CAMERA_FRONT_LIVE_URL = 'http://192.168.1.75/ISAPI/Streaming/channels/102/picture';
export const CAMERA_SIDE_LIVE_URL = 'http://192.168.1.66/ISAPI/Streaming/channels/102/picture';
/* Credentials are added at run time, never written into these. */
export const CAMERA_FRONT_VIDEO_URL = 'rtsp://192.168.1.75:554/Streaming/Channels/101';
export const CAMERA_SIDE_VIDEO_URL = 'rtsp://192.168.1.66:554/Streaming/Channels/101';
export const CAMERA_USERNAME = 'admin';
export const CAMERA_PASSWORD = 'Cctvins247';

/**
 * Short on purpose. A camera that is slow or unplugged must never hold up a
 * truck on the bridge — the weighing is saved either way, and the slip prints
 * the placeholder.
 */
export const CAMERA_TIMEOUT_MS = 2500;

/** Frames a second for the operator's live view when it falls back to stills. */
export const CAMERA_LIVE_FPS = 3;

/**
 * The live video's frames: how many a second, and how wide.
 *
 * Five a second is smooth enough to watch a truck roll on. 1920 wide keeps a
 * 3x zoom of the preview sharp — the visible third is still 640 pixels — at
 * about 200 KB a frame, which only ever crosses this PC's own loopback.
 * Measured on this PC: about 16% of one core for the front camera's 4K and
 * 11% for the side, with the Intel graphics decoding.
 */
export const CAMERA_VIDEO_FPS = 5;
export const CAMERA_VIDEO_WIDTH = 1920;

/** Where stills are kept, relative to the agent folder. */
export const CAPTURE_PATH = './data/captures';

/** Local stills older than this are pruned once the cloud has them. */
export const CAPTURE_KEEP_DAYS = 60;

export interface CameraSettings {
  /** The main stream, stored and printed. */
  frontUrl: string;
  sideUrl: string;
  /** The sub-stream, for the operator's live panel only. */
  frontLiveUrl: string;
  sideLiveUrl: string;
  /** RTSP video for the live panel; empty falls back to polling the stills. */
  frontVideoUrl: string;
  sideVideoUrl: string;
  username: string;
  password: string;
  timeoutMs: number;
  liveFps: number;
  videoFps: number;
  videoWidth: number;
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
/**
 * A camera's video URL. `none` turns the video off (stills only). A developer
 * who has pointed the camera itself elsewhere — a webcam, a mock — does not
 * get the site's video by default: it would be the wrong camera, or none.
 */
function videoUrl(env: NodeJS.ProcessEnv, view: 'FRONT' | 'SIDE', site: string): string {
  const own = env[`CAMERA_${view}_VIDEO_URL`]?.trim();
  if (own) return own.toLowerCase() === 'none' ? '' : own;
  return env[`CAMERA_${view}_URL`]?.trim() ? '' : site;
}

export function cameraSettings(env: NodeJS.ProcessEnv = process.env): CameraSettings {
  const number = (raw: string | undefined, fallback: number) => {
    const parsed = Number(raw);
    return raw !== undefined && Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  };

  return {
    frontUrl: env['CAMERA_FRONT_URL']?.trim() || CAMERA_FRONT_URL,
    sideUrl: env['CAMERA_SIDE_URL']?.trim() || CAMERA_SIDE_URL,
    /* A developer who overrides only the still URL — pointing at a mock, or
       at a webcam — gets it for the live view too. One camera on a laptop is
       the ordinary case, and two separate overrides to say so is a trap. */
    frontLiveUrl:
      env['CAMERA_FRONT_LIVE_URL']?.trim() ||
      env['CAMERA_FRONT_URL']?.trim() ||
      CAMERA_FRONT_LIVE_URL,
    sideLiveUrl:
      env['CAMERA_SIDE_LIVE_URL']?.trim() || env['CAMERA_SIDE_URL']?.trim() || CAMERA_SIDE_LIVE_URL,
    frontVideoUrl: videoUrl(env, 'FRONT', CAMERA_FRONT_VIDEO_URL),
    sideVideoUrl: videoUrl(env, 'SIDE', CAMERA_SIDE_VIDEO_URL),
    username: env['CAMERA_USERNAME']?.trim() || CAMERA_USERNAME,
    password: env['CAMERA_PASSWORD']?.trim() || CAMERA_PASSWORD,
    timeoutMs: number(env['CAMERA_TIMEOUT_MS'], CAMERA_TIMEOUT_MS),
    liveFps: number(env['CAMERA_LIVE_FPS'], CAMERA_LIVE_FPS),
    videoFps: number(env['CAMERA_VIDEO_FPS'], CAMERA_VIDEO_FPS),
    videoWidth: number(env['CAMERA_VIDEO_WIDTH'], CAMERA_VIDEO_WIDTH),
    capturePath: env['CAPTURE_PATH']?.trim() || CAPTURE_PATH,
    keepDays: number(env['CAPTURE_KEEP_DAYS'], CAPTURE_KEEP_DAYS),
  };
}
