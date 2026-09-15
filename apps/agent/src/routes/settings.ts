/** Station settings (brief §13-M8). */

import type { FastifyInstance } from 'fastify';
import type { AgentDeps } from '../server.js';

export function registerSettingsRoutes(app: FastifyInstance, deps: AgentDeps): void {
  if (!deps.settings) return;
  const settings = deps.settings;

  app.get('/settings', () => settings.get());

  app.put('/settings', (request) => {
    const saved = settings.replace(request.body);
    request.log.info('Station settings updated');
    return saved;
  });
}
