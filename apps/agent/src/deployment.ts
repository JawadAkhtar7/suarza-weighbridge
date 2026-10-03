/**
 * Where this weighbridge sends its records.
 *
 * In code on purpose, not in `.env`.
 *
 * The weighbridge PC is hundreds of kilometres away and nobody can walk up to
 * it to edit a file. A value kept here travels with the software: change it,
 * push, and the operator pressing "Update Weighbridge" picks it up like any
 * other change. A value kept in `.env` would need a site visit.
 *
 * `.env` stays for what is genuinely about THAT machine - which COM port the
 * indicator is on, and little else.
 */

/** The cloud API. Empty disables sync entirely and records simply queue. */
export const CLOUD_API_URL = 'https://manager.147-182-184-238.sslip.io';

/** Must match INGEST_API_KEY on the cloud server, or every sync is rejected. */
export const CLOUD_API_KEY = '26748deb31e29caa7f93d5a6f981b39f0c387d62310b46c0';

/**
 * Development override.
 *
 * Only `.env` on a developer's machine sets these, which is how `pnpm dev`
 * points at a local server without the production address ever being edited -
 * and therefore without localhost being pushed to the weighbridge by accident.
 * The operator PC has no such entries, so the values above are what it uses.
 */
/**
 * The value that switches sync off.
 *
 * A word, not an empty string, and that is the whole point. Blank entries
 * must keep falling through to the constants above: a `.env` copied from the
 * example with its lines emptied out would otherwise disable sync on the
 * weighbridge PC silently, and nobody would notice until a month of records
 * had piled up locally. Switching sync off has to be something somebody
 * typed on purpose.
 */
export const CLOUD_DISABLED = 'none';

export function cloudSettings(env: NodeJS.ProcessEnv = process.env): {
  url: string;
  apiKey: string;
} {
  const url = env['CLOUD_API_URL']?.trim();

  // The preview droplet runs a second operator app purely to check slip
  // layouts. Its practice weighings must never reach the real records, so it
  // sets CLOUD_API_URL=none and syncs nowhere.
  if (url?.toLowerCase() === CLOUD_DISABLED) {
    return { url: '', apiKey: '' };
  }

  return {
    url: url || CLOUD_API_URL,
    apiKey: env['CLOUD_API_KEY']?.trim() || CLOUD_API_KEY,
  };
}
