/**
 * Agent client.
 *
 * Relative URLs throughout: in production the agent serves this app, so every
 * call is same-origin; in development Vite proxies the same paths to the agent
 * (see vite.config.ts). Nothing here ever points at the internet — the operator
 * app talks only to the PC it runs on.
 */

import type {
  AuditEntry,
  OperatorSession,
  Customer,
  FramingUpdate,
  StationSettings,
  CompleteWeighmentInput,
  CreateCompletedWeighmentInput,
  CreateWeighmentInput,
  LiveWeight,
  NetWeight,
  SyncOutcome,
  SyncStatus,
  Weighment,
} from '@suarza/shared';

export interface SettingsCredentials {
  username: string;
  password: string;
}

/**
 * `Basic base64(username:password)`.
 *
 * Through UTF-8 rather than `btoa` on the raw string: `btoa` throws on any
 * character above U+00FF, and a password nobody can type is worse than one
 * nobody can guess.
 */
function basicAuth({ username, password }: SettingsCredentials): string {
  const bytes = new TextEncoder().encode(`${username}:${password}`);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `Basic ${btoa(binary)}`;
}

export interface AgentWarning {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface CreateWeighmentResponse {
  weighment: Weighment;
  warnings: AgentWarning[];
}

export interface WeighmentResponse {
  weighment: Weighment;
  net: NetWeight;
}

/** Carries the agent's stable error code so callers can branch on the flow. */
export class AgentApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AgentApiError';
  }

  /** True when the agent could not be reached at all, as opposed to refusing. */
  get isUnreachable(): boolean {
    return this.code === 'AGENT_UNREACHABLE';
  }
}

/**
 * The shift in progress, held here so every call can carry it.
 *
 * A module variable rather than something threaded through each caller: the
 * token identifies the person at the window, not the request, and there is
 * exactly one of them per browser.
 */
let shiftToken: string | null = null;
let shiftUsername: string | null = null;

export function setShiftToken(token: string | null, username?: string | null): void {
  shiftToken = token;
  shiftUsername = token ? (username ?? shiftUsername) : null;
}

/**
 * Who is at the window, for stamping onto the records they save.
 *
 * Null when nobody is signed in — a bridge with no accounts yet — and the
 * callers fall back to the single shared username the app used before
 * anybody signed in at all.
 */
export function signedInUsername(): string | null {
  return shiftUsername;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers: {
        ...(shiftToken ? { authorization: `Bearer ${shiftToken}` } : {}),
        // Only when there IS a body. Fastify refuses an empty body that claims
        // to be JSON — so a POST that carries nothing, like the sync buttons,
        // was rejected before it reached its handler.
        ...(init?.body === undefined ? {} : { 'content-type': 'application/json' }),
        ...init?.headers,
      },
    });
  } catch {
    // The service is stopped, still starting, or the machine is mid-reboot.
    // This is a different problem from a rejected request and the UI says so.
    throw new AgentApiError(
      'AGENT_UNREACHABLE',
      'Cannot reach the weighbridge service on this PC.',
      0,
    );
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: { code?: string; message?: string; details?: unknown };
    } | null;
    throw new AgentApiError(
      body?.error?.code ?? 'UNKNOWN_ERROR',
      body?.error?.message ?? `Request failed (${response.status})`,
      response.status,
      body?.error?.details,
    );
  }

  return parseJson<T>(response, path);
}

/**
 * Reads the body as JSON, but complains loudly if it is not.
 *
 * This exists because of a bug that was invisible for a while: a route missing
 * from the dev proxy is answered by Vite's SPA fallback with index.html and a
 * 200, so the app silently parsed HTML as JSON and showed an empty list rather
 * than an error. A wrong answer that looks like "no results" is far worse than
 * a failure that says what happened.
 */
async function parseJson<T>(response: Response, path: string): Promise<T> {
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    throw new AgentApiError(
      'UNEXPECTED_RESPONSE',
      `${path} did not return JSON. If this is the dev server, the route is probably missing from the proxy list in vite.config.ts.`,
      response.status,
    );
  }
  return (await response.json()) as T;
}

export const agentApi = {
  getLiveWeight: () => request<LiveWeight>('/live-weight'),

  getSettings: () => request<StationSettings>('/settings'),

  /**
   * Save the settings. The agent refuses this without a station login.
   *
   * Basic auth: the credentials go on the one request that needs them and are
   * never stored, so closing the dialog is the whole of logging out.
   */
  saveSettings: (settings: StationSettings, credentials: SettingsCredentials) =>
    request<StationSettings>('/settings', {
      method: 'PUT',
      body: JSON.stringify(settings),
      headers: { authorization: basicAuth(credentials) },
    }),

  /**
   * Reframe one camera's picture. No login: see the agent's
   * PUT /settings/framing for why this one is open and narrow.
   */
  saveFraming: (framing: FramingUpdate) =>
    request<StationSettings>('/settings/framing', {
      method: 'PUT',
      body: JSON.stringify(framing),
    }),

  getSyncStatus: () => request<SyncStatus>('/sync-status'),

  // --- The manager's lists, pulled on demand -------------------------------

  getVehicleTypes: () =>
    request<{
      vehicle_types: { key: string; label: string; rate_pkr: number }[];
      last_synced_at: {
        customers: string | null;
        vehicle_types: string | null;
        operators?: string | null;
      };
    }>('/vehicle-types'),

  syncCustomers: () => request<SyncOutcome>('/sync/customers', { method: 'POST' }),

  syncVehicleTypes: () => request<SyncOutcome>('/sync/vehicle-types', { method: 'POST' }),

  /** The operator accounts, so a shift can start with the link down. */
  syncOperators: () => request<SyncOutcome>('/sync/operators', { method: 'POST' }),

  // --- Starting and ending a shift -----------------------------------------

  /**
   * Whether this bridge signs anybody in, and who is signed in now.
   *
   * `required` is false on a bridge that has never pulled the accounts down.
   * The screen then lets the operator straight through rather than locking
   * the yard out of weighing until somebody can be telephoned.
   */
  operatorAuth: () =>
    request<{ required: boolean; session: OperatorSession | null }>('/operator/auth'),

  startShift: (username: string, password: string) =>
    request<{ session: OperatorSession }>('/operator/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),

  endShift: () => request<{ ended: boolean }>('/operator/auth/logout', { method: 'POST' }),

  createWeighment: (input: CreateWeighmentInput) =>
    request<CreateWeighmentResponse>('/weighments', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  /** A weighing done in one visit: the driver gave us the empty weight. */
  createCompletedWeighment: (input: CreateCompletedWeighmentInput) =>
    request<CreateWeighmentResponse>('/weighments/complete', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  getWeighment: (slip: string) =>
    request<WeighmentResponse>(`/weighments/${encodeURIComponent(slip)}`),

  completeWeighment: (slip: string, input: CompleteWeighmentInput) =>
    request<WeighmentResponse>(`/weighments/${encodeURIComponent(slip)}/complete`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),

  cameraStatus: () => request<CameraStatus>('/cameras'),

  /**
   * Photograph the bridge now and hold it for the save that follows.
   *
   * Called the instant a weight is captured, because that is when the truck
   * is on the plate — by the time the form is filled in and saved it has
   * usually gone. Answers immediately with a token; the cameras are still
   * working when it returns.
   *
   * `capture_id: null` means this station has no cameras, which is not an
   * error: the weighing carries on and the slip prints the placeholder.
   */
  captureNow: () => request<{ capture_id: string | null }>('/camera/capture', { method: 'POST' }),

  /** Let go of held pictures the operator has cleared. Housekeeping only. */
  discardCapture: (id: string) =>
    request<{ discarded: boolean }>(`/camera/capture/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  slipCaptures: (slip: string) =>
    request<SlipCaptures>(`/weighments/${encodeURIComponent(slip)}/captures`),

  /** Recent weighments for the quick-pick list. */
  listWeighments: (
    options: { status?: string; q?: string; limit?: number; offset?: number } = {},
  ) => {
    const params = new URLSearchParams();
    if (options.status) params.set('status', options.status);
    // Searched by the weighbridge across every record, not filtered in the
    // browser across the page that happens to be loaded.
    if (options.q?.trim()) params.set('q', options.q.trim());
    params.set('limit', String(options.limit ?? 20));
    if (options.offset) params.set('offset', String(options.offset));
    // `total` is every record the filter matches, not just this page.
    return request<{ rows: Weighment[]; count: number; total: number }>(
      `/weighments?${params.toString()}`,
    );
  },

  /** Customers this station has weighed before. */
  searchCustomers: (query: string, limit = 15) => {
    const params = new URLSearchParams({ q: query, limit: String(limit) });
    return request<{ customers: Customer[] }>(`/customers?${params.toString()}`);
  },

  reprintWeighment: (slip: string, receipt: 'FIRST' | 'SECOND') =>
    request<WeighmentResponse & { audit_entry: AuditEntry }>(
      `/weighments/${encodeURIComponent(slip)}/reprint`,
      { method: 'POST', body: JSON.stringify({ receipt }) },
    ),
};

/**
 * The receipt PDF, built by the AGENT on this machine.
 *
 * Not the cloud's copy: the operator has to be able to hand a customer a PDF
 * with the internet down, which is precisely when the cloud one is unreachable.

/**
 * The cameras.
 *
 * All same-origin: the agent serves this app, so these are plain paths and
 * the camera password never leaves that machine.
 */
export interface CameraStatus {
  enabled: boolean;
  views: ('FRONT' | 'SIDE')[];
  live_fps: number;
}

export interface SlipCaptures {
  front: string | null;
  side: string | null;
  /** The cameras are still being asked; the ids above may be about to change. */
  pending?: boolean;
}

/** A stored still. Immutable, so the browser may cache it forever. */
export function captureImageUrl(id: string): string {
  return `/captures/${encodeURIComponent(id)}`;
}

/**
 * The live MJPEG stream for one camera.
 *
 * The cache-buster matters: without it a browser will happily reuse a closed
 * multipart stream from a previous mount and show a frozen frame forever.
 */
export function cameraLiveUrl(view: 'FRONT' | 'SIDE', nonce: string | number): string {
  return `/camera/${view.toLowerCase()}/live?t=${nonce}`;
}

/** The standalone printable page, opened in its own tab. */
export function printPageUrl(slipNumber: string, variant: 'FIRST' | 'SECOND'): string {
  const params = new URLSearchParams({ variant });
  return `/print/${encodeURIComponent(slipNumber)}?${params.toString()}`;
}
