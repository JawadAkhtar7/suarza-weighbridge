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

  return router;
}
