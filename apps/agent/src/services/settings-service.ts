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
  SLIP_PAGE_MM,
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

    // The QR address follows the cloud, and the cloud's address lives in
    // deployment.ts — so this is normalised on read rather than merely
    // defaulted when blank.
    //
    // It used to fill in only an empty field, which is no use to the machine
    // that matters: the weighbridge PC is carrying an ngrok tunnel somebody
    // typed into Settings months ago. A stale address is not blank, so the
    // fallback never fired, and every slip it printed carried a QR pointing
    // at a tunnel that no longer exists. Nobody can walk up to that PC to
    // correct the field, which is the whole reason the cloud address lives in
    // code — so the code's answer wins here too, and moving the cloud needs
    // no site visit.
    //
    // Guarded on the default being set at all: an agent with sync switched
    // off (CLOUD_API_URL=none, the preview droplet's slip-layout rig) has no
    // cloud address to offer, and must not wipe a value typed in by hand.
    if (this.defaults.receipt_base_url) {
      settings.receipt_base_url = this.defaults.receipt_base_url;
    }

    /*
     * Paper size and alignment are not operator-editable: every station prints
     * the same pre-printed pads. Normalised on read so a station carrying an
     * older stored value — the A5 this used to say, or an offset calibrated
     * months ago — is not left with settings nothing can now correct.
     *
     * CUSTOM with the real figures rather than a named size, because 140 x 200
     * has no name. This is also what the Settings alignment test print uses: a
     * test sheet on A5 would line up perfectly and tell the operator nothing
     * about the pad they are actually feeding through.
     */
    settings.print = {
      ...settings.print,
      paper_size: 'CUSTOM',
      custom_width_mm: SLIP_PAGE_MM.width,
      custom_height_mm: SLIP_PAGE_MM.height,
      offset_top_mm: 0,
      offset_left_mm: 0,
      scale_percent: 100,
    };

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
