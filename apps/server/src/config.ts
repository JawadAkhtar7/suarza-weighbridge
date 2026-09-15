/**
 * Server configuration (brief §5, §12).
 *
 * Validated at boot so a missing JWT secret or a Mongo URI without the database
 * name fails immediately on deploy, rather than at the first request.
 */

import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

loadDotenv();

/** The database the whole product uses. One URI, database name included. */
export const EXPECTED_DATABASE_NAME = 'suarzaweightbridge';

const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),

  MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),

  /** Public origin, used to build the QR receipt URLs (brief §8). */
  APP_DOMAIN: z.string().min(1).default('http://localhost:4000'),

  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
  JWT_EXPIRES_IN: z.string().default('12h'),

  /** Shared secret the on-site agent presents on POST /ingest. */
  INGEST_API_KEY: z.string().min(8, 'INGEST_API_KEY must be at least 8 characters'),

  // Company details for the public receipt page and PDF. `[PLACEHOLDER]`
  // until the client supplies the real logo, address and numbers (brief §14).
  // They live here rather than in the database because they describe the
  // business, not any one weighment.
  /**
   * Serve the built Manager dashboard from this process. Off in development so
   * the dashboard has exactly one address — the Vite dev server — rather than
   * a hot-reloading copy and a stale built copy side by side.
   */
  SERVE_MANAGER_WEB: z
    .union([z.boolean(), z.string()])
    .default(true)
    .transform((v) =>
      typeof v === 'boolean' ? v : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase()),
    ),

  COMPANY_NAME: z.string().default('Suarza International'),
  COMPANY_ADDRESS: z.string().default('[PLACEHOLDER] Address line, City, Pakistan'),
  COMPANY_PHONE: z.string().default('[PLACEHOLDER] +92 300 0000000'),
  COMPANY_LOGO_URL: z.string().default('/logo.png'),

  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
});

export type ServerConfig = z.infer<typeof configSchema>;

/**
 * A Mongo URI with no database path connects to the cluster default, not ours —
 * silently, and everything then reads and writes the wrong place. Checked here
 * because it is the single most likely deployment mistake (brief §5).
 */
export function databaseNameFromUri(uri: string): string | null {
  try {
    // The mongodb+srv scheme is not one the URL parser knows, so it is swapped
    // for a scheme that is, purely to read the path.
    const parsed = new URL(uri.replace(/^mongodb(\+srv)?:\/\//, 'http://'));
    const name = parsed.pathname.replace(/^\//, '').trim();
    return name || null;
  } catch {
    return null;
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const result = configSchema.safeParse(env);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid server configuration:\n${issues}`);
  }

  const dbName = databaseNameFromUri(result.data.MONGODB_URI);
  if (!dbName) {
    throw new Error(
      `MONGODB_URI must include the database name — it should end in /${EXPECTED_DATABASE_NAME}. ` +
        'Without it Mongoose connects to the cluster default instead of our data.',
    );
  }

  return result.data;
}
