/**
 * Receipt and print settings.
 *
 * Held by the AGENT, not the browser. Print offsets describe the printer in
 * front of the operator and the pricing table is the business's rate card —
 * neither should vanish because someone cleared a browser profile or opened
 * the app in a different browser on the same PC.
 */

import type { StationSettings } from '@suarza/shared';
import { stationSettingsSchema } from '@suarza/shared';

export type ReceiptSettings = StationSettings;

export function defaultReceiptSettings(): ReceiptSettings {
  return stationSettingsSchema.parse({});
}

/**
 * The URL the receipt QR encodes (brief §8): `{APP_DOMAIN}/r/{slip_number}`.
 * Returns null until the droplet domain is configured, so a QR that resolves
 * nowhere is never printed onto a customer's receipt.
 */
export function buildReceiptUrl(baseUrl: string, slipNumber: string): string | null {
  const base = baseUrl.trim().replace(/\/+$/, '');
  if (!base) return null;
  return `${base}/r/${encodeURIComponent(slipNumber)}`;
}
