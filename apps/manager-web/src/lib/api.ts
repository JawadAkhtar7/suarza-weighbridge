/**
 * Cloud API client.
 *
 * Relative URLs: in production the server serves this app, so every call is
 * same-origin; in development Vite proxies the same paths (see vite.config.ts).
 */

import type {
  Analytics,
  CreateCustomerInput,
  CreateOperatorInput,
  Operator,
  Roster,
  ShiftTimings,
  CustomerRecord,
  VehicleTypeRecord,
  CreateLedgerEntryInput,
  LedgerCustomer,
  LedgerEntry,
  LedgerEntryWithBalance,
  LedgerQuery,
  LedgerSummary,
  LoginResponse,
  PaginatedWeighments,
  ViewFrame,
  Weighment,
  WeighmentQuery,
} from '@suarza/shared';

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** The session is gone — the shell signs the manager out on this. */
  get isUnauthorized(): boolean {
    return this.status === 401;
  }
}

let authToken: string | null = null;

export function setAuthToken(token: string | null): void {
  authToken = token;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers: {
        'content-type': 'application/json',
        ...(authToken ? { authorization: `Bearer ${authToken}` } : {}),
        ...init?.headers,
      },
    });
  } catch {
    throw new ApiError('NETWORK_ERROR', 'Cannot reach the server. Check your connection.', 0);
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: { code?: string; message?: string };
    } | null;
    throw new ApiError(
      body?.error?.code ?? 'UNKNOWN_ERROR',
      body?.error?.message ?? `Request failed (${response.status})`,
      response.status,
    );
  }

  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    // A route missing from the dev proxy is answered by Vite's SPA fallback
    // with index.html and a 200. Parsing that as JSON fails silently and looks
    // exactly like "no results", so it is caught here instead.
    throw new ApiError(
      'UNEXPECTED_RESPONSE',
      `${path} did not return JSON. If this is the dev server, the route is probably missing from the proxy list in vite.config.ts.`,
      response.status,
    );
  }

  return (await response.json()) as T;
}

/**
 * Drops empty filters so the URL says what is actually being filtered on.
 * Takes any flat query object — the weighment filters and the ledger's both.
 */
function toQueryString(query: Record<string, unknown>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    params.set(key, String(value));
  }
  return params.toString();
}

export const api = {
  login: (username: string, password: string) =>
    request<LoginResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),

  weighments: (query: Partial<WeighmentQuery>) =>
    request<PaginatedWeighments>(`/weighments?${toQueryString(query)}`),

  weighment: (slip: string) =>
    request<{ weighment: Weighment }>(`/weighments/${encodeURIComponent(slip)}`),

  /**
   * The camera stills for a weighing, and how its bridge frames the front one;
   * nulls on a bridge without cameras.
   */
  weighmentCaptures: (slip: string) =>
    request<{
      front: string | null;
      side: string | null;
      front_view_zoom: number;
      /* Absent from a server that predates front framing: fall back to the zoom. */
      front_view_frame?: ViewFrame;
      side_view_frame?: ViewFrame;
    }>(`/weighments/${encodeURIComponent(slip)}/captures`),

  /**
   * Delete a weighing and everything joined to it.
   *
   * Admin only on the server; the button is hidden for anyone else so a
   * manager is not offered something that will be refused.
   */
  deleteWeighment: (slip: string) =>
    request<{
      slip_number: string;
      audit_entries: number;
      ledger_entries: number;
      photographs: number;
    }>(`/weighments/${encodeURIComponent(slip)}`, { method: 'DELETE' }),

  // --- The roster -----------------------------------------------------------

  roster: () => request<Roster>('/operators'),

  setOperator: (input: CreateOperatorInput) =>
    request<Operator>('/operators', { method: 'POST', body: JSON.stringify(input) }),

  removeOperator: (id: string) =>
    request<void>(`/operators/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  setShiftTimings: (timings: ShiftTimings) =>
    request<ShiftTimings>('/shift-timings', { method: 'PUT', body: JSON.stringify(timings) }),

  analytics: (query: Partial<WeighmentQuery>) =>
    request<Analytics>(`/analytics?${toQueryString(query)}`),

  /** Names already in the records, for the filter typeahead. */
  suggestions: (field: 'customer_name' | 'customer_company', q: string) =>
    request<{ values: string[] }>(`/suggestions?${new URLSearchParams({ field, q }).toString()}`),

  // --- Ledger --------------------------------------------------------------

  ledgerSummary: () => request<LedgerSummary>('/api/ledger/summary'),

  ledgerCustomers: (query: Partial<LedgerQuery>) =>
    request<LedgerCustomerPage>(`/api/ledger/customers?${toQueryString(query)}`),

  ledgerCustomer: (id: string) =>
    request<{ customer: LedgerCustomer; entries: LedgerEntryWithBalance[] }>(
      `/api/ledger/customers/${encodeURIComponent(id)}`,
    ),

  addLedgerEntry: (customerId: string, body: CreateLedgerEntryInput) =>
    request<{ entry: LedgerEntry; customer: LedgerCustomer }>(
      `/api/ledger/customers/${encodeURIComponent(customerId)}/entries`,
      { method: 'POST', body: JSON.stringify(body) },
    ),

  // --- Customers and the rate card -----------------------------------------

  customers: (q?: string) =>
    request<{ customers: CustomerRecord[] }>(
      `/api/customers${q ? `?q=${encodeURIComponent(q)}` : ''}`,
    ),

  createCustomer: (body: CreateCustomerInput) =>
    request<{ customer: CustomerRecord }>('/api/customers', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  updateCustomer: (id: string, body: { name: string; company: string; phone?: string | null }) =>
    request<{ customer: CustomerRecord }>(`/api/customers/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  deleteCustomer: (id: string) =>
    request<{ customer: CustomerRecord }>(`/api/customers/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  vehicleTypes: () => request<{ vehicle_types: VehicleTypeRecord[] }>('/api/vehicle-types'),

  createVehicleType: (body: { label: string; rate_pkr: number }) =>
    request<{ vehicle_type: VehicleTypeRecord }>('/api/vehicle-types', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  updateVehicleType: (id: string, body: { label: string; rate_pkr: number }) =>
    request<{ vehicle_type: VehicleTypeRecord }>(`/api/vehicle-types/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  deleteVehicleType: (id: string) =>
    request<{ vehicle_type: VehicleTypeRecord }>(`/api/vehicle-types/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  voidLedgerEntry: (customerId: string, entryId: string, reason: string) =>
    request<{ entry: LedgerEntry; customer: LedgerCustomer }>(
      `/api/ledger/customers/${encodeURIComponent(customerId)}/entries/${encodeURIComponent(entryId)}/void`,
      { method: 'POST', body: JSON.stringify({ reason }) },
    ),
};

export interface LedgerCustomerPage {
  customers: LedgerCustomer[];
  total: number;
  page: number;
  page_size: number;
}

/**
 * The public slip page. There is no generated PDF any more — the page is the
 * slip, and a browser's "Save as PDF" produces the file at A5.
 */
export function receiptPageUrl(slipNumber: string): string {
  return `/r/${encodeURIComponent(slipNumber)}`;
}
