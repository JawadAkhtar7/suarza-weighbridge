/**
 * Station settings (brief §13-M8).
 *
 * Stored in the agent's SQLite rather than the browser: print offsets describe
 * the printer in front of the operator and the pricing table is the business's
 * rate card — neither should vanish because someone cleared a browser profile
 * or opened the app in a different browser on the same PC.
 *
 * Validated through the shared schema on read as well as write, so a settings
 * blob written by an older version can never put the station into a state the
 * rest of the code does not expect.
 */

import {
  nowUtc,
  stationSettingsSchema,
  type StationProfile,
  type StationSettings,
} from '@suarza/shared';
import type { Db } from '../db/connection.js';
import { MetaStore, META_KEYS } from '../db/meta.js';
import { AppError } from '../errors.js';

const SETTINGS_KEY = 'station_settings';

export class SettingsService {
  private readonly meta: MetaStore;
  /** Listeners that need to react to a change (the sync worker's cadence). */
  private readonly listeners = new Set<(settings: StationSettings) => void>();

  constructor(
    db: Db,
    private readonly defaults: Partial<StationSettings> = {},
  ) {
    this.meta = new MetaStore(db);
  }

  get(): StationSettings {
    const stored = this.meta.getJson<unknown>(SETTINGS_KEY, null);
    const parsed = stationSettingsSchema.safeParse(stored ?? {});

    // A malformed blob falls back to defaults rather than throwing: the
    // operator must still be able to weigh trucks and fix the settings after.
    const base = parsed.success ? parsed.data : stationSettingsSchema.parse({});
    const settings = { ...base, ...(stored === null ? this.defaults : {}) };

    // A blank receipt address silently drops the QR from every slip the
    // operator prints, while the manager's copy — built by the cloud from its
    // own APP_DOMAIN — still has one. The agent already knows the cloud it
    // syncs to, and the public receipt lives on that same host, so use it
    // rather than making someone type the same domain into a second field.
    if (!settings.receipt_base_url.trim() && this.defaults.receipt_base_url) {
      settings.receipt_base_url = this.defaults.receipt_base_url;
    }

    return settings;
  }

  replace(input: unknown): StationSettings {
    const result = stationSettingsSchema.safeParse(input);
    if (!result.success) {
      throw new AppError('VALIDATION_ERROR', 'Some settings are not valid.', {
        field_errors: result.error.flatten().fieldErrors,
      });
    }

    this.meta.setJson(SETTINGS_KEY, result.data);
    // Stamped here rather than sent as "now" at sync time: the cloud uses it to
    // reject a batch older than what it already holds, which only works if the
    // time describes the edit, not the transmission.
    this.meta.set(META_KEYS.settingsUpdatedAt, nowUtc());
    for (const listener of this.listeners) listener(result.data);
    return result.data;
  }

  /**
   * The company details as the cloud needs them, for the page behind the QR.
   *
   * Sent with every batch so the public receipt matches the printed one; see
   * `stationProfileSchema`.
   */
  profile(): StationProfile {
    const settings = this.get();
    return {
      station_id: settings.station_id,
      company_name: settings.company_name,
      company_address: settings.company_address,
      company_phone: settings.company_phone,
      company_logo_url: settings.company_logo_url,
      paper_size: settings.print.paper_size === 'CUSTOM' ? 'A5' : settings.print.paper_size,
      // Never edited on this station: epoch, so any real edit anywhere wins.
      updated_at: this.meta.get(META_KEYS.settingsUpdatedAt) ?? new Date(0).toISOString(),
    };
  }

  onChange(listener: (settings: StationSettings) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
