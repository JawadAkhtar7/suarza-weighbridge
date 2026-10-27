/** Cloud API contracts (brief §5, §11, §13-M5) shared by agent, server, manager app. */

import { z } from 'zod';
import { vehicleTypeSchema, weighmentSchema } from './weighment.js';
import { auditEntrySchema } from './audit.js';
import { WEIGHMENT_STATUSES, USER_ROLES } from '../constants/domain.js';
import { FRONT_VIEW_ZOOM } from '../constants/paper.js';
import { OPERATOR_ROLES, SHIFTS } from '../constants/shifts.js';
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
  /**
   * A plate, matched on any part of it.
   *
   * Partial on purpose: a manager looking for a truck remembers four digits
   * of a plate far more often than the whole of it, and the yard writes the
   * same plate down with and without its dash.
   */
  vehicle_plate: z.string().trim().max(32).optional(),
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
/**
 * One person who may sign in at the weighbridge.
 *
 * A plain list of accounts, as many as the yard has people. It began as a
 * roster of two shifts plus an administrator, which could not hold a third
 * operator or a relief driver, and tied a question about hours to a question
 * about access. Hours are read off the clock now; this answers only who may
 * sign in and what they may do.
 */
export const operatorSchema = z.object({
  id: z.string(),
  name: z.string().trim().min(1).max(80),
  role: z.enum(OPERATOR_ROLES),
  /** What they sign in to the weighbridge with; null until one is set. */
  username: z.string().nullable(),
  /**
   * Whether a password is set — never the password, and never its hash.
   *
   * The manager's screen needs to show "this account can sign in" without
   * the hash travelling to a browser, and the hash the bridge needs travels
   * on a different route, behind the ingest key.
   */
  has_password: z.boolean(),
  created_at: z.string().datetime({ offset: true }),
  updated_at: z.string().datetime({ offset: true }),
});

export type Operator = z.infer<typeof operatorSchema>;

/**
 * Add somebody, or change them.
 *
 * The password is optional on purpose: renaming somebody, or making them an
 * administrator, must not force the manager to retype a password they may
 * not remember. Omitted means "leave whatever is there", and the screen says
 * so.
 */
export const saveOperatorSchema = z.object({
  /** Absent when adding; present when editing an account that exists. */
  id: z.string().min(1).max(64).optional(),
  name: z.string().trim().min(1, 'Give this person a name').max(80),
  username: z
    .string()
    .trim()
    .toLowerCase()
    .min(1, 'A username is needed to sign in')
    .max(64)
    .regex(/^[a-z0-9._-]+$/, 'Letters, numbers, dot, dash and underscore only'),
  password: z.string().min(4, 'Use at least four characters').max(200).optional(),
  role: z.enum(OPERATOR_ROLES).default('OPERATOR'),
});

export type SaveOperatorInput = z.infer<typeof saveOperatorSchema>;

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
  /**
   * The shift's own id, which its two log entries share.
   *
   * Separate from the token on purpose: the token opens the screen on one PC
   * and has no business leaving it, while this travels to the manager so a
   * start and an end can be read back as one shift.
   */
  session_id: z.string(),
  username: z.string(),
  name: z.string(),
  role: z.enum(OPERATOR_ROLES),
  started_at: z.string().datetime({ offset: true }),
});

export type OperatorSession = z.infer<typeof operatorSessionSchema>;

/** What the bridge pulls down so a shift can start with no internet. */
export const operatorAccountSyncSchema = z.object({
  operators: z.array(
    z.object({
      username: z.string(),
      name: z.string(),
      role: z.enum(OPERATOR_ROLES),
      /** bcrypt, as the cloud stores it. The bridge only ever compares it. */
      password_hash: z.string(),
      updated_at: z.string(),
    }),
  ),
  synced_at: z.string(),
});

export type OperatorAccountSync = z.infer<typeof operatorAccountSyncSchema>;

// ---------------------------------------------------------------------------
// The cash a shift hands over (client request, October 2026)
// ---------------------------------------------------------------------------

/**
 * One handing-over of money during a shift.
 *
 * FOUR FIGURES, because cash moves both ways at a handover: an operator can
 * be given the night's takings and hand back a float in the same minute, and
 * both a colleague and the manager can be on the other side of it. The names
 * travel beside the figures because "who" is half of the answer — a figure
 * with nobody's name against it settles no argument later.
 *
 * Every amount may be zero, and usually some are. A zero that was typed is a
 * statement; a blank is an absence, and the screen records the first rather
 * than guessing at the second.
 */
export const shiftCashMovementSchema = z.object({
  person_name: z.string().trim().max(80).default(''),
  person_taken: z.number().finite().min(0).max(100_000_000).default(0),
  person_given: z.number().finite().min(0).max(100_000_000).default(0),
  manager_name: z.string().trim().max(80).default(''),
  manager_taken: z.number().finite().min(0).max(100_000_000).default(0),
  manager_given: z.number().finite().min(0).max(100_000_000).default(0),
});

export type ShiftCashMovement = z.infer<typeof shiftCashMovementSchema>;

/**
 * Which end of the shift a movement was written down at.
 *
 * The screen no longer asks: money moves at any hour, every movement
 * carries its own time, and the shift's start and end are already in the
 * log. The field stays because records already written have it, and it
 * defaults to START for anything written from now on.
 */
export const SHIFT_CASH_STAGES = ['START', 'END'] as const;
export type ShiftCashStage = (typeof SHIFT_CASH_STAGES)[number];

/**
 * A movement, as recorded: with its own time and its own id.
 *
 * A LIST, not one figure per end of the shift. Money changes hands more than
 * twice in a day — a manager collects at noon, a colleague covers an hour,
 * the float is topped up — and the first version of this overwrote each
 * entry with the next, so a shift could only ever show the last thing that
 * happened. Every submission is now its own line, with the time on it.
 */
export const shiftCashEntrySchema = shiftCashMovementSchema.extend({
  id: z.string(),
  session_id: z.string(),
  stage: z.enum(SHIFT_CASH_STAGES),
  at: z.string(),
});

export type ShiftCashEntry = z.infer<typeof shiftCashEntrySchema>;

/** What the operator's screen sends: a movement, and which end it belongs to. */
export const shiftCashInputSchema = shiftCashMovementSchema.extend({
  stage: z.enum(SHIFT_CASH_STAGES).default('START'),
});

export type ShiftCashInput = z.infer<typeof shiftCashInputSchema>;

/** Movements on their way up from a bridge, with the ids it gave them. */
export const shiftCashPushSchema = z.object({
  entries: z
    .array(
      shiftCashEntrySchema.extend({
        /** Who wrote it down, so the cloud can file it without a lookup. */
        operator: z.string().min(1).max(64),
      }),
    )
    .max(200),
});

export type ShiftCashPush = z.infer<typeof shiftCashPushSchema>;

/**
 * What one person did, one line at a time.
 *
 * Five kinds of thing happen in a shift and they are read as one story, in
 * the order they happened: a truck weighed, a shift begun or ended, money
 * taken or given. Three separate tables — one per source — made the reader
 * do the ordering in their head.
 *
 * FLAT, not a union per kind. Every line lands in the same table with the
 * same columns, and the fields a kind does not use are null; a discriminated
 * union would be tidier in TypeScript and messier everywhere the table is
 * actually drawn.
 */
export const REPORT_ACTIVITY_KINDS = [
  'WEIGHMENT',
  'SHIFT_START',
  'SHIFT_END',
  'MONEY_TAKEN',
  'MONEY_GIVEN',
] as const;
export type ReportActivityKind = (typeof REPORT_ACTIVITY_KINDS)[number];

export const reportActivitySchema = z.object({
  id: z.string(),
  kind: z.enum(REPORT_ACTIVITY_KINDS),
  at: z.string().datetime({ offset: true }),
  /** Money: what was charged, taken or given. Zero for a shift event. */
  amount: z.number().default(0),
  /** The weighing's own number, for the two kinds that have one. */
  slip_number: z.string().nullable().default(null),
  vehicle_type: z.string().nullable().default(null),
  vehicle_type_label: z.string().nullable().default(null),
  vehicle_plate: z.string().nullable().default(null),
  /** Who the money came from or went to. */
  counterpart: z.string().nullable().default(null),
  /** Anything else worth reading on the line — how long a shift ran. */
  detail: z.string().nullable().default(null),
  /**
   * Who wrote this down, when it was not the person the report is about.
   *
   * A handover has two sides and is recorded by one of them. The other
   * person's report shows it too — the other way round — and says whose
   * record it came from, because "I never wrote that" is exactly the thing
   * somebody will want to know.
   */
  recorded_by: z.string().nullable().default(null),
});

export type ReportActivity = z.infer<typeof reportActivitySchema>;

/**
 * One person's account of a stretch of time.
 *
 * Built from three things that are each recorded for their own reasons — the
 * weighings, the money written down, and the shift log — and added up here
 * rather than stored anywhere. A stored total is a total that can disagree
 * with the records it came from, and the whole value of a report is that it
 * cannot.
 */
export const userReportSchema = z.object({
  operator: z.string(),
  operator_name: z.string(),
  role: z.enum(OPERATOR_ROLES),
  from: z.string().datetime({ offset: true }),
  to: z.string().datetime({ offset: true }),

  /** Weighings this person saved in the range; voided ones excluded. */
  weighments: z.number().int().min(0),
  /** What those weighings charged. */
  takings: z.number(),
  /** Money handed TO them, and money they handed on. */
  money_taken: z.number(),
  money_given: z.number(),

  /** Everything that happened, oldest first. */
  activities: z.array(reportActivitySchema),
  /**
   * True when there was more than one page of it.
   *
   * A month of weighings is thousands of lines, and a report nobody can
   * scroll to the end of is not more honest than one that says so.
   */
  truncated: z.boolean().default(false),
});

export type UserReport = z.infer<typeof userReportSchema>;

export const userReportQuerySchema = z.object({
  /** Whose report. A username, as the records carry it. */
  operator: z.string().trim().min(1).max(64),
  from: z.string().datetime({ offset: true }),
  to: z.string().datetime({ offset: true }),
});

export type UserReportQuery = z.infer<typeof userReportQuerySchema>;

// ---------------------------------------------------------------------------
// The manager's own pocket (client request, October 2026)
// ---------------------------------------------------------------------------

/**
 * What the manager has in hand.
 *
 * A manager is a party to the same handovers the operators record — the
 * takings come in at the end of a shift, a float goes out at the start —
 * and until now they could only watch those movements from the other side.
 * This is the same ledger read from theirs: everything that named them,
 * whoever wrote it down, plus what they record here themselves.
 *
 * `net` is what the arithmetic says they are holding: taken less given. It
 * is counted from the movements each time, never stored.
 */
export const managerPocketSchema = z.object({
  /** Whose pocket — the signed-in manager's own username. */
  manager: z.string(),
  manager_name: z.string(),

  /** Every movement ever, so the headline figure means "in hand now". */
  all_time_taken: z.number(),
  all_time_given: z.number(),
  all_time_net: z.number(),

  from: z.string().datetime({ offset: true }),
  to: z.string().datetime({ offset: true }),
  range_taken: z.number(),
  range_given: z.number(),
  range_net: z.number(),

  /** The movements inside the range, newest first. */
  movements: z.array(reportActivitySchema),
});

export type ManagerPocket = z.infer<typeof managerPocketSchema>;

export const managerPocketQuerySchema = z.object({
  from: z.string().datetime({ offset: true }),
  to: z.string().datetime({ offset: true }),
});

export type ManagerPocketQuery = z.infer<typeof managerPocketQuerySchema>;

/**
 * One movement, as the manager records it.
 *
 * The same two figures the operators are asked for, from the manager's own
 * side: what they took from this person, and what they gave them.
 */
export const managerCashSchema = z.object({
  person_name: z.string().trim().min(1, 'Choose who the money moved with').max(80),
  taken: z.number().finite().min(0).max(100_000_000).default(0),
  given: z.number().finite().min(0).max(100_000_000).default(0),
});

export type ManagerCashInput = z.infer<typeof managerCashSchema>;

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
  /** What the person was allowed to do, where the event names a person. */
  role: z.enum(OPERATOR_ROLES).nullable(),
  /** What it was done to: a slip number, for the two weighment kinds. */
  subject: z.string().nullable(),
  /** A reason, or anything else worth reading beside the event. */
  detail: z.string().nullable(),
  /**
   * Both entries of one shift share this; null for everything else.
   *
   * The money is NOT here: it is a list of its own, because cash changes
   * hands more than twice in a day. See shiftCashEntrySchema.
   */
  session_id: z.string().nullable().default(null),
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
        role: z.enum(OPERATOR_ROLES).default('OPERATOR'),
        detail: z.string().max(200).nullable().default(null),
        /* The two entries of one shift carry the same id, which is how the
           audit screen reads a start and an end back as one shift. */
        session_id: z.string().max(64).nullable().default(null),
      }),
    )
    .max(200),
});

export type OperatorLogPush = z.infer<typeof operatorLogPushSchema>;
