/**
 * Pulling the manager's lists down to the weighbridge.
 *
 * On a button, not a timer. Two reasons, both about the operator rather than
 * the data: a list must never change under someone mid-weighing, and an
 * operator told "the new rate is live" needs to be able to make that true now
 * instead of waiting for a sweep.
 *
 * The pull replaces nothing wholesale — it merges, so a customer this bridge
 * already knew from weighing them keeps their local history and simply gains
 * the manager's spelling and their cloud id.
 */

import {
  customerSyncResponseSchema,
  nowUtc,
  vehicleTypeSyncResponseSchema,
  type SyncOutcome,
} from '@suarza/shared';
import type { Db } from '../db/connection.js';
import { applyCustomerSync } from '../db/customers.js';
import { VehicleTypeRepository } from '../db/vehicle-types.js';
import { MetaStore, META_KEYS } from '../db/meta.js';
import { AppError } from '../errors.js';

export interface CatalogueSyncOptions {
  db: Db;
  baseUrl: string;
  apiKey: string;
  timeoutMs?: number;
}

async function fetchJson(
  url: string,
  apiKey: string,
  timeoutMs: number,
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(url, {
      headers: { 'x-api-key': apiKey },
      signal: controller.signal,
    });
  } catch (error) {
    // The operator pressed a button and is waiting, so this says what to do
    // rather than what went wrong inside.
    throw new AppError(
      'CLOUD_UNREACHABLE',
      'Could not reach the server. Check the internet connection and try again.',
      { cause: error instanceof Error ? error.message : String(error) },
    );
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw new AppError(
      'CLOUD_REJECTED',
      response.status === 401
        ? 'The server refused this weighbridge. Check the cloud API key in the agent configuration.'
        : `The server returned an error (${response.status}).`,
      { status: response.status },
    );
  }

  return response.json();
}

export class CatalogueSync {
  private readonly meta: MetaStore;
  private readonly vehicleTypes: VehicleTypeRepository;
  private readonly timeoutMs: number;

  constructor(private readonly options: CatalogueSyncOptions) {
    this.meta = new MetaStore(options.db);
    this.vehicleTypes = new VehicleTypeRepository(options.db);
    this.timeoutMs = options.timeoutMs ?? 20_000;
  }

  private url(path: string): string {
    return `${this.options.baseUrl.replace(/\/+$/, '')}${path}`;
  }

  async syncCustomers(): Promise<SyncOutcome> {
    const body = await fetchJson(this.url('/api/sync/customers'), this.options.apiKey, this.timeoutMs);
    const parsed = customerSyncResponseSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError('CLOUD_REJECTED', 'The server sent a customer list this agent cannot read.');
    }

    const counts = applyCustomerSync(this.options.db, parsed.data.customers);
    const at = nowUtc();
    this.meta.set(META_KEYS.customersSyncedAt, at);

    return {
      ...counts,
      total: parsed.data.customers.filter((customer) => !customer.deleted_at).length,
      synced_at: at,
    };
  }

  async syncVehicleTypes(): Promise<SyncOutcome> {
    const body = await fetchJson(
      this.url('/api/sync/vehicle-types'),
      this.options.apiKey,
      this.timeoutMs,
    );
    const parsed = vehicleTypeSyncResponseSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError('CLOUD_REJECTED', 'The server sent a rate card this agent cannot read.');
    }

    const counts = this.vehicleTypes.applySync(parsed.data.vehicle_types);
    const at = nowUtc();
    this.meta.set(META_KEYS.vehicleTypesSyncedAt, at);

    return {
      ...counts,
      total: this.vehicleTypes.count(),
      synced_at: at,
    };
  }

  /** When each list was last pulled, for the Settings screen to show. */
  lastSyncedAt(): { customers: string | null; vehicle_types: string | null } {
    return {
      customers: this.meta.get(META_KEYS.customersSyncedAt),
      vehicle_types: this.meta.get(META_KEYS.vehicleTypesSyncedAt),
    };
  }
}
