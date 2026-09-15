/**
 * Agent configuration (brief §12: config via env).
 *
 * Parsed and validated once at boot so a typo in a `.env` on the factory PC
 * fails loudly at startup rather than silently at 6am when a truck is waiting.
 */

import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';
import { DEFAULT_STATION_ID } from '@suarza/shared';

loadDotenv();

const booleanish = z
  .union([z.boolean(), z.string()])
  .transform((v) =>
    typeof v === 'boolean' ? v : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase()),
  );

const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  // The API is bound to loopback only: the operator PWA is served from the
  // same process, and nothing off this machine has any business reaching it.
  PORT: z.coerce.number().int().min(1).max(65535).default(3100),
  HOST: z.string().default('127.0.0.1'),
  STATION_ID: z.string().min(1).max(16).default(DEFAULT_STATION_ID),

  DATABASE_PATH: z.string().default('./data/weighbridge.sqlite'),

  // --- Indicator -----------------------------------------------------------
  SERIAL_PORT: z.string().default('COM3'),
  SERIAL_BAUD_RATE: z.coerce.number().int().positive().default(9600),
  SERIAL_DATA_BITS: z.coerce
    .number()
    .int()
    .refine((v) => [5, 6, 7, 8].includes(v))
    .default(8),
  SERIAL_STOP_BITS: z.coerce
    .number()
    .refine((v) => [1, 1.5, 2].includes(v))
    .default(1),
  SERIAL_PARITY: z.enum(['none', 'even', 'odd', 'mark', 'space']).default('none'),
  /** Line framing. `\r\n` on nearly every indicator; escape sequences allowed. */
  SERIAL_DELIMITER: z.string().default('\\r\\n'),
  /** Named-group regex applied to each line. See indicator/parser.ts. */
  SERIAL_PATTERN: z.string().default(''),
  /** Unit the indicator reports in; readings are normalised to kg. */
  SERIAL_UNIT: z.enum(['kg', 'g', 'lb', 't']).default('kg'),
  /** A reading older than this means the indicator has gone quiet. */
  READING_STALE_MS: z.coerce.number().int().min(200).default(3000),

  USE_SIMULATOR: booleanish.default(false),

  /**
   * Serve the built Operator PWA from this process.
   *
   * On the weighbridge PC this is the whole point — one service hands out the
   * UI as well as the data. In development it is turned off so the app has
   * exactly ONE address (the Vite dev server), instead of a hot-reloading copy
   * and a stale built copy that look identical.
   */
  SERVE_OPERATOR_WEB: booleanish.default(true),

  // --- Cloud sync (wired up in M6) -----------------------------------------
  CLOUD_API_URL: z.string().default(''),
  CLOUD_API_KEY: z.string().default(''),
  SYNC_INTERVAL_SECONDS: z.coerce.number().int().min(30).max(3600).default(180),

  BACKUP_PATH: z.string().default(''),
  BACKUP_INTERVAL_HOURS: z.coerce.number().int().min(1).max(168).default(24),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

export type AgentConfig = z.infer<typeof configSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AgentConfig {
  const result = configSchema.safeParse(env);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid agent configuration:\n${issues}`);
  }
  return result.data;
}

/** `\r\n` arrives from .env as the four characters `\`,`r`,`\`,`n`. */
export function unescapeDelimiter(raw: string): string {
  return raw
    .replace(/\\r/g, '\r')
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\0/g, '\0');
}
