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
import {
  DEFAULT_PHOTO_BOXES_MM,
  FRONT_VIEW_ZOOM,
  SIDE_VIEW_ZOOM,
  SLIP_PAGE_MM,
} from '../constants/paper.js';
import { clampViewFrame, VIEW_FRAME_ZOOM } from '../utils/framing.js';

/**
 * How a camera view is framed in its box: zoom, and pan as a fraction of the
 * box (see utils/framing.ts), starting from that view's own default zoom.
 * Clamped on the way in, so no stored or synced value can leave the pad's
 * white showing at an edge.
 */
export const viewFrameSchema = (defaultZoom: number) =>
  z
    .object({
      zoom: z.number().min(VIEW_FRAME_ZOOM.min).max(VIEW_FRAME_ZOOM.max).default(defaultZoom),
      x: z.number().min(-0.5).max(0.5).default(0),
      y: z.number().min(-0.5).max(0.5).default(0),
    })
    .transform(clampViewFrame);

export const frontViewFrameSchema = viewFrameSchema(FRONT_VIEW_ZOOM.default);
export const sideViewFrameSchema = viewFrameSchema(SIDE_VIEW_ZOOM.default);

/**
 * A camera picture's box on the pad, in the slip's millimetres, as read off
 * the measuring sheet: each edge at the middle of its green line.
 */
const photoBoxSchema = (defaults: { left: number; right: number; top: number; bottom: number }) =>
  z
    .object({
      left: z.number().min(0).max(SLIP_PAGE_MM.width).default(defaults.left),
      right: z.number().min(0).max(SLIP_PAGE_MM.width).default(defaults.right),
      top: z.number().min(0).max(SLIP_PAGE_MM.height).default(defaults.top),
      bottom: z.number().min(0).max(SLIP_PAGE_MM.height).default(defaults.bottom),
    })
    .refine((box) => box.right - box.left >= 20 && box.bottom - box.top >= 10, {
      message: 'A picture box must be at least 20 mm wide and 10 mm tall.',
    });

export type PhotoBox = z.infer<ReturnType<typeof photoBoxSchema>>;

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
   * Six groups instead, each moved on its own:
   *   slip number  — the number in its white box at the top
   *   details      — the print date/time and the customer fields
   *   weights      — first, second and net, with MANUAL and MANN
   *   first time   — the first weight's date/time, beside its calendar icon
   *   second time  — the second weight's date/time, beside its calendar icon
   *   qr           — the code in the SCAN TO VERIFY box
   *
   * The two photographs are not nudged: they are placed by `photo_boxes_mm`
   * below, read off a measuring sheet.
   *
   * They split off one at a time, each when the operator needed to move one
   * thing without disturbing its neighbours: the weights from the details,
   * then the date/times from the weights — they sit beside icons printed on
   * the pad, where a millimetre's drift shows at a glance, as the QR's does —
   * then each date/time from the other, and the slip number from the details.
   * A split group starts where the group it left had put it (see the agent's
   * SettingsService), so nothing moves on paper the day it appears.
   *
   * Positive x is right, positive y is down. These apply to the PRINTED sheet
   * only: the screen copy, the PDF and the public page behind the QR are
   * rendered from the same coordinates as the design and never shift, so the
   * record and the paper cannot drift apart.
   */
  slip_number_offset_x_mm: z.number().min(-20).max(20).default(0),
  slip_number_offset_y_mm: z.number().min(-20).max(20).default(0),
  details_offset_x_mm: z.number().min(-20).max(20).default(0),
  details_offset_y_mm: z.number().min(-20).max(20).default(0),
  weights_offset_x_mm: z.number().min(-20).max(20).default(0),
  weights_offset_y_mm: z.number().min(-20).max(20).default(0),
  first_time_offset_x_mm: z.number().min(-20).max(20).default(0),
  first_time_offset_y_mm: z.number().min(-20).max(20).default(0),
  second_time_offset_x_mm: z.number().min(-20).max(20).default(0),
  second_time_offset_y_mm: z.number().min(-20).max(20).default(0),
  qr_offset_x_mm: z.number().min(-20).max(20).default(0),
  qr_offset_y_mm: z.number().min(-20).max(20).default(0),
  /*
   * Where each photograph's box is on this station's pads, in the slip's own
   * millimetres: each edge where the measuring sheet's scale crosses the
   * middle of the box's green line. The picture prints PHOTO_BOX_FILL_MM past
   * every edge.
   *
   * Replaces a side-view nudge and a per-side extra width, which tried to
   * correct the artwork's boxes by hand, one test pad at a time, and never
   * got there: the pads are larger than the artwork and off-centre, and the
   * printer adds its own placement on top. A scale printed by the same
   * printer measures all of that at once, on one pad.
   */
  photo_boxes_mm: z
    .object({
      front: photoBoxSchema(DEFAULT_PHOTO_BOXES_MM.front).default({}),
      side: photoBoxSchema(DEFAULT_PHOTO_BOXES_MM.side).default({}),
    })
    .default({}),
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
   * How each camera's picture is framed in its box — zoom and pan, set by
   * the operator on the live preview.
   *
   * NOT under `print`, and deliberately so: everything in there corrects for
   * one printer putting the paper down crooked and is applied to the hard
   * form alone. This is not a correction — it is what the slip shows, which
   * is equally true of the preview, the PDF and the page a customer scans.
   * It travels to the cloud with the station profile so all of them agree.
   *
   * The front view's used to be a zoom alone (`front_view_zoom`); a station
   * saved before then starts from that zoom, centred — see the agent's
   * SettingsService.
   */
  front_view_frame: frontViewFrameSchema.default({}),
  side_view_frame: sideViewFrameSchema.default({}),
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

/**
 * A change to the camera framing alone.
 *
 * Its own schema because its own route accepts it without a password, and
 * what makes that safe is that it cannot name anything else. Both views are
 * optional — the operator drags one picture at a time — but a body naming
 * neither is a mistake worth reporting rather than a save of nothing.
 */
export const framingUpdateSchema = z
  .object({
    front_view_frame: frontViewFrameSchema.optional(),
    side_view_frame: sideViewFrameSchema.optional(),
  })
  .strict()
  .refine((value) => value.front_view_frame !== undefined || value.side_view_frame !== undefined, {
    message: 'Name at least one view to reframe.',
  });

export type FramingUpdate = z.infer<typeof framingUpdateSchema>;

export function defaultStationSettings(): StationSettings {
  return stationSettingsSchema.parse({});
}
