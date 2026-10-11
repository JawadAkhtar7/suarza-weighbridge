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
import { FRONT_VIEW_ZOOM, SLIP_PAGE_MM } from '../constants/paper.js';

export const paperSizeSchema = z.enum(['A4', 'A5', 'LETTER', 'CUSTOM']);
export type PaperSize = z.infer<typeof paperSizeSchema>;

export const printSettingsSchema = z.object({
  /* The client's pre-printed pads are 140 x 200, which has no standard name,
     so the size is CUSTOM with SLIP_PAGE_MM's figures. Not an operator
     choice: the agent normalises it on read, and the default here says the
     same thing so that a screen drawn before the agent has answered is not
     briefly drawn for paper nobody owns. */
  paper_size: paperSizeSchema.default('CUSTOM'),
  /** Only used when paper_size is CUSTOM. Millimetres. */
  custom_width_mm: z.number().min(50).max(500).default(SLIP_PAGE_MM.width),
  custom_height_mm: z.number().min(50).max(500).default(SLIP_PAGE_MM.height),
  /* Whole-sheet nudges. Pinned to zero by the agent and not offered in the
     operator app: moving everything at once to chase one misplaced element
     puts three others out, which is what happened on site. */
  offset_top_mm: z.number().min(-50).max(200).default(0),
  offset_left_mm: z.number().min(-50).max(200).default(0),
  /** Scales the whole central block if the pad's blank area is tight. */
  scale_percent: z.number().min(50).max(150).default(100),
  /*
   * Overprint calibration, in millimetres.
   *
   * The pads are pre-printed on one press and overprinted on another, and the
   * two do not agree about where the paper starts. One page-wide nudge was
   * tried first and was the wrong instrument: the error is not uniform, so
   * correcting the element that was visibly out pushed others off.
   *
   * Three groups instead, each moved on its own:
   *   details   — the slip number, the date, the customer fields, the weights
   *   side view — the right-hand photograph
   *   qr        — the code in the SCAN TO VERIFY box
   *
   * Positive x is right, positive y is down. These apply to the PRINTED sheet
   * only: the screen copy, the PDF and the public page behind the QR are
   * rendered from the same coordinates as the design and never shift, so the
   * record and the paper cannot drift apart.
   */
  details_offset_x_mm: z.number().min(-20).max(20).default(0),
  details_offset_y_mm: z.number().min(-20).max(20).default(0),
  side_view_offset_x_mm: z.number().min(-20).max(20).default(0),
  side_view_offset_y_mm: z.number().min(-20).max(20).default(0),
  qr_offset_x_mm: z.number().min(-20).max(20).default(0),
  qr_offset_y_mm: z.number().min(-20).max(20).default(0),
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
  /*
   * How tightly the front camera's picture is cropped into its box.
   *
   * NOT under `print`, and deliberately so: everything in there corrects for
   * one printer putting the paper down crooked and is applied to the hard
   * form alone. This is not a correction — it is how far back the camera
   * ended up on its pole, which is equally true of the preview, the PDF and
   * the page a customer scans. It travels to the cloud with the station
   * profile so all four agree.
   */
  front_view_zoom: z
    .number()
    .min(FRONT_VIEW_ZOOM.min)
    .max(FRONT_VIEW_ZOOM.max)
    .default(FRONT_VIEW_ZOOM.default),
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
