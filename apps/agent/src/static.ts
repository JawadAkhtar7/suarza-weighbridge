/**
 * Serves the Operator PWA build from the agent (brief §4, §5).
 *
 * The agent is the only thing the operator PC needs running: it owns the data,
 * reads the scale, and hands out the UI. Registration is conditional because
 * the agent has to boot and serve its API whether or not the web build has been
 * produced — a missing `dist/` is a development state, not a fatal error.
 */

import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';

/** Agent routes, which must never be swallowed by the SPA fallback. */
const API_PREFIXES = [
  '/live-weight',
  '/sync-status',
  '/health',
  '/weighments',
  '/simulator',
  '/settings',
  '/customers',
];

export function resolveOperatorWebDir(override?: string): string | null {
  if (override) return existsSync(override) ? override : null;

  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    // Packaged: the build is copied next to the compiled agent.
    resolve(here, './operator-web'),
    resolve(here, '../operator-web'),
    // Monorepo, running from apps/agent/dist.
    resolve(here, '../../operator-web/dist'),
    resolve(here, '../../../operator-web/dist'),
  ];

  return candidates.find((dir) => existsSync(resolve(dir, 'index.html'))) ?? null;
}

export async function registerOperatorWeb(app: FastifyInstance, directory: string): Promise<void> {
  await app.register(fastifyStatic, { root: directory, index: ['index.html'] });

  // Client-side routing: anything that isn't an API route or a real file gets
  // index.html so a refresh on a deep link doesn't 404.
  app.setNotFoundHandler((request, reply) => {
    const isApi = API_PREFIXES.some((prefix) => request.url.startsWith(prefix));
    if (isApi || request.method !== 'GET') {
      return reply.code(404).send({
        error: { code: 'NOT_FOUND', message: `No route for ${request.method} ${request.url}` },
      });
    }
    return reply.sendFile('index.html');
  });
}
