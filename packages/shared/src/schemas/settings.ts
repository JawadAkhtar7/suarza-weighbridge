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
  // A5 everywhere: the client's pre-printed pads are A5, and the size is no
  // longer an option in the operator app.
  paper_size: paperSizeSchema.default('A5'),
  /** Only used when paper_size is CUSTOM. Millimetres. */
  custom_width_mm: z.number().min(50).max(500).default(148),
  custom_height_mm: z.number().min(50).max(500).default(210),
  offset_top_mm: z.number().min(-50).max(200).default(0),
  offset_left_mm: z.number().min(-50).max(200).default(0),
  /** Scales the whole central block if the pad's blank area is tight. */
  scale_percent: z.number().min(50).max(150).default(100),
});

export type PrintSettings = z.infer<typeof printSettingsSchema>;

export const pricingTableSchema = z.record(z.enum(VEHICLE_TYPES), z.number().min(0));

export const stationSettingsSchema = z.object({
  station_id: z.string().min(1).max(16).default('A'),
  /** Company details printed on the soft receipt. `[PLACEHOLDER]` until the
   *  client supplies the real logo, address and contact numbers. */
  company_name: z.string().default('Suarza International'),
  company_address: z.string().default('[PLACEHOLDER] Address line, City, Pakistan'),
  company_phone: z.string().default('[PLACEHOLDER] +92 300 0000000'),
  company_logo_url: z.string().default('/logo.png'),
  /** Base URL the receipt QR points at, e.g. https://app.example.com. */
  receipt_base_url: z.string().default(''),
  print: printSettingsSchema.default({}),
  /** Fire the print dialog automatically once a receipt appears (brief §3). */
  auto_print: z.boolean().default(true),
  pricing: pricingTableSchema.default({}),
  /** Sync backstop cadence in seconds (brief §11d). */
  sync_interval_seconds: z.number().int().min(30).max(3600).default(180),
  /** Where the scheduled SQLite copy is written (brief §12). */
  backup_path: z.string().default(''),
  backup_interval_hours: z.number().int().min(1).max(168).default(24),
});

export type StationSettings = z.infer<typeof stationSettingsSchema>;

export function defaultStationSettings(): StationSettings {
  return stationSettingsSchema.parse({});
}
