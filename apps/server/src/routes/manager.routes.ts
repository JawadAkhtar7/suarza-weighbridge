/** Manager dashboard data (brief §9, §13-M5). */

import { Router } from 'express';
import {
  logQuerySchema,
  managerCashSchema,
  managerPocketQuerySchema,
  managerVoidWeighmentSchema,
  saveOperatorSchema,
  userReportQuerySchema,
  weighmentQuerySchema,
} from '@suarza/shared';
import { z } from 'zod';
import { requireAuth, requireCapability } from '../middleware/auth.js';
import { imagesForWeighment } from '../services/capture.service.js';
import { cameraFramingForStation } from '../services/station.service.js';
import { listWeighments, requireBySlip, suggestValues } from '../services/weighment.service.js';
import { getAnalytics } from '../services/analytics.service.js';
import { restoreWeighmentBySlip, voidWeighmentBySlip } from '../services/void-weighment.service.js';
import { listRoster, removeOperator, saveOperator } from '../services/roster.service.js';
import { listLogs } from '../services/log.service.js';
import { buildUserReport } from '../services/user-report.service.js';
import { managerPocket, recordManagerCash } from '../services/manager-cash.service.js';
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
   * Set a weighing aside, or bring it back.
   *
   * ADMIN only, not every manager: a void takes a weighing out of the day's
   * takings, and the capability that already means "may change how the yard
   * is set up" is the right bar for that.
   *
   * The record stays either way — see void-weighment.service.ts for what
   * stops counting, and for the one thing remembered beyond the record so
   * the bridge cannot sync it back to life.
   */
  router.post<{ slip: string }>(
    '/weighments/:slip/void',
    requireAuth(jwtSecret),
    requireCapability('settings'),
    async (req, res) => {
      const input = parse(managerVoidWeighmentSchema, req.body ?? {});
      const weighment = await voidWeighmentBySlip(
        req.params.slip,
        input.reason,
        req.user?.username ?? 'unknown',
      );
      res.json({ weighment });
    },
  );

  router.post<{ slip: string }>(
    '/weighments/:slip/restore',
    requireAuth(jwtSecret),
    requireCapability('settings'),
    async (req, res) => {
      const weighment = await restoreWeighmentBySlip(
        req.params.slip,
        req.user?.username ?? 'unknown',
      );
      res.json({ weighment });
    },
  );

  /*
   * --- The roster, and the log ---------------------------------------------
   *
   * Under `/api/`, like the ledger and for exactly the same reason: the
   * manager app has pages called /operators and /logs, and an API route that
   * shares a page's path shadows it. A browser refresh on the Operators
   * screen would be answered by this router — with a 401 if the token is not
   * in the header, which a page load has no way to put there — instead of by
   * the app. Namespacing is what keeps the two from ever colliding.
   */

  /** Everyone who may sign in at the weighbridge. */
  router.get('/api/operators', ...guard, async (_req, res) => {
    res.json(await listRoster());
  });

  /**
   * Add somebody, or change them.
   *
   * One route for both, because they differ in one thing — whether the body
   * carries an id — and two routes would mean two copies of the username
   * check and the hashing behind it.
   */
  router.post(
    '/api/operators',
    requireAuth(jwtSecret),
    requireCapability('settings'),
    async (req, res) => {
      const input = parse(saveOperatorSchema, req.body);
      const saved = await saveOperator(input);
      res.status(input.id ? 200 : 201).json(saved);
    },
  );

  router.delete<{ id: string }>(
    '/api/operators/:id',
    requireAuth(jwtSecret),
    requireCapability('settings'),
    async (req, res) => {
      await removeOperator(req.params.id);
      res.status(204).end();
    },
  );

  /**
   * One person's account of a stretch of time.
   *
   * Behind the dashboard guard like the log beside it: every figure in it
   * is counted from records a manager can already read, gathered into the
   * questions they actually ask — how many trucks, how much money, and
   * which of it changed hands.
   */
  router.get('/api/reports/user', ...guard, async (req, res) => {
    res.json(await buildUserReport(parse(userReportQuerySchema, req.query)));
  });

  /**
   * The manager's own pocket, and the movements behind it.
   *
   * Keyed on the signed-in manager: two of them keep two pockets, which is
   * what anybody would expect of a pocket. Behind the dashboard guard, like
   * everything else that only reads.
   */
  router.get('/api/manager/pocket', ...guard, async (req, res) => {
    const query = parse(managerPocketQuerySchema, req.query);
    res.json(
      await managerPocket(
        { username: req.user?.username ?? 'unknown', displayName: req.user?.display_name ?? '' },
        new Date(query.from),
        new Date(query.to),
      ),
    );
  });

  /**
   * Write down a movement from the manager's side.
   *
   * The same guard as reading it: this records what already happened in the
   * yard rather than changing how the yard is set up, and a manager who can
   * see the pocket is the person holding it.
   */
  router.post('/api/manager/cash', ...guard, async (req, res) => {
    const input = parse(managerCashSchema, req.body);
    await recordManagerCash(
      { username: req.user?.username ?? 'unknown', displayName: req.user?.display_name ?? '' },
      input,
    );
    res.status(201).json({ recorded: true });
  });

  /**
   * The log: shifts starting and ending, slips set aside and brought back.
   *
   * Behind the dashboard guard rather than the settings one. It is a record
   * of what happened, which anyone who can read the dashboard can already
   * work out from the records themselves; what it is not is a thing anybody
   * can write to from here.
   */
  router.get('/api/logs', ...guard, async (req, res) => {
    res.json(await listLogs(parse(logQuerySchema, req.query)));
  });

  /** Typeahead for the dashboard's customer, company and plate filters. */
  const suggestQuerySchema = z.object({
    field: z.enum(['customer_name', 'customer_company', 'vehicle_plate']),
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
