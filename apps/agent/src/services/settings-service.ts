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

import { stationSettingsSchema, type StationSettings } from '@suarza/shared';
import type { Db } from '../db/connection.js';
import { MetaStore } from '../db/meta.js';
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
    return { ...base, ...(stored === null ? this.defaults : {}) };
  }

  replace(input: unknown): StationSettings {
    const result = stationSettingsSchema.safeParse(input);
    if (!result.success) {
      throw new AppError('VALIDATION_ERROR', 'Some settings are not valid.', {
        field_errors: result.error.flatten().fieldErrors,
      });
    }

    this.meta.setJson(SETTINGS_KEY, result.data);
    for (const listener of this.listeners) listener(result.data);
    return result.data;
  }

  onChange(listener: (settings: StationSettings) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
