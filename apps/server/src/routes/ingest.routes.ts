/** POST /ingest — the agent's outbox destination (brief §7.4, §13-M5). */

import express, { Router } from 'express';
import { ingestRequestSchema } from '@suarza/shared';
import { requireApiKey } from '../middleware/api-key.js';
import { ingest } from '../services/ingest.service.js';
import { storeCapture } from '../services/capture.service.js';
import { parse } from './helpers.js';

export function ingestRouter(apiKey: string): Router {
  const router = Router();

  router.post('/ingest', requireApiKey(apiKey), async (req, res) => {
    const payload = parse(ingestRequestSchema, req.body);
    const result = await ingest(payload.weighments, payload.audit_entries, payload.station);

    // The agent marks exactly the ids it gets back as synced, so this response
    // is what stops a record being retried forever.
    res.json(result);
  });

  /**
   * One camera still, as raw JPEG bytes.
   *
   * The body is the image and the metadata rides in the query string. No
   * multipart: this carries exactly one file and five short strings, and a
   * form parser on both ends would be machinery for nothing.
   *
   * 4 MB is far above the ~23 KB these actually are — the cap is there so a
   * misconfigured camera sending a 12-megapixel frame is rejected rather than
   * quietly filling the droplet.
   */
  router.post(
    '/ingest/captures/:id',
    requireApiKey(apiKey),
    express.raw({ type: ['image/jpeg', 'application/octet-stream'], limit: '4mb' }),
    async (req, res) => {
      const body = req.body as Buffer;
      if (!Buffer.isBuffer(body) || body.byteLength === 0) {
        res.status(400).json({
          error: { code: 'VALIDATION_ERROR', message: 'Expected a JPEG body.' },
        });
        return;
      }

      /* Express types a query value as string | string[] — a repeated
         parameter arrives as an array, and taking the first would quietly
         accept a request nobody meant to send. Anything that is not a plain
         string is treated as absent. */
      const one = (value: unknown): string | undefined =>
        typeof value === 'string' ? value : undefined;

      const pass = one(req.query['pass']);
      const view = one(req.query['view']);
      const weighmentId = one(req.query['weighment_id']);
      const slipNumber = one(req.query['slip_number']);
      const takenAt = new Date(one(req.query['taken_at']) ?? '');

      if (
        !weighmentId ||
        !slipNumber ||
        (pass !== 'FIRST' && pass !== 'SECOND') ||
        (view !== 'FRONT' && view !== 'SIDE') ||
        Number.isNaN(takenAt.getTime())
      ) {
        res.status(400).json({
          error: { code: 'VALIDATION_ERROR', message: 'Missing or invalid image details.' },
        });
        return;
      }

      const id = one(req.params['id']);
      if (!id) {
        res.status(400).json({
          error: { code: 'VALIDATION_ERROR', message: 'Missing image id.' },
        });
        return;
      }

      await storeCapture({
        id,
        weighmentId,
        slipNumber,
        pass,
        view,
        takenAt,
        body,
      });

      // 200 and nothing else: the agent marks it synced on any success, and a
      // body would only be something else to get wrong.
      res.json({ stored: true });
    },
  );

  return router;
}
