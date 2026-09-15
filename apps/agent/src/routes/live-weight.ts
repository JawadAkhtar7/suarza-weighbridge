/**
 * Live weight + sync status.
 *
 * The operator PWA polls this roughly every 300ms over loopback (brief §4:
 * nothing critical rides a socket). It is deliberately a plain read of the
 * reader's last known state — no I/O, no DB — so it stays cheap at that rate.
 *
 * All three routes are registered at `logLevel: 'warn'`, which suppresses
 * Fastify's per-request log lines for them. At 300ms that is ~12,000 lines an
 * hour of "GET /live-weight 200", which would bury the events an audit
 * actually needs to find: saves, completions, voids and sync failures.
 */

import type { FastifyInstance } from 'fastify';
import type { LiveWeight, SyncStatus } from '@suarza/shared';
import type { AgentDeps } from '../server.js';

/** Quiet enough that a real problem still gets through. */
const POLLING_ROUTE = { logLevel: 'warn' } as const;

export function registerLiveWeightRoutes(app: FastifyInstance, deps: AgentDeps): void {
  app.get('/live-weight', POLLING_ROUTE, () => deps.reader.read() satisfies LiveWeight);

  app.get('/sync-status', POLLING_ROUTE, () => {
    // With no worker configured (cloud sync switched off for local work) the
    // agent still reports the real pending count and is honest about never
    // having reached the cloud, rather than claiming to be online.
    const status: SyncStatus = deps.syncStatus?.toSyncStatus() ?? {
      online: false,
      pending_count: deps.service.pendingSyncCount(),
      last_success_at: null,
      last_error: null,
      syncing: false,
    };
    return status;
  });

  app.get('/health', POLLING_ROUTE, () => ({
    status: 'ok',
    station_id: deps.config.STATION_ID,
    indicator: deps.reader.kind,
    simulator: deps.config.USE_SIMULATOR,
  }));
}
