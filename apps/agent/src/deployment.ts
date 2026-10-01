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
export const CLOUD_API_URL = 'https://suarza-weighbridge-api.onrender.com';

/** Must match INGEST_API_KEY on the cloud server, or every sync is rejected. */
export const CLOUD_API_KEY = 'CHANGE-ME-BEFORE-THE-CLOUD-GOES-LIVE';

/**
 * Development override.
 *
 * Only `.env` on a developer's machine sets these, which is how `pnpm dev`
 * points at a local server without the production address ever being edited -
 * and therefore without localhost being pushed to the weighbridge by accident.
 * The operator PC has no such entries, so the values above are what it uses.
 */
export function cloudSettings(env: NodeJS.ProcessEnv = process.env): {
  url: string;
  apiKey: string;
} {
  return {
    url: env['CLOUD_API_URL']?.trim() || CLOUD_API_URL,
    apiKey: env['CLOUD_API_KEY']?.trim() || CLOUD_API_KEY,
  };
}
