/** Manager dashboard data (brief §9, §13-M5). */

import { Router } from 'express';
import { createOperatorSchema, shiftTimingsSchema, weighmentQuerySchema } from '@suarza/shared';
import { z } from 'zod';
import { requireAuth, requireCapability } from '../middleware/auth.js';
import { imagesForWeighment } from '../services/capture.service.js';
import { cameraFramingForStation } from '../services/station.service.js';
import { listWeighments, requireBySlip, suggestValues } from '../services/weighment.service.js';
import { getAnalytics } from '../services/analytics.service.js';
import { deleteWeighmentBySlip } from '../services/delete-weighment.service.js';
import {
  listRoster,
  removeOperator,
  setOperator,
  setShiftTimings,
} from '../services/roster.service.js';
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

  /**
   * The camera stills for a weighing, so the manager's copy of the slip shows
   * the same truck the customer's does.
   *
   * Behind the dashboard guard, while the images themselves are served
   * publicly at /captures/:id — a driver scanning his own slip has no login,
   * but nobody without one should be able to enumerate what was weighed.
   */
  router.get<{ slip: string }>('/weighments/:slip/captures', ...guard, async (req, res) => {
    const weighment = await requireBySlip(req.params.slip);
    /* The station's crop travels with the pictures rather than from an
       endpoint of its own: it is not a fact about the station the manager
       might browse, it is how to draw these two images. Sending them apart
       invites a preview that crops differently from the slip it previews. */
    const framing = await cameraFramingForStation(weighment.station_id);
    res.json({
      ...(await imagesForWeighment(weighment.id)),
      front_view_frame: framing.front,
      side_view_frame: framing.side,
      /* For a dashboard build that predates front framing. */
      front_view_zoom: framing.front.zoom,
    });
  });

  /**
   * Delete a weighing, and everything joined to it.
   *
   * ADMIN only, not every manager: this removes a record of money taken, and
   * the capability that already means "may change how the yard is set up" is
   * the right bar for it.
   *
   * See delete-weighment.service.ts for what goes and for the one thing kept
   * — the id, so the bridge cannot sync it back.
   */
  router.delete<{ slip: string }>(
    '/weighments/:slip',
    requireAuth(jwtSecret),
    requireCapability('settings'),
    async (req, res) => {
      const summary = await deleteWeighmentBySlip(req.params.slip, req.user?.username ?? 'unknown');
      res.json(summary);
    },
  );

  // --- The roster: who is on which shift ------------------------------------

  /** Read by the dashboard's filter as well as the Operators screen. */
  router.get('/operators', ...guard, async (_req, res) => {
    res.json(await listRoster());
  });

  /**
   * Put somebody on a shift. Replaces whoever was on it — a yard runs one
   * person per shift, and naming a second plainly means the first has left.
   */
  router.post(
    '/operators',
    requireAuth(jwtSecret),
    requireCapability('settings'),
    async (req, res) => {
      const input = parse(createOperatorSchema, req.body);
      res.status(201).json(await setOperator(input));
    },
  );

  router.delete<{ id: string }>(
    '/operators/:id',
    requireAuth(jwtSecret),
    requireCapability('settings'),
    async (req, res) => {
      await removeOperator(req.params.id);
      res.status(204).end();
    },
  );

  router.put(
    '/shift-timings',
    requireAuth(jwtSecret),
    requireCapability('settings'),
    async (req, res) => {
      const input = parse(shiftTimingsSchema, req.body);
      res.json(await setShiftTimings(input));
    },
  );

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
