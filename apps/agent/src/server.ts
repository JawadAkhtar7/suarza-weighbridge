/**
 * Localhost HTTP API + (from M2) the Operator PWA's static build.
 *
 * Built as a factory taking its dependencies so tests can drive the real
 * routes against an in-memory database and the simulator, with no ports open.
 */

import Fastify, { type FastifyInstance } from 'fastify';
import type { SyncStatus } from '@suarza/shared';
import cors from '@fastify/cors';
import type { AgentConfig } from './config.js';
import type { WeightReader } from './indicator/index.js';
import type { WeighmentService } from './services/weighment-service.js';
import { SimulatorWeightReader } from './indicator/simulator.js';
import { AppError, isAppError } from './errors.js';
import { loggerOptions } from './logger.js';
import { registerLiveWeightRoutes } from './routes/live-weight.js';
import { registerWeighmentRoutes } from './routes/weighments.js';
import { registerSimulatorRoutes } from './routes/simulator.js';
import { registerSettingsRoutes } from './routes/settings.js';
import type { SettingsService } from './services/settings-service.js';
import { registerOperatorWeb, resolveOperatorWebDir } from './static.js';

/**
 * Read live by `/sync-status`. A provider rather than a snapshot: the operator
 * UI polls this every few seconds and must see the worker's current state, not
 * whatever was true when the server was built.
 */
export interface SyncStatusProvider {
  toSyncStatus(): SyncStatus;
}

export interface AgentDeps {
  config: AgentConfig;
  reader: WeightReader;
  service: WeighmentService;
  syncStatus?: SyncStatusProvider;
  settings?: SettingsService;
  /** Explicit path to the Operator PWA build; auto-detected when omitted. */
  operatorWebDir?: string | null;
  /** Tests drive the API directly and have no web build to serve. */
  serveOperatorWeb?: boolean;
}

export async function buildServer(deps: AgentDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger: loggerOptions(deps.config),
    routerOptions: {
      // Trailing slashes are an easy way to lose a route when the operator PWA
      // builds URLs by concatenation.
      ignoreTrailingSlash: true,
    },
  });

  // The Vite dev server runs on another port during development; in production
  // the PWA is served by this same process and same-origin anyway.
  await app.register(cors, { origin: true });

  app.setErrorHandler((error, request, reply) => {
    if (isAppError(error)) {
      // Expected, handled outcomes (slip not found, already completed) are the
      // operator's normal flow, not incidents — log them at the level they are.
      const level = error.statusCode >= 500 ? 'error' : 'info';
      request.log[level]({ code: error.code }, error.message);
      return reply.code(error.statusCode).send(error.toResponse());
    }

    // Fastify's own schema validation, if a route ever declares one.
    const fastifyError = error as { validation?: unknown; message?: string };
    if (fastifyError.validation) {
      const appError = new AppError('VALIDATION_ERROR', fastifyError.message ?? 'Invalid request.');
      return reply.code(400).send(appError.toResponse());
    }

    request.log.error({ err: error }, 'Unhandled error');
    const internal = new AppError('INTERNAL_ERROR', 'Something went wrong on the weighbridge PC.');
    return reply.code(500).send(internal.toResponse());
  });

  registerLiveWeightRoutes(app, deps);
  registerWeighmentRoutes(app, deps);
  registerSettingsRoutes(app, deps);

  if (deps.config.USE_SIMULATOR && deps.reader instanceof SimulatorWeightReader) {
    registerSimulatorRoutes(app, deps.reader);
  }

  // The static plugin installs its own not-found handler for the SPA fallback,
  // so only one of the two is ever registered.
  const webDir =
    deps.serveOperatorWeb === false
      ? null
      : resolveOperatorWebDir(deps.operatorWebDir ?? undefined);

  if (webDir) {
    await registerOperatorWeb(app, webDir);
    app.log.info({ directory: webDir }, 'Serving Operator PWA');
  } else {
    app.setNotFoundHandler((request, reply) => {
      const error = new AppError('NOT_FOUND', `No route for ${request.method} ${request.url}`);
      return reply.code(404).send(error.toResponse());
    });
  }

  return app;
}
