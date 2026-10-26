/**
 * Customers and vehicle types: managed by the manager, pulled by the bridge.
 *
 * Two audiences, two guards, on purpose. The management routes take a manager's
 * JWT; the sync routes take the weighbridge's ingest API key, because the agent
 * is a machine with no login and must never need one. That is also why the sync
 * routes are read-only: the key that lets a bridge fetch the rate card must not
 * also let it rewrite the customer list.
 */

import { Router } from 'express';
import {
  createCustomerSchema,
  operatorLogPushSchema,
  shiftCashPushSchema,
  createVehicleTypeSchema,
  updateCustomerSchema,
  updateVehicleTypeSchema,
} from '@suarza/shared';
import { requireAuth, requireCapability } from '../middleware/auth.js';
import { requireApiKey } from '../middleware/api-key.js';
import {
  createCustomer,
  createVehicleType,
  customersForSync,
  deleteCustomer,
  deleteVehicleType,
  listCustomerRecords,
  listVehicleTypes,
  updateCustomer,
  updateVehicleType,
  vehicleTypesForSync,
} from '../services/catalogue.service.js';
import { operatorAccountsForSync } from '../services/roster.service.js';
import { recordLogs } from '../services/log.service.js';
import { recordShiftCash } from '../services/shift-cash.service.js';
import { parse } from './helpers.js';

export function catalogueRouter(jwtSecret: string, apiKey: string): Router {
  const router = Router();
  const guard = [requireAuth(jwtSecret), requireCapability('ledger')] as const;

  // --- Customers, for the manager ------------------------------------------

  router.get('/api/customers', ...guard, async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q : undefined;
    res.json({ customers: await listCustomerRecords({ q }) });
  });

  router.post('/api/customers', ...guard, async (req, res) => {
    res.status(201).json({ customer: await createCustomer(parse(createCustomerSchema, req.body)) });
  });

  router.patch<{ id: string }>('/api/customers/:id', ...guard, async (req, res) => {
    const input = parse(updateCustomerSchema, req.body);
    res.json({ customer: await updateCustomer(req.params.id, input) });
  });

  router.delete<{ id: string }>('/api/customers/:id', ...guard, async (req, res) => {
    res.json({ customer: await deleteCustomer(req.params.id) });
  });

  // --- Vehicle types, for the manager --------------------------------------

  router.get('/api/vehicle-types', ...guard, async (_req, res) => {
    res.json({ vehicle_types: await listVehicleTypes() });
  });

  router.post('/api/vehicle-types', ...guard, async (req, res) => {
    const input = parse(createVehicleTypeSchema, req.body);
    res.status(201).json({ vehicle_type: await createVehicleType(input) });
  });

  router.patch<{ id: string }>('/api/vehicle-types/:id', ...guard, async (req, res) => {
    const input = parse(updateVehicleTypeSchema, req.body);
    res.json({ vehicle_type: await updateVehicleType(req.params.id, input) });
  });

  router.delete<{ id: string }>('/api/vehicle-types/:id', ...guard, async (req, res) => {
    res.json({ vehicle_type: await deleteVehicleType(req.params.id) });
  });

  // --- What a weighbridge pulls --------------------------------------------

  router.get('/api/sync/customers', requireApiKey(apiKey), async (_req, res) => {
    res.json({ customers: await customersForSync(), synced_at: new Date().toISOString() });
  });

  router.get('/api/sync/vehicle-types', requireApiKey(apiKey), async (_req, res) => {
    res.json({ vehicle_types: await vehicleTypesForSync(), synced_at: new Date().toISOString() });
  });

  /**
   * The operator accounts, so a shift can start at a bridge with no internet.
   *
   * Password hashes cross here, which is why it is behind the ingest key and
   * nothing else: the weighbridge is a machine with no login, and the whole
   * reason it holds these is to answer at 6am when the link is down.
   */
  router.get('/api/sync/operators', requireApiKey(apiKey), async (_req, res) => {
    res.json({ operators: await operatorAccountsForSync(), synced_at: new Date().toISOString() });
  });

  /**
   * Shift events on their way up.
   *
   * The bridge is the only machine that knows a shift has started, so this is
   * the one log route that is written to rather than read. The entries carry
   * their own ids and are upserted, so a batch delivered twice records one
   * shift, not two.
   */
  router.post('/api/sync/operator-logs', requireApiKey(apiKey), async (req, res) => {
    const input = parse(operatorLogPushSchema, req.body);
    const written = await recordLogs(
      input.entries.map((entry) => ({
        id: entry.id,
        kind: entry.kind,
        at: entry.at,
        actor: entry.username,
        actor_name: entry.name || entry.username,
        role: entry.role,
        subject: null,
        detail: entry.detail,
        session_id: entry.session_id,
      })),
    );
    res.json({ accepted: input.entries.map((entry) => entry.id), written });
  });

  /**
   * The money written down during a shift.
   *
   * Its own route beside the shift events, because a movement can be
   * recorded hours after the shift began and must not wait for one. Upserted
   * on the bridge's own ids, so a batch delivered twice records one
   * movement.
   */
  router.post('/api/sync/shift-cash', requireApiKey(apiKey), async (req, res) => {
    const input = parse(shiftCashPushSchema, req.body);
    await recordShiftCash(input.entries);
    res.json({ accepted: input.entries.map((entry) => entry.id) });
  });

  return router;
}
