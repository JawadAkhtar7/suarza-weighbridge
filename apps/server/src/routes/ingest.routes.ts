/** POST /ingest — the agent's outbox destination (brief §7.4, §13-M5). */

import { Router } from 'express';
import { ingestRequestSchema } from '@suarza/shared';
import { requireApiKey } from '../middleware/api-key.js';
import { ingest } from '../services/ingest.service.js';
import { parse } from './helpers.js';

export function ingestRouter(apiKey: string): Router {
  const router = Router();

  router.post('/ingest', requireApiKey(apiKey), async (req, res) => {
    const payload = parse(ingestRequestSchema, req.body);
    const result = await ingest(payload.weighments, payload.audit_entries);

    // The agent marks exactly the ids it gets back as synced, so this response
    // is what stops a record being retried forever.
    res.json(result);
  });

  return router;
}
