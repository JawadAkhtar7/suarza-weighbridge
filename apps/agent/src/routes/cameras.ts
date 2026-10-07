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
  const { capture, cameras } = deps;

  /** What the operator screen asks before drawing anything. */
  app.get('/cameras', () => ({
    enabled: cameras?.enabled ?? false,
    views: cameras?.configuredViews() ?? [],
    live_fps: deps.config.CAMERA_LIVE_FPS,
  }));

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
    if (!capture) return { front: null, side: null };

    const record = deps.service.getBySlip(request.params.slip);
    if (!record) return reply.code(404).send({ error: { code: 'SLIP_NOT_FOUND' } });

    const latest = capture.repository().latestByView(record.id);
    return {
      front: latest.FRONT?.id ?? null,
      side: latest.SIDE?.id ?? null,
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
   * plain <img>, and transcoding on the operator PC would cost real CPU on
   * the machine that also has to weigh trucks. So the agent polls the
   * camera's still endpoint a few times a second and republishes the JPEGs as
   * a multipart stream — which <img src="..."> has understood since the
   * 1990s. No decoding, no transcoding: bytes in, bytes out.
   */
  app.get<{ Params: ViewParams }>('/camera/:view/live', async (request, reply) => {
    const view = parseView(request.params.view);
    if (!view || !cameras) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });

    const boundary = 'suarzaframe';
    const stream = new PassThrough();
    let stopped = false;

    const stop = () => {
      stopped = true;
      stream.end();
    };
    // Whichever end gives up first, the polling loop has to stop. Without
    // this it would keep hitting the camera for a tab that was closed.
    request.raw.on('close', stop);
    request.raw.on('aborted', stop);

    const intervalMs = Math.max(100, Math.round(1000 / deps.config.CAMERA_LIVE_FPS));

    void (async () => {
      while (!stopped) {
        const started = Date.now();
        const shot = await cameras.snapshot(view);

        if (stopped) break;
        if (shot) {
          stream.write(
            `--${boundary}\r\nContent-Type: image/jpeg\r\n` +
              `Content-Length: ${shot.body.byteLength}\r\n\r\n`,
          );
          stream.write(shot.body);
          stream.write('\r\n');
        }

        // Pace from the START of the request, not the end, so a camera that
        // takes 300 ms still yields the asked-for rate rather than drifting.
        const elapsed = Date.now() - started;
        if (elapsed < intervalMs) {
          await new Promise((done) => setTimeout(done, intervalMs - elapsed));
        }
      }
    })();

    return reply
      .header('content-type', `multipart/x-mixed-replace; boundary=${boundary}`)
      .header('cache-control', 'no-store')
      .header('connection', 'close')
      .send(stream);
  });
}
