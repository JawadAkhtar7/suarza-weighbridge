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
  Customer,
  StationSettings,
  CompleteWeighmentInput,
  CreateWeighmentInput,
  LiveWeight,
  NetWeight,
  SyncStatus,
  VoidWeighmentInput,
  Weighment,
} from '@suarza/shared';

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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers: { 'content-type': 'application/json', ...init?.headers },
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

  saveSettings: (settings: StationSettings) =>
    request<StationSettings>('/settings', { method: 'PUT', body: JSON.stringify(settings) }),

  getSyncStatus: () => request<SyncStatus>('/sync-status'),

  createWeighment: (input: CreateWeighmentInput) =>
    request<CreateWeighmentResponse>('/weighments', {
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

  voidWeighment: (slip: string, input: VoidWeighmentInput) =>
    request<{ weighment: Weighment }>(`/weighments/${encodeURIComponent(slip)}/void`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  /** Recent weighments for the quick-pick list. */
  listWeighments: (options: { status?: string; limit?: number } = {}) => {
    const params = new URLSearchParams();
    if (options.status) params.set('status', options.status);
    params.set('limit', String(options.limit ?? 20));
    return request<{ rows: Weighment[]; count: number }>(`/weighments?${params.toString()}`);
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
 */
export function receiptPdfUrl(slipNumber: string): string {
  return `/weighments/${encodeURIComponent(slipNumber)}/pdf`;
}

/** The standalone printable page, opened in its own tab. */
export function printPageUrl(slipNumber: string, variant: 'FIRST' | 'SECOND'): string {
  const params = new URLSearchParams({ variant });
  return `/print/${encodeURIComponent(slipNumber)}?${params.toString()}`;
}
