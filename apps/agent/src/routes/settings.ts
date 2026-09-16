/** Station settings (brief §13-M8). */

import type { FastifyInstance } from 'fastify';
import type { AgentDeps } from '../server.js';
import { AppError } from '../errors.js';

export function registerSettingsRoutes(app: FastifyInstance, deps: AgentDeps): void {
  if (!deps.settings) return;
  const settings = deps.settings;

  app.get('/settings', () => settings.get());

  app.put('/settings', (request) => {
    const saved = settings.replace(request.body);
    request.log.info('Station settings updated');
    return saved;
  });

  /**
   * The manager-kept lists, pulled on demand.
   *
   * POST rather than GET: this changes what is on this machine, and a browser
   * or a service worker is entitled to replay a GET whenever it likes.
   */
  app.post('/sync/customers', async (request) => {
    if (!deps.catalogueSync) {
      throw new AppError('CLOUD_NOT_CONFIGURED', 'This weighbridge has no cloud configured.');
    }
    const outcome = await deps.catalogueSync.syncCustomers();
    request.log.info({ outcome }, 'Customers synced from the manager');
    return outcome;
  });

  app.post('/sync/vehicle-types', async (request) => {
    if (!deps.catalogueSync) {
      throw new AppError('CLOUD_NOT_CONFIGURED', 'This weighbridge has no cloud configured.');
    }
    const outcome = await deps.catalogueSync.syncVehicleTypes();
    request.log.info({ outcome }, 'Vehicle types synced from the manager');
    return outcome;
  });

  /** What the operator picks from, and when it was last pulled. */
  app.get('/vehicle-types', () => ({
    vehicle_types: deps.service.vehicleTypes(),
    last_synced_at: deps.catalogueSync?.lastSyncedAt() ?? { customers: null, vehicle_types: null },
  }));
}
