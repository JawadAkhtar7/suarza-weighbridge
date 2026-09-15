/**
 * Guards the agent→cloud ingest route (brief §12).
 *
 * This is the only credential the weighbridge PC ever holds. The Mongo
 * credential lives solely on the droplet, so a compromised factory PC can
 * write weighments and nothing else.
 */

import { timingSafeEqual } from 'node:crypto';
import type { RequestHandler } from 'express';
import { ApiError } from '../errors.js';

export const INGEST_HEADER = 'x-api-key';

/** Constant-time compare so the key can't be recovered by timing the endpoint. */
function safeEqual(a: string, b: string): boolean {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}

export function requireApiKey(expectedKey: string): RequestHandler {
  return (req, _res, next) => {
    const provided = req.header(INGEST_HEADER);
    if (!provided || !safeEqual(provided, expectedKey)) {
      next(new ApiError('UNAUTHORIZED', 'A valid ingest API key is required.'));
      return;
    }
    next();
  };
}
