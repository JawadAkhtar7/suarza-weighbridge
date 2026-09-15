/**
 * Ledger API — the money side, manager and admin only.
 *
 * Every route is guarded individually rather than with `router.use`: mounting
 * a blanket guard on this router once cost us a 401 on the public receipt page,
 * and the same mistake here would put a login in front of a driver's QR code.
 *
 * Mounted under `/api` — unlike the older routes, which sit at the root — so it
 * cannot collide with the dashboard's own `/ledger` page. It did: refreshing
 * the browser on /ledger was answered by the API with "No route for GET
 * /ledger" instead of the app, because the dev proxy could not tell a page
 * request from an API one. A separate namespace makes that impossible for this
 * and for every page added later.
 */

import { Router } from 'express';
import {
  createLedgerCustomerSchema,
  createLedgerEntrySchema,
  ledgerQuerySchema,
  voidLedgerEntrySchema,
} from '@suarza/shared';
import { requireAuth, requireCapability } from '../middleware/auth.js';
import {
  addEntry,
  ensureCustomer,
  getCustomer,
  listCustomers,
  listEntries,
  summary,
  voidEntry,
} from '../services/ledger.service.js';
import { parse } from './helpers.js';

export function ledgerRouter(jwtSecret: string): Router {
  const router = Router();
  const guard = [requireAuth(jwtSecret), requireCapability('ledger')] as const;

  router.get('/api/ledger/summary', ...guard, async (_req, res) => {
    res.json(await summary());
  });

  router.get('/api/ledger/customers', ...guard, async (req, res) => {
    res.json(await listCustomers(parse(ledgerQuerySchema, req.query)));
  });

  /** Opens an account before the customer has been weighed, for an advance. */
  router.post('/api/ledger/customers', ...guard, async (req, res) => {
    const input = parse(createLedgerCustomerSchema, req.body);
    const customer = await ensureCustomer({
      name: input.name,
      company: input.company,
      phone: input.phone ?? null,
    });
    res.status(201).json({ customer });
  });

  router.get<{ id: string }>('/api/ledger/customers/:id', ...guard, async (req, res) => {
    const [customer, entries] = await Promise.all([
      getCustomer(req.params.id),
      listEntries(req.params.id),
    ]);
    res.json({ customer, entries });
  });

  router.post<{ id: string }>('/api/ledger/customers/:id/entries', ...guard, async (req, res) => {
    const input = parse(createLedgerEntrySchema, req.body);
    const entry = await addEntry(req.params.id, input, req.user?.username ?? 'unknown');
    // The balance moved, so it is returned with the entry — the screen would
    // otherwise have to ask again to show the figure that just changed.
    res.status(201).json({ entry, customer: await getCustomer(req.params.id) });
  });

  router.post<{ id: string; entryId: string }>(
    '/api/ledger/customers/:id/entries/:entryId/void',
    ...guard,
    async (req, res) => {
      const input = parse(voidLedgerEntrySchema, req.body);
      const entry = await voidEntry(req.params.entryId, input.reason, req.user?.username ?? 'unknown');
      res.json({ entry, customer: await getCustomer(req.params.id) });
    },
  );

  return router;
}
