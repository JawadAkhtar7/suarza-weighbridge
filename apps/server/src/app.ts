/**
 * Express application (brief §5).
 *
 * Built as a factory so tests drive the real routes against an in-memory
 * MongoDB with no ports opened and no static build required.
 */

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import type { ServerConfig } from './config.js';
import { errorHandler, notFoundHandler } from './middleware/errors.js';
import { ingestRouter } from './routes/ingest.routes.js';
import { authRouter } from './routes/auth.routes.js';
import { catalogueRouter } from './routes/catalogue.routes.js';
import { ledgerRouter } from './routes/ledger.routes.js';
import { managerRouter } from './routes/manager.routes.js';
import { receiptRouter } from './routes/receipt.routes.js';
import { registerManagerWeb, resolveManagerWebDir } from './static.js';

export interface BuildAppOptions {
  config: ServerConfig;
  logger?: Pick<Console, 'error' | 'info'>;
  /** Explicit path to the manager build; auto-detected when omitted. */
  managerWebDir?: string | null;
  serveManagerWeb?: boolean;
}

export function buildApp({
  config,
  logger = console,
  managerWebDir,
  serveManagerWeb = true,
}: BuildAppOptions): Express {
  const app = express();

  app.set('trust proxy', 1); // Behind Nginx on the droplet (brief §14).
  app.use(
    helmet({
      // The receipt page inlines its own stylesheet, which a default CSP would
      // block. Nothing on it is user-authored, and it loads no scripts at all.
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'https:'],
          scriptSrc: ["'self'"],
        },
      },
      // The PDF is a download, not an embed.
      crossOriginResourcePolicy: { policy: 'same-site' },
    }),
  );
  app.use(cors({ origin: true }));
  // Agent batches carry up to 200 weighments plus their audit entries.
  app.use(express.json({ limit: '4mb' }));

  // Served unconditionally: the public receipt page needs the logo even when
  // this process is not serving the manager app (as in development).
  const here = dirname(fileURLToPath(import.meta.url));
  for (const candidate of [resolve(here, 'public'), resolve(here, '../public')]) {
    app.use(express.static(candidate, { index: false, maxAge: '1h' }));
  }

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'suarza-weighbridge-server' });
  });

  app.use(ingestRouter(config.INGEST_API_KEY));
  app.use(authRouter({ secret: config.JWT_SECRET, expiresIn: config.JWT_EXPIRES_IN }));
  app.use(managerRouter(config.JWT_SECRET));
  app.use(ledgerRouter(config.JWT_SECRET));
  app.use(catalogueRouter(config.JWT_SECRET, config.INGEST_API_KEY));
  app.use(receiptRouter(config));

  const webDir = serveManagerWeb ? resolveManagerWebDir(managerWebDir ?? undefined) : null;
  if (webDir) {
    registerManagerWeb(app, webDir);
    logger.info?.(`Serving Manager Dashboard from ${webDir}`);
  } else {
    app.use(notFoundHandler);
  }

  app.use(errorHandler(logger));

  return app;
}
