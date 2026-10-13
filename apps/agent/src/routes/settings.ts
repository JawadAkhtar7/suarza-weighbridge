/** Station settings (brief §13-M8). */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { framingUpdateSchema } from '@suarza/shared';
import type { AgentDeps } from '../server.js';
import { AppError } from '../errors.js';
import type { UserRepository } from '../db/users.js';
import { parse } from './helpers.js';

/**
 * The credentials on a request, from an `Authorization: Basic` header.
 *
 * Basic rather than a login and a session cookie: there is one protected
 * action on this machine, the operator is standing at it, and a session is a
 * thing that expires half-way through a change. Null for anything missing or
 * malformed — the caller treats all of those the same way.
 *
 * The header is only ever read over a loopback connection: the operator app
 * is served by this same process on the same PC.
 */
function basicCredentials(request: FastifyRequest): { username: string; password: string } | null {
  const header = request.headers.authorization;
  if (!header?.toLowerCase().startsWith('basic ')) return null;

  const decoded = Buffer.from(header.slice(6).trim(), 'base64').toString('utf8');
  // The FIRST colon only: a password may contain one, a username may not.
  const colon = decoded.indexOf(':');
  if (colon < 1) return null;

  return { username: decoded.slice(0, colon), password: decoded.slice(colon + 1) };
}

/**
 * Refuse unless these credentials belong to a user of this station.
 *
 * No `users` at all means this agent was built without the table — the test
 * harness, a developer's own machine — and settings are then unprotected, as
 * they were before. The real agent always passes one, so the only way to
 * reach production unprotected is to delete code rather than to forget a flag.
 */
function authorise(request: FastifyRequest, users: UserRepository | undefined): void {
  if (!users) return;

  const credentials = basicCredentials(request);
  if (!credentials || !users.verify(credentials.username, credentials.password)) {
    request.log.warn(
      { username: credentials?.username ?? null },
      'Settings change refused: wrong username or password',
    );
    throw new AppError(
      'INVALID_CREDENTIALS',
      'That username and password do not match. Settings were not saved.',
    );
  }
}

export function registerSettingsRoutes(app: FastifyInstance, deps: AgentDeps): void {
  if (!deps.settings) return;
  const settings = deps.settings;

  app.get('/settings', () => settings.get());

  app.put('/settings', (request) => {
    authorise(request, deps.users);
    const saved = settings.replace(request.body);
    request.log.info('Station settings updated');
    return saved;
  });

  /**
   * How the cameras are framed, and nothing else.
   *
   * Its own route, deliberately, and the one settings write that asks for no
   * password. The operator frames a picture by dragging the live view on the
   * weighing screen, many times a day, while a truck waits — a password there
   * would mean the pictures simply stop being framed.
   *
   * What makes that safe is the narrowness: this accepts two framings and
   * cannot be used to reach anything else under /settings. Giving the framer
   * the full PUT instead would have left the password it asks for beside a
   * door with no lock on it.
   */
  app.put('/settings/framing', (request) => {
    const input = parse(framingUpdateSchema, request.body);
    const saved = settings.updateFraming(input);
    request.log.info({ views: Object.keys(input) }, 'Camera framing updated');
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
