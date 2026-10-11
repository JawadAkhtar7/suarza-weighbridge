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
  clampViewFrame,
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

/** The most `front_view_zoom` a cloud from before camera framing will accept. */
const LEGACY_FRONT_VIEW_ZOOM_MAX = 3;

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
      /*
       * Whole-sheet nudges and scale stay pinned.
       *
       * The offsets were opened up briefly to correct a pad printed slightly
       * off-centre, and moving everything at once turned out to be the wrong
       * instrument: fixing the one element that was visibly out pushed three
       * others off their boxes, and the result was harder to judge than the
       * original fault. The QR is the only element where the drift actually
       * shows — its box is barely larger than it is — so qr_offset_x_mm moves
       * that alone, and nothing else moves at all.
       */
      offset_top_mm: 0,
      offset_left_mm: 0,
      scale_percent: 100,
    };

    /*
     * Groups split off from the one that used to move them start where that
     * group put them, so a station saved before the split prints exactly as
     * it did instead of jumping back to zero on the next slip:
     *
     *   weights      moved with the details  ("First, second and net weight")
     *   weight times moved with the weights  ("Date/time beside the calendar
     *                                          icons")
     *
     * In that order, so a station older than both carries the details' figures
     * through to the times. The first save writes each group's own figures,
     * and this stops applying.
     */
    const storedPrint = (stored as { print?: unknown } | null)?.print;
    if (typeof storedPrint === 'object' && storedPrint !== null) {
      if (!('weights_offset_x_mm' in storedPrint)) {
        settings.print.weights_offset_x_mm = settings.print.details_offset_x_mm;
        settings.print.weights_offset_y_mm = settings.print.details_offset_y_mm;
      }
      if (!('weight_times_offset_x_mm' in storedPrint)) {
        settings.print.weight_times_offset_x_mm = settings.print.weights_offset_x_mm;
        settings.print.weight_times_offset_y_mm = settings.print.weights_offset_y_mm;
      }
    }

    /*
     * The front view used to be cropped by a zoom alone (`front_view_zoom`,
     * typed into Settings). A station saved before it could be panned starts
     * from that zoom, centred — exactly the picture it was printing. The first
     * save writes the framing itself, and this stops applying.
     */
    if (
      typeof stored === 'object' &&
      stored !== null &&
      !('front_view_frame' in stored) &&
      typeof (stored as { front_view_zoom?: unknown }).front_view_zoom === 'number'
    ) {
      settings.front_view_frame = clampViewFrame({
        zoom: (stored as { front_view_zoom: number }).front_view_zoom,
        x: 0,
        y: 0,
      });
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
   * What this station looks like, as the cloud needs it for the page behind
   * the QR: its paper, and how its cameras are framed.
   *
   * Sent with every batch so the public receipt matches the printed one; see
   * `stationProfileSchema`.
   */
  profile(): StationProfile {
    const settings = this.get();
    return {
      station_id: settings.station_id,
      paper_size: settings.print.paper_size === 'CUSTOM' ? 'A5' : settings.print.paper_size,
      /* So the page behind the QR frames both views exactly as the paper does. */
      front_view_frame: settings.front_view_frame,
      side_view_frame: settings.side_view_frame,
      /* The front framing's zoom alone, for a cloud that predates framing —
         held to the 3 that cloud accepts: a higher figure fails its check on
         the whole batch, and the weighings would stop syncing with it. */
      front_view_zoom: Math.min(settings.front_view_frame.zoom, LEGACY_FRONT_VIEW_ZOOM_MAX),
      // Epoch until this station's settings have been saved at least once,
      // so a station that has never been touched cannot win against one that
      // has. Saving bumps it, which is what lets a zoom change take.
      updated_at: this.meta.get(META_KEYS.settingsUpdatedAt) ?? new Date(0).toISOString(),
    };
  }

  onChange(listener: (settings: StationSettings) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
