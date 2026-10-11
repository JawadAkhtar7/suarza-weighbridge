/**
 * Operator-station settings (brief §8 printing, §13-M8 Settings screen).
 *
 * Print offsets exist because the hard receipt lands on pre-printed letterhead
 * pads: the central block must fall inside the pad's blank area, and no two
 * printers agree on where the page starts. These are plain millimetre numbers
 * with a "test print" button rather than anything clever.
 */

import { z } from 'zod';
import { VEHICLE_TYPES } from '../constants/vehicle-types.js';

export const paperSizeSchema = z.enum(['A4', 'A5', 'LETTER', 'CUSTOM']);
export type PaperSize = z.infer<typeof paperSizeSchema>;

export const printSettingsSchema = z.object({
  /* The client's pre-printed pads are 140 x 200, which has no standard name,
     so the size is CUSTOM with SLIP_PAGE_MM's figures. Not an operator
     choice: the agent normalises it on read. */
  paper_size: paperSizeSchema.default('A5'),
  /** Only used when paper_size is CUSTOM. Millimetres. */
  custom_width_mm: z.number().min(50).max(500).default(148),
  custom_height_mm: z.number().min(50).max(500).default(210),
  /* Whole-sheet nudges. Pinned to zero by the agent and not offered in the
     operator app: moving everything at once to chase one misplaced element
     puts three others out, which is what happened on site. */
  offset_top_mm: z.number().min(-50).max(200).default(0),
  offset_left_mm: z.number().min(-50).max(200).default(0),
  /** Scales the whole central block if the pad's blank area is tight. */
  scale_percent: z.number().min(50).max(150).default(100),
  /**
   * How far to move the QR code sideways, in millimetres, and nothing else.
   *
   * The pads are printed a little off-centre, and the only element where that
   * shows is the QR: it is small, it sits in a box barely bigger than itself,
   * and a millimetre of drift is obvious. Everything else has room to spare.
   *
   * So this moves the QR alone. Negative is left. Deliberately narrow: it is
   * a nudge for one square, not a page-wide correction.
   */
  qr_offset_x_mm: z.number().min(-20).max(20).default(0),
});

export type PrintSettings = z.infer<typeof printSettingsSchema>;

export const pricingTableSchema = z.record(z.enum(VEHICLE_TYPES), z.number().min(0));

export const stationSettingsSchema = z.object({
  station_id: z.string().min(1).max(16).default('A'),
  /* The company's name, address, phone and website are NOT here. They are the
     same for every station and the same on every slip, so they live in code —
     see COMPANY in @suarza/shared. A weighbridge operator changing the
     company's address by accident is not a feature. */
  /** Base URL the receipt QR points at, e.g. https://app.example.com. */
  receipt_base_url: z.string().default(''),
  print: printSettingsSchema.default({}),
  /** Fire the print dialog automatically once a receipt appears (brief §3). */
  auto_print: z.boolean().default(true),
  pricing: pricingTableSchema.default({}),
  /** Sync backstop cadence in seconds (brief §11d). */
  /* How often the agent checks in with the cloud when nothing has just been
     saved. Also how long a restored connection can go unnoticed. */
  sync_interval_seconds: z.number().int().min(30).max(3600).default(300),
  /** Where the scheduled SQLite copy is written (brief §12). */
  backup_path: z.string().default(''),
  backup_interval_hours: z.number().int().min(1).max(168).default(24),
});

export type StationSettings = z.infer<typeof stationSettingsSchema>;

export function defaultStationSettings(): StationSettings {
  return stationSettingsSchema.parse({});
}
