/** Cloud API contracts (brief §5, §11, §13-M5) shared by agent, server, manager app. */

import { z } from 'zod';
import { weighmentSchema } from './weighment.js';
import { auditEntrySchema } from './audit.js';
import { VEHICLE_TYPES } from '../constants/vehicle-types.js';
import { WEIGHMENT_STATUSES, USER_ROLES } from '../constants/domain.js';

/**
 * POST /ingest — the agent's outbox payload.
 *
 * Weighments and their audit entries travel together so a record and the trail
 * that explains it can never arrive out of step. The upsert is keyed on `id`,
 * so re-sending a batch after a timeout is safe by construction (brief §7.4).
 */
/**
 * The company details printed on a receipt, as the station knows them.
 *
 * They travel with every ingest because the agent is where an operator edits
 * them (Settings) and the cloud is where the customer reads them (the QR page
 * and the PDF behind it). Configuring the same address in two places is how a
 * printed slip and the page behind its own QR code end up disagreeing.
 */
export const stationProfileSchema = z.object({
  station_id: z.string().min(1).max(16),
  company_name: z.string().max(200),
  company_address: z.string().max(400),
  company_phone: z.string().max(100),
  company_logo_url: z.string().max(500).default(''),
  /** What this station prints on, so a downloaded PDF matches its paper. */
  paper_size: z.enum(['A4', 'A5', 'LETTER']).default('A5'),
  /** When the station last changed them, so a stale batch cannot overwrite. */
  updated_at: z.string().datetime({ offset: true }),
});

export type StationProfile = z.infer<typeof stationProfileSchema>;

export const ingestRequestSchema = z.object({
  station_id: z.string().min(1).max(16),
  weighments: z.array(weighmentSchema).max(200),
  audit_entries: z.array(auditEntrySchema).max(1000).default([]),
  /** Optional: an older agent simply does not send it, and the cloud falls
   *  back to its own COMPANY_* configuration. */
  station: stationProfileSchema.optional(),
});

export type IngestRequest = z.infer<typeof ingestRequestSchema>;

export const ingestResponseSchema = z.object({
  /** Ids the server has durably stored — the agent marks exactly these synced. */
  accepted_ids: z.array(z.string().uuid()),
  rejected: z
    .array(
      z.object({
        id: z.string(),
        reason: z.string(),
        /**
         * True when re-sending this record can never succeed — a duplicate slip
         * number, a document that fails validation. The agent must quarantine
         * these instead of retrying: a permanent rejection retried on a backoff
         * is an infinite loop that also blocks every record behind it.
         */
        permanent: z.boolean().default(false),
      }),
    )
    .default([]),
  received_at: z.string().datetime({ offset: true }),
});

export type IngestResponse = z.infer<typeof ingestResponseSchema>;

// --- Manager queries -------------------------------------------------------

export const dateRangeSchema = z.object({
  /** Inclusive UTC bounds, filtered on `first_weight_at` (brief §6). */
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
});

export const weighmentQuerySchema = dateRangeSchema.extend({
  customer_name: z.string().trim().max(120).optional(),
  customer_company: z.string().trim().max(120).optional(),
  vehicle_type: z.enum(VEHICLE_TYPES).optional(),
  status: z.enum(WEIGHMENT_STATUSES).optional(),
  slip_number: z.string().trim().max(32).optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(200).default(25),
  sort_by: z
    .enum(['first_weight_at', 'created_at', 'amount_charged', 'net_weight_kg'])
    .default('first_weight_at'),
  sort_dir: z.enum(['asc', 'desc']).default('desc'),
});

export type WeighmentQuery = z.infer<typeof weighmentQuerySchema>;

/**
 * A weighment as the manager's table shows it: the record, plus the ledger
 * account it belongs to.
 *
 * The id is resolved when the list is read rather than stored on the weighment,
 * because the weighbridge that produced it has no ledger and must not need one.
 * Null when the account does not exist yet — an open ticket posts no charge, so
 * nothing has opened one.
 */
export const weighmentRowSchema = weighmentSchema.extend({
  customer_id: z.string().nullable().default(null),
});

export type WeighmentRow = z.infer<typeof weighmentRowSchema>;

export const paginatedWeighmentsSchema = z.object({
  rows: z.array(weighmentRowSchema),
  total: z.number().int().min(0),
  page: z.number().int().min(1),
  page_size: z.number().int().min(1),
});

export type PaginatedWeighments = z.infer<typeof paginatedWeighmentsSchema>;

/** GET /analytics. Every figure excludes VOID records (brief §7.6). */
export const analyticsSchema = z.object({
  total_weighments: z.number().int().min(0),
  completed_weighments: z.number().int().min(0),
  open_weighments: z.number().int().min(0),
  total_revenue: z.number(),
  total_net_weight_kg: z.number(),
  revenue_by_vehicle_type: z.array(
    z.object({ vehicle_type: z.string(), revenue: z.number(), count: z.number().int() }),
  ),
  weighments_over_time: z.array(
    z.object({ date: z.string(), count: z.number().int(), revenue: z.number() }),
  ),
  top_customers: z.array(
    z.object({ customer_name: z.string(), count: z.number().int(), revenue: z.number() }),
  ),
  top_companies: z.array(
    z.object({ customer_company: z.string(), count: z.number().int(), revenue: z.number() }),
  ),
});

export type Analytics = z.infer<typeof analyticsSchema>;

// --- Auth ------------------------------------------------------------------

export const loginRequestSchema = z.object({
  username: z.string().trim().min(1, 'Username is required').max(64),
  password: z.string().min(1, 'Password is required').max(200),
});

export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const authUserSchema = z.object({
  username: z.string(),
  display_name: z.string(),
  role: z.enum(USER_ROLES),
});

export type AuthUser = z.infer<typeof authUserSchema>;

export const loginResponseSchema = z.object({
  token: z.string(),
  user: authUserSchema,
  expires_at: z.string().datetime({ offset: true }),
});

export type LoginResponse = z.infer<typeof loginResponseSchema>;

/** Uniform error envelope so both PWAs can render failures the same way. */
export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});

export type ApiError = z.infer<typeof apiErrorSchema>;
