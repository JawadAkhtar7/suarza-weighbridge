/** Structured logging (brief §12). Fastify ships pino; this is its config. */

import type { AgentConfig } from './config.js';

export function loggerOptions(config: AgentConfig) {
  return {
    level: config.LOG_LEVEL,
    redact: { paths: ['req.headers.authorization'], remove: true },
  };
}
