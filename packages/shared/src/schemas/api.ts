/** Cloud API contracts (brief §5, §11, §13-M5) shared by agent, server, manager app. */

import { z } from 'zod';
import { vehicleTypeSchema, weighmentSchema } from './weighment.js';
import { auditEntrySchema } from './audit.js';
import { WEIGHMENT_STATUSES, USER_ROLES } from '../constants/domain.js';
import { FRONT_VIEW_ZOOM } from '../constants/paper.js';
import { OPERATOR_SLOTS, SHIFTS } from '../constants/shifts.js';
import { frontViewFrameSchema, sideViewFrameSchema } from './settings.js';

/**
 * POST /ingest — the agent's outbox payload.
 *
 * Weighments and their audit entries travel together so a record and the trail
 * that explains it can never arrive out of step. The upsert is keyed on `id`,
 * so re-sending a batch after a timeout is safe by construction (brief §7.4).
 */
/**
 * What the cloud needs to know about a station.
 *
 * The company's name, address and phone used to travel here too, because the
 * operator could edit them on the weighbridge and the customer read them on the
 * QR page. They are now in code (COMPANY in @suarza/shared), identical on both
 * ends by construction, so there is nothing left to carry. An older agent that
 * still sends them is harmless: zod drops what the schema does not name.
 */
export const stationProfileSchema = z.object({
  station_id: z.string().min(1).max(16),
  /** What this station prints on. */
  paper_size: z.enum(['A4', 'A5', 'LETTER']).default('A5'),
  /**
   * The front view's zoom alone — what an agent sent before the front view
   * could be panned too. Still sent, as the front framing's zoom, so a cloud
   * that predates framing keeps cropping the front view the same way.
   */
  front_view_zoom: z
    .number()
    .min(FRONT_VIEW_ZOOM.min)
    .max(FRONT_VIEW_ZOOM.max)
    .default(FRONT_VIEW_ZOOM.default),
  /**
   * How this station's front view is zoomed and panned in its box. Absent
   * from an agent that predates it; the cloud then centres `front_view_zoom`.
   */
  front_view_frame: frontViewFrameSchema.optional(),
  /** How this station's side view is zoomed and panned in its box. */
  side_view_frame: sideViewFrameSchema.default({}),
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
  // A key, not an enum — the catalogue is the manager's to change.
  vehicle_type: vehicleTypeSchema.optional(),
  status: z.enum(WEIGHMENT_STATUSES).optional(),
  slip_number: z.string().trim().max(32).optional(),
  /**
   * Which shift's weighings to show.
   *
   * Filtered on the clock rather than on a stored label: a weighing records
   * when it happened and the shift is worked out from that, so correcting a
   * shift's hours re-reads every past record correctly. See shiftAt.
   */
  shift: z.enum(SHIFTS).optional(),
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
/**
 * A weighing's two photographs, and how its station frames them.
 *
 * One shape, used in two places on purpose: `GET /weighments/:slip/captures`
 * returns it, and every row of the weighments list now carries it as well.
 *
 * The list carrying it is what makes the dashboard's slip appear with its
 * pictures already arriving. Opening a slip used to mean a round trip to ask
 * which pictures it had, and only then could the browser start fetching them
 * — half a second of staring at the placeholder before the first byte of a
 * real photograph moved. The ids cost a hundred bytes a row and are already
 * in hand when the dialog opens.
 *
 * The framing travels with the ids rather than from an endpoint of its own:
 * it is not a fact about the station the manager might browse, it is how to
 * draw these two images, and sending them apart invites a preview that crops
 * differently from the slip it previews.
 */
export const slipCapturesSchema = z.object({
  /** Capture ids, for `/captures/:id`. Null where the bridge has no camera. */
  front: z.string().nullable(),
  side: z.string().nullable(),
  front_view_frame: frontViewFrameSchema,
  side_view_frame: sideViewFrameSchema,
  /** For a dashboard build that predates front framing. */
  front_view_zoom: z.number(),
});

export type SlipCaptures = z.infer<typeof slipCapturesSchema>;

export const weighmentRowSchema = weighmentSchema.extend({
  customer_id: z.string().nullable().default(null),
  /** Which shift this weighing fell in, and who was on it. */
  shift: z.enum(SHIFTS).optional(),
  operator_name: z.string().nullable().optional(),
  /*
   * Optional, because a dashboard may be talking to a server that predates
   * this and a server may be answering a dashboard that does — the dialog
   * asks for them the old way when they are not here.
   */
  captures: slipCapturesSchema.optional(),
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

// ---------------------------------------------------------------------------
// Operators and shifts — the manager's roster (client request, October 2026)
// ---------------------------------------------------------------------------

/**
 * One person on one shift.
 *
 * Not a login. The weighbridge has a single operator account used by whoever
 * is at the window; this is the manager's note of who that is, so a day's
 * takings can be read back against a name.
 */
export const operatorSchema = z.object({
  id: z.string(),
  name: z.string().trim().min(1).max(80),
  /** MORNING, NIGHT, or the administrator who belongs to neither. */
  slot: z.enum(OPERATOR_SLOTS),
  /** The shift this slot works; null for the administrator. */
  shift: z.enum(SHIFTS).nullable(),
  /** What they sign in to the weighbridge with; null until one is set. */
  username: z.string().nullable(),
  /**
   * Whether a password is set — never the password, and never its hash.
   *
   * The manager's screen needs to show "this account can sign in" without the
   * hash travelling to a browser, and the hash the bridge needs travels on a
   * different route, behind the ingest key.
   */
  has_password: z.boolean(),
  created_at: z.string().datetime({ offset: true }),
  updated_at: z.string().datetime({ offset: true }),
});

export type Operator = z.infer<typeof operatorSchema>;

/**
 * Put somebody in a slot, with or without credentials.
 *
 * The password is optional on purpose: renaming the morning operator must not
 * force the manager to retype a password they may not remember. Omitted means
 * "leave whatever is there", and the screen says so.
 */
export const createOperatorSchema = z.object({
  name: z.string().trim().min(1, 'Give the operator a name').max(80),
  slot: z.enum(OPERATOR_SLOTS),
  username: z
    .string()
    .trim()
    .toLowerCase()
    .max(64)
    .regex(/^[a-z0-9._-]*$/, 'Letters, numbers, dot, dash and underscore only')
    .optional(),
  password: z.string().min(4, 'Use at least four characters').max(200).optional(),
});

export type CreateOperatorInput = z.infer<typeof createOperatorSchema>;

/**
 * When each shift begins, as minutes from midnight.
 *
 * Two numbers, not four: the shifts divide the day between them and each runs
 * until the other starts. See DEFAULT_SHIFT_START_MINUTES for why a gap or an
 * overlap must not be expressible.
 */
export const shiftTimingsSchema = z.object({
  MORNING: z.number().int().min(0).max(1439),
  NIGHT: z.number().int().min(0).max(1439),
});

export type ShiftTimings = z.infer<typeof shiftTimingsSchema>;

export const rosterSchema = z.object({
  operators: z.array(operatorSchema),
  shift_timings: shiftTimingsSchema,
});

export type Roster = z.infer<typeof rosterSchema>;

/**
 * POST /weighments/:slip/void, from the manager's dashboard.
 *
 * The reason is optional here and mandatory at the bridge, which is not an
 * inconsistency: the operator voids a ticket in front of the customer it was
 * wrong for, and the reason is the only record of what happened. A manager
 * setting a slip aside already leaves a dated, named entry in the log, and
 * making them justify it in a box they can type "x" into buys nothing.
 */
export const managerVoidWeighmentSchema = z.object({
  reason: z.string().trim().max(500).default(''),
});

export type ManagerVoidWeighmentInput = z.infer<typeof managerVoidWeighmentSchema>;

// ---------------------------------------------------------------------------
// Operator sign-in at the bridge (client request, October 2026)
// ---------------------------------------------------------------------------

/**
 * A signed-in operator, as the weighbridge screen knows them.
 *
 * The session lives on the weighbridge PC, not in the cloud, and that is the
 * whole point: the yard must be able to start a shift with the internet down.
 * The credentials are the manager's — they are set in the dashboard — and
 * they reach the bridge with the rest of the manager's lists.
 */
export const operatorSessionSchema = z.object({
  token: z.string(),
  username: z.string(),
  name: z.string(),
  slot: z.enum(OPERATOR_SLOTS),
  /** Null for the administrator, who works no particular shift. */
  shift: z.enum(SHIFTS).nullable(),
  started_at: z.string().datetime({ offset: true }),
});

export type OperatorSession = z.infer<typeof operatorSessionSchema>;

/** What the bridge pulls down so a shift can start with no internet. */
export const operatorAccountSyncSchema = z.object({
  operators: z.array(
    z.object({
      username: z.string(),
      name: z.string(),
      slot: z.enum(OPERATOR_SLOTS),
      /** bcrypt, as the cloud stores it. The bridge only ever compares it. */
      password_hash: z.string(),
      updated_at: z.string(),
    }),
  ),
  synced_at: z.string(),
});

export type OperatorAccountSync = z.infer<typeof operatorAccountSyncSchema>;

// ---------------------------------------------------------------------------
// The log (client request, October 2026)
// ---------------------------------------------------------------------------

/**
 * What the log records, and nothing else yet.
 *
 * Deliberately a short list. A log that records everything is read by nobody;
 * these four are the events somebody actually asks about after the fact —
 * who was on the bridge, and which slips were set aside.
 */
export const LOG_KINDS = [
  'SHIFT_START',
  'SHIFT_END',
  'WEIGHMENT_VOID',
  'WEIGHMENT_RESTORE',
] as const;
export type LogKind = (typeof LOG_KINDS)[number];

export const LOG_KIND_LABELS: Record<LogKind, string> = {
  SHIFT_START: 'Shift started',
  SHIFT_END: 'Shift ended',
  WEIGHMENT_VOID: 'Slip voided',
  WEIGHMENT_RESTORE: 'Slip restored',
};

export const logEntrySchema = z.object({
  id: z.string(),
  kind: z.enum(LOG_KINDS),
  at: z.string().datetime({ offset: true }),
  /** Who did it — an operator's username, or the manager's. */
  actor: z.string(),
  actor_name: z.string(),
  /** The operator's slot, where the event has one. */
  slot: z.enum(OPERATOR_SLOTS).nullable(),
  /** What it was done to: a slip number, for the two weighment kinds. */
  subject: z.string().nullable(),
  /** A reason, or anything else worth reading beside the event. */
  detail: z.string().nullable(),
});

export type LogEntry = z.infer<typeof logEntrySchema>;

export const logQuerySchema = z.object({
  kind: z.enum(LOG_KINDS).optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(200).default(50),
});

export type LogQuery = z.infer<typeof logQuerySchema>;

export const paginatedLogsSchema = z.object({
  rows: z.array(logEntrySchema),
  total: z.number().int().min(0),
  page: z.number().int().min(1),
  page_size: z.number().int().min(1),
});

export type PaginatedLogs = z.infer<typeof paginatedLogsSchema>;

/**
 * Shift events on their way up from a bridge.
 *
 * They are written on the weighbridge PC — which is the only machine that
 * knows a shift has started — and pushed with the same key the weighings use.
 * Carrying their own ids means a retry after a half-delivered batch cannot
 * record the same shift twice.
 */
export const operatorLogPushSchema = z.object({
  entries: z
    .array(
      z.object({
        id: z.string().min(1).max(64),
        kind: z.enum(['SHIFT_START', 'SHIFT_END']),
        at: z.string(),
        username: z.string().min(1).max(64),
        name: z.string().max(80).default(''),
        slot: z.enum(OPERATOR_SLOTS),
        detail: z.string().max(200).nullable().default(null),
      }),
    )
    .max(200),
});

export type OperatorLogPush = z.infer<typeof operatorLogPushSchema>;
