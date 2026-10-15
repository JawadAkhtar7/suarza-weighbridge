/**
 * Camera routes: the stored stills, and a live view for the operator.
 *
 * Everything goes through the agent rather than the browser talking to the
 * cameras directly. Two reasons, both load-bearing: the camera password never
 * reaches a web page, and the browser never has to deal with the cameras'
 * digest auth or their total absence of CORS headers.
 */

import type { FastifyInstance } from 'fastify';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { PassThrough } from 'node:stream';
import type { AgentDeps } from '../server.js';
import { CAMERA_VIEWS, type CameraView } from '../cameras/camera-client.js';
import { cameraSettings } from '../deployment.js';

interface CaptureParams {
  id: string;
}
interface ViewParams {
  view: string;
}

function parseView(raw: string): CameraView | null {
  const upper = raw.toUpperCase();
  return (CAMERA_VIEWS as readonly string[]).includes(upper) ? (upper as CameraView) : null;
}

export function registerCameraRoutes(app: FastifyInstance, deps: AgentDeps): void {
  const { capture, cameras, pendingCaptures } = deps;

  /** What the operator screen asks before drawing anything. */
  app.get('/cameras', () => ({
    enabled: cameras?.enabled ?? false,
    views: cameras?.configuredViews() ?? [],
    live_fps: cameraSettings().liveFps,
  }));

  /**
   * Photograph the bridge NOW, and hold it for the save that follows.
   *
   * Called the moment the operator captures a weight — off the indicator or
   * typed by hand — because that is when the truck is on the plate. The save
   * comes a minute later, after a plate and a product and a customer have
   * been typed, by which time the bridge is often empty or holding the next
   * lorry.
   *
   * Answers at once with a token rather than waiting for two cameras: the
   * operator clicked a button and the screen has to respond. The pictures
   * arrive in the background and the save collects them.
   *
   * `capture_id: null` means this station has no cameras. The operator app
   * carries on and the slip prints the placeholder, exactly as before — a
   * weighing must never depend on a photograph.
   */
  app.post('/camera/capture', (request) => {
    const id = pendingCaptures?.start() ?? null;
    if (id) request.log.info({ capture_id: id }, 'Photographing the bridge for the next save');
    return { capture_id: id };
  });

  /**
   * Let go of pictures the operator will not be saving — a cleared capture.
   *
   * Housekeeping, not correctness: the store forgets a token by itself after
   * ten minutes. Doing it when we know keeps a busy morning from pushing a
   * live token out of a store full of abandoned ones.
   */
  app.delete<{ Params: { id: string } }>('/camera/capture/:id', (request) => {
    pendingCaptures?.discard(request.params.id);
    return { discarded: true };
  });

  /**
   * A stored still, by id. This is what the slip's <img> points at.
   *
   * A row whose file has gone — pruned, or a folder deleted by hand — is a
   * 404 rather than a 500: a missing picture is an ordinary state here, and
   * the slip simply falls back to the placeholder.
   */
  app.get<{ Params: CaptureParams }>('/captures/:id', async (request, reply) => {
    if (!capture) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });

    const row = capture.repository().byId(request.params.id);
    if (!row) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });

    const path = capture.absolutePath(row.path);
    try {
      await stat(path);
    } catch {
      return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
    }

    // Stored stills never change, so they can be cached hard. The id is
    // unique per picture, so a new picture is a new URL.
    return reply
      .header('content-type', 'image/jpeg')
      .header('cache-control', 'private, max-age=31536000, immutable')
      .send(createReadStream(path));
  });

  /**
   * Which stored stills belong to a slip.
   *
   * A separate call rather than fields on the weighment: the weighment schema
   * is shared by three tiers and a cloud that may hold records from a bridge
   * with no cameras at all. The slip asks for its pictures; a bridge with
   * none answers with nulls and the placeholder is drawn.
   */
  app.get<{ Params: { slip: string } }>('/weighments/:slip/captures', (request, reply) => {
    if (!capture) return { front: null, side: null, pending: false };

    const record = deps.service.getBySlip(request.params.slip);
    if (!record) return reply.code(404).send({ error: { code: 'SLIP_NOT_FOUND' } });

    const latest = capture.repository().latestByView(record.id);
    return {
      front: latest.FRONT?.id ?? null,
      side: latest.SIDE?.id ?? null,
      // The slip asks again while this is true rather than printing the
      // placeholder, or the previous pass's picture, a second too early.
      pending: capture.isPending(record.id),
    };
  });

  /** One frame, now. Useful for testing a camera from the Settings screen. */
  app.get<{ Params: ViewParams }>('/camera/:view/snapshot', async (request, reply) => {
    const view = parseView(request.params.view);
    if (!view || !cameras) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });

    const shot = await cameras.snapshot(view);
    if (!shot) {
      return reply
        .code(503)
        .send({ error: { code: 'CAMERA_UNREACHABLE', message: 'The camera did not answer.' } });
    }

    return reply
      .header('content-type', shot.contentType)
      .header('cache-control', 'no-store')
      .send(shot.body);
  });

  /**
   * Live view, as MJPEG.
   *
   * These cameras only offer H.264/H.265, which a browser cannot play from a
   * plain <img>. So the agent republishes JPEGs as a multipart stream, which
   * <img src="..."> has understood since the 1990s, from one of two sources:
   *
   *   video    the main stream's RTSP video, turned into 1920-wide frames by
   *            ffmpeg (cameras/live-video.ts) — sharp enough to zoom into.
   *   stills   the 640x360 sub-stream snapshot, polled a few times a second,
   *            when this PC has no ffmpeg or the video does not come.
   */
  app.get<{ Params: ViewParams }>('/camera/:view/live', async (request, reply) => {
    const view = parseView(request.params.view);
    if (!view || !cameras) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });

    const boundary = 'suarzaframe';
    const stream = new PassThrough();
    let stopped = false;
    let unsubscribe: (() => void) | null = null;
    let watchdog: NodeJS.Timeout | null = null;

    const stop = () => {
      if (stopped) return;
      stopped = true;
      unsubscribe?.();
      unsubscribe = null;
      if (watchdog) clearInterval(watchdog);
      stream.end();
    };
    // Whichever end gives up first, the source has to stop. Without this it
    // would keep pulling from the camera for a tab that was closed. The
    // RESPONSE is what reports a browser going away on a reply that never
    // ends; the request alone did not, and a closed tab kept its source.
    request.raw.on('close', stop);
    request.raw.on('aborted', stop);
    reply.raw.on('close', stop);

    const writeFrame = (body: Buffer) => {
      if (stopped) return;
      // A browser that has fallen behind gets the next frame, not a backlog:
      // a live view showing the past is worse than one that skips.
      if (stream.writableLength > 4 * 1024 * 1024) return;
      stream.write(
        `--${boundary}\r\nContent-Type: image/jpeg\r\nContent-Length: ${body.byteLength}\r\n\r\n`,
      );
      stream.write(body);
      stream.write('\r\n');
    };

    const pollStills = async () => {
      const intervalMs = Math.max(100, Math.round(1000 / cameraSettings().liveFps));
      while (!stopped) {
        const started = Date.now();
        // The sub-stream: small and quick, so polling it several times a
        // second neither floods the switch nor holds up the slip's picture.
        const shot = await cameras.snapshot(view, 'live');
        if (stopped) break;
        if (shot) writeFrame(shot.body);

        // Pace from the START of the request, not the end, so a camera that
        // takes 300 ms still yields the asked-for rate rather than drifting.
        const elapsed = Date.now() - started;
        if (elapsed < intervalMs) {
          await new Promise((done) => setTimeout(done, intervalMs - elapsed));
        }
      }
    };

    const video = deps.liveVideo?.[view];
    if (video?.available) {
      /* The newest frame first, if it is recent: a viewer arriving while the
         video already runs should not wait for the next one to see anything. */
      if (video.latestFrame && Date.now() - video.latestFrameAt < 2000) {
        writeFrame(video.latestFrame);
      }
      let lastFrameAt = Date.now();
      unsubscribe = video.subscribe((frame) => {
        lastFrameAt = Date.now();
        writeFrame(frame);
      });
      /* No frame for ten seconds — ffmpeg will not start, or the camera's
         video has gone — and this viewer falls back to the stills rather
         than staring at a frozen picture. The video keeps retrying for
         anyone who opens the screen later. */
      watchdog = setInterval(() => {
        if (stopped || Date.now() - lastFrameAt < 10_000) return;
        clearInterval(watchdog!);
        watchdog = null;
        unsubscribe?.();
        unsubscribe = null;
        request.log.warn({ view }, 'No live video; falling back to stills');
        void pollStills();
      }, 2000);
    } else {
      void pollStills();
    }

    return reply
      .header('content-type', `multipart/x-mixed-replace; boundary=${boundary}`)
      .header('cache-control', 'no-store')
      .header('connection', 'close')
      .send(stream);
  });
}
