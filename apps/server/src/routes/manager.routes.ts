/** Manager dashboard data (brief §9, §13-M5). */

import { Router } from 'express';
import { weighmentQuerySchema } from '@suarza/shared';
import { z } from 'zod';
import { requireAuth, requireCapability } from '../middleware/auth.js';
import { listWeighments, requireBySlip, suggestValues } from '../services/weighment.service.js';
import { getAnalytics } from '../services/analytics.service.js';
import { parse } from './helpers.js';

export function managerRouter(jwtSecret: string): Router {
  const router = Router();

  // Attached per route, NOT via `router.use`. This router is mounted without a
  // path prefix, so a router-level guard would run for every request that
  // reaches it — including the public QR receipt routes, which would then
  // demand a token from a driver holding a paper slip.
  // Spread at each call site — passing the array directly loses Express's
  // request/response type inference.
  const guard = [requireAuth(jwtSecret), requireCapability('dashboard')] as const;

  router.get('/weighments', ...guard, async (req, res) => {
    const query = parse(weighmentQuerySchema, req.query);
    res.json(await listWeighments(query));
  });

  router.get<{ slip: string }>('/weighments/:slip', ...guard, async (req, res) => {
    res.json({ weighment: await requireBySlip(req.params.slip) });
  });

  /** Typeahead for the dashboard's customer and company filters. */
  const suggestQuerySchema = z.object({
    field: z.enum(['customer_name', 'customer_company']),
    q: z.string().max(120).default(''),
    limit: z.coerce.number().int().min(1).max(25).default(10),
  });

  router.get('/suggestions', ...guard, async (req, res) => {
    const query = parse(suggestQuerySchema, req.query);
    res.json({ values: await suggestValues(query.field, query.q, query.limit) });
  });

  router.get('/analytics', ...guard, async (req, res) => {
    const query = parse(weighmentQuerySchema, req.query);
    res.json(await getAnalytics(query));
  });

  return router;
}
