/**
 * Weighment data access. Every write is synchronous and committed before the
 * caller returns — the local DB is the source of truth and the cloud finds out
 * later (brief §7.3).
 */

import type { Weighment, WeighmentStatus } from '@suarza/shared';
import type { Db } from './connection.js';

/** The row as SQLite stores it: no booleans, no undefined. */
interface WeighmentRow {
  id: string;
  slip_number: string;
  status: string;
  station_id: string;
  customer_name: string;
  customer_company: string;
  customer_phone: string | null;
  vehicle_type: string;
  vehicle_plate: string;
  container_number: string | null;
  product: string;
  first_weight_kg: number;
  first_weight_at: string;
  first_weight_src: string;
  second_weight_kg: number | null;
  second_weight_at: string | null;
  second_weight_src: string | null;
  net_weight_kg: number;
  amount_charged: number;
  currency: string;
  operator_username: string;
  created_at: string;
  updated_at: string;
  void_reason: string | null;
  voided_at: string | null;
  synced: number;
  sync_attempts: number;
  last_attempt_at: string | null;
  sync_blocked_reason: string | null;
  sync_blocked_at: string | null;
}

/** Local-only sync bookkeeping, kept out of the synced DTO (brief §6). */
export interface SyncState {
  synced: boolean;
  sync_attempts: number;
  last_attempt_at: string | null;
  /** Why the cloud will never take this record. NULL = still being retried. */
  blocked_reason: string | null;
  blocked_at: string | null;
}

export type WeighmentWithSync = Weighment & { sync: SyncState };

function rowToWeighment(row: WeighmentRow): WeighmentWithSync {
  return {
    id: row.id,
    slip_number: row.slip_number,
    status: row.status as Weighment['status'],
    station_id: row.station_id,
    customer_name: row.customer_name,
    customer_company: row.customer_company,
    // The DTO treats an absent optional as `undefined`; SQLite stores NULL.
    customer_phone: row.customer_phone ?? undefined,
    vehicle_type: row.vehicle_type as Weighment['vehicle_type'],
    vehicle_plate: row.vehicle_plate,
    container_number: row.container_number ?? undefined,
    product: row.product,
    first_weight_kg: row.first_weight_kg,
    first_weight_at: row.first_weight_at,
    first_weight_src: row.first_weight_src as Weighment['first_weight_src'],
    second_weight_kg: row.second_weight_kg,
    second_weight_at: row.second_weight_at,
    second_weight_src: row.second_weight_src as Weighment['second_weight_src'],
    net_weight_kg: row.net_weight_kg,
    amount_charged: row.amount_charged,
    currency: row.currency,
    operator_username: row.operator_username,
    created_at: row.created_at,
    updated_at: row.updated_at,
    void_reason: row.void_reason,
    voided_at: row.voided_at,
    sync: {
      synced: row.synced === 1,
      sync_attempts: row.sync_attempts,
      last_attempt_at: row.last_attempt_at,
      blocked_reason: row.sync_blocked_reason,
      blocked_at: row.sync_blocked_at,
    },
  };
}

/** Strip the local-only sync state — this is what goes to the cloud. */
export function toDto(record: WeighmentWithSync): Weighment {
  const { sync: _sync, ...dto } = record;
  return dto;
}

const SELECT_ALL = `
  SELECT id, slip_number, status, station_id, customer_name, customer_company,
         customer_phone, vehicle_type, vehicle_plate, container_number, product,
         first_weight_kg, first_weight_at, first_weight_src,
         second_weight_kg, second_weight_at, second_weight_src, net_weight_kg,
         amount_charged, currency, operator_username, created_at, updated_at,
         void_reason, voided_at, synced, sync_attempts, last_attempt_at,
         sync_blocked_reason, sync_blocked_at
  FROM weighments
`;

export class WeighmentRepository {
  constructor(private readonly db: Db) {}

  insert(weighment: Weighment): void {
    this.db
      .prepare(
        `INSERT INTO weighments (
           id, slip_number, status, station_id,
           customer_name, customer_company, customer_phone,
           vehicle_type, vehicle_plate, container_number, product,
           first_weight_kg, first_weight_at, first_weight_src,
           second_weight_kg, second_weight_at, second_weight_src, net_weight_kg,
           amount_charged, currency, operator_username, created_at, updated_at,
           void_reason, voided_at, synced, sync_attempts, last_attempt_at
         ) VALUES (
           @id, @slip_number, @status, @station_id,
           @customer_name, @customer_company, @customer_phone,
           @vehicle_type, @vehicle_plate, @container_number, @product,
           @first_weight_kg, @first_weight_at, @first_weight_src,
           @second_weight_kg, @second_weight_at, @second_weight_src, @net_weight_kg,
           @amount_charged, @currency, @operator_username, @created_at, @updated_at,
           @void_reason, @voided_at, 0, 0, NULL
         )`,
      )
      .run({
        ...weighment,
        // SQLite rejects `undefined` outright; optionals become NULL.
        customer_phone: weighment.customer_phone ?? null,
        container_number: weighment.container_number ?? null,
        second_weight_kg: weighment.second_weight_kg ?? null,
        second_weight_at: weighment.second_weight_at ?? null,
        second_weight_src: weighment.second_weight_src ?? null,
        void_reason: weighment.void_reason ?? null,
        voided_at: weighment.voided_at ?? null,
      });
  }

  findBySlip(slipNumber: string): WeighmentWithSync | null {
    const row = this.db.prepare(`${SELECT_ALL} WHERE slip_number = ?`).get(slipNumber) as
      WeighmentRow | undefined;
    return row ? rowToWeighment(row) : null;
  }

  findById(id: string): WeighmentWithSync | null {
    const row = this.db.prepare(`${SELECT_ALL} WHERE id = ?`).get(id) as WeighmentRow | undefined;
    return row ? rowToWeighment(row) : null;
  }

  slipExists(slipNumber: string): boolean {
    const row = this.db
      .prepare('SELECT 1 AS hit FROM weighments WHERE slip_number = ?')
      .get(slipNumber);
    return row !== undefined;
  }

  /**
   * Highest counter-format slip in use, for seeding the next one. Station-mode
   * slips (`SI-A4K2P9Z`) are excluded by the GLOB — they carry no counter.
   */
  maxSlipCounter(): number {
    const row = this.db
      .prepare(
        `SELECT MAX(CAST(SUBSTR(slip_number, 4) AS INTEGER)) AS max_counter
         FROM weighments
         WHERE slip_number GLOB 'SI-[0-9]*'`,
      )
      .get() as { max_counter: number | null };
    return row.max_counter ?? 0;
  }

  /** Non-blocking duplicate warning (brief §3B). */
  findOpenByPlate(vehiclePlate: string): WeighmentWithSync[] {
    const rows = this.db
      .prepare(`${SELECT_ALL} WHERE vehicle_plate = ? AND status = 'OPEN' ORDER BY created_at DESC`)
      .all(vehiclePlate) as WeighmentRow[];
    return rows.map(rowToWeighment);
  }

  applySecondWeight(update: {
    id: string;
    second_weight_kg: number;
    second_weight_at: string;
    second_weight_src: string;
    net_weight_kg: number;
    amount_charged: number;
    product: string;
    container_number: string | null;
    updated_at: string;
  }): void {
    this.db
      .prepare(
        `UPDATE weighments
            SET second_weight_kg  = @second_weight_kg,
                second_weight_at  = @second_weight_at,
                second_weight_src = @second_weight_src,
                net_weight_kg     = @net_weight_kg,
                amount_charged    = @amount_charged,
                product           = @product,
                container_number  = @container_number,
                status            = 'COMPLETED',
                updated_at        = @updated_at,
                -- The record changed, so the cloud copy is stale again.
                synced            = 0
          WHERE id = @id`,
      )
      .run(update);
  }

  markVoid(update: {
    id: string;
    void_reason: string;
    voided_at: string;
    updated_at: string;
  }): void {
    this.db
      .prepare(
        `UPDATE weighments
            SET status      = 'VOID',
                void_reason = @void_reason,
                voided_at   = @voided_at,
                updated_at  = @updated_at,
                synced      = 0
          WHERE id = @id`,
      )
      .run(update);
  }

  list(
    options: { status?: WeighmentStatus; limit?: number; offset?: number } = {},
  ): WeighmentWithSync[] {
    const { status, limit = 50, offset = 0 } = options;
    const where = status ? 'WHERE status = ?' : '';
    const params = status ? [status, limit, offset] : [limit, offset];
    const rows = this.db
      .prepare(`${SELECT_ALL} ${where} ORDER BY first_weight_at DESC LIMIT ? OFFSET ?`)
      .all(...params) as WeighmentRow[];
    return rows.map(rowToWeighment);
  }

  // --- Outbox (used by the sync worker in M6) -------------------------------

  /**
   * The outbox. Quarantined records are excluded: they are the ones the cloud
   * has permanently refused, and leaving them here would mean the sweep picks
   * the same doomed record first on every pass and never reaches the rest.
   */
  listUnsynced(limit = 50): WeighmentWithSync[] {
    const rows = this.db
      .prepare(
        `${SELECT_ALL} WHERE synced = 0 AND sync_blocked_reason IS NULL
         ORDER BY updated_at ASC LIMIT ?`,
      )
      .all(limit) as WeighmentRow[];
    return rows.map(rowToWeighment);
  }

  countUnsynced(): number {
    const row = this.db
      .prepare(
        'SELECT COUNT(*) AS n FROM weighments WHERE synced = 0 AND sync_blocked_reason IS NULL',
      )
      .get() as { n: number };
    return row.n;
  }

  countBlocked(): number {
    const row = this.db
      .prepare('SELECT COUNT(*) AS n FROM weighments WHERE sync_blocked_reason IS NOT NULL')
      .get() as { n: number };
    return row.n;
  }

  listBlocked(): WeighmentWithSync[] {
    const rows = this.db
      .prepare(`${SELECT_ALL} WHERE sync_blocked_reason IS NOT NULL ORDER BY updated_at ASC`)
      .all() as WeighmentRow[];
    return rows.map(rowToWeighment);
  }

  /**
   * Takes records out of the retry loop. The reason is stored rather than
   * discarded because it is the only thing that tells whoever looks later WHY
   * a weighment never reached the cloud.
   */
  markBlocked(entries: { id: string; reason: string }[], at: string): void {
    if (entries.length === 0) return;
    const stmt = this.db.prepare(
      `UPDATE weighments SET sync_blocked_reason = ?, sync_blocked_at = ?
       WHERE id = ? AND synced = 0`,
    );
    this.db.transaction((batch: { id: string; reason: string }[]) => {
      for (const entry of batch) stmt.run(entry.reason.slice(0, 500), at, entry.id);
    })(entries);
  }

  /**
   * Puts a quarantined record back in the outbox, for once the conflict behind
   * it has been dealt with. Without this the only way out of quarantine would
   * be hand-editing SQLite on the weighbridge PC.
   */
  unblock(ids: string[]): number {
    if (ids.length === 0) return 0;
    const stmt = this.db.prepare(
      'UPDATE weighments SET sync_blocked_reason = NULL, sync_blocked_at = NULL WHERE id = ?',
    );
    return this.db.transaction((batch: string[]) => {
      let changed = 0;
      for (const id of batch) changed += stmt.run(id).changes;
      return changed;
    })(ids);
  }

  markSynced(ids: string[]): void {
    if (ids.length === 0) return;
    const stmt = this.db.prepare('UPDATE weighments SET synced = 1 WHERE id = ?');
    this.db.transaction((batch: string[]) => {
      for (const id of batch) stmt.run(id);
    })(ids);
  }

  recordSyncAttempt(ids: string[], at: string): void {
    if (ids.length === 0) return;
    const stmt = this.db.prepare(
      'UPDATE weighments SET sync_attempts = sync_attempts + 1, last_attempt_at = ? WHERE id = ?',
    );
    this.db.transaction((batch: string[]) => {
      for (const id of batch) stmt.run(at, id);
    })(ids);
  }
}
