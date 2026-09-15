/**
 * Serves the Manager Dashboard build (brief §4). Registered only when the build
 * exists, so the API runs on its own during development and in tests.
 */

import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type Express } from 'express';

/** Paths the SPA fallback must never swallow. */
export const API_PREFIXES = [
  '/ingest',
  '/auth',
  '/weighments',
  '/analytics',
  '/suggestions',
  '/r/',
  '/health',
];

export function resolveManagerWebDir(override?: string): string | null {
  if (override) return existsSync(resolve(override, 'index.html')) ? override : null;

  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(here, './manager-web'),
    resolve(here, '../manager-web'),
    resolve(here, '../../manager-web/dist'),
    resolve(here, '../../../manager-web/dist'),
  ];
  return candidates.find((dir) => existsSync(resolve(dir, 'index.html'))) ?? null;
}

export function registerManagerWeb(app: Express, directory: string): void {
  app.use(express.static(directory));

  app.get(/.*/, (req, res, next) => {
    if (API_PREFIXES.some((prefix) => req.path.startsWith(prefix))) {
      next();
      return;
    }
    res.sendFile(resolve(directory, 'index.html'));
  });
}
