/**
 * Weighment business rules (brief §3, §7).
 *
 * Everything that changes a record goes through here, and every change is
 * committed to SQLite inside one transaction together with its audit entry —
 * a record and the trail explaining it can never disagree, even if the power
 * cuts mid-save.
 */

import type {
  AuditEntry,
  CompleteWeighmentInput,
  CreateWeighmentInput,
  ReprintWeighmentInput,
  VoidWeighmentInput,
  Weighment,
} from '@suarza/shared';
import {
  DEFAULT_CURRENCY,
  generateSlipNumber,
  netWeightKg,
  newId,
  normalizeSlipNumber,
  nowUtc,
} from '@suarza/shared';
import type { Db } from '../db/connection.js';
import { WeighmentRepository, type WeighmentWithSync } from '../db/weighments.js';
import { AuditRepository } from '../db/audit.js';
import { CustomerRepository } from '../db/customers.js';
import { MetaStore, META_KEYS } from '../db/meta.js';
import { AppError } from '../errors.js';

/** Advisory, never blocking (brief §3B). The operator decides. */
export interface Warning {
  code: 'DUPLICATE_OPEN_PLATE';
  message: string;
  details?: Record<string, unknown>;
}

export interface CreateResult {
  weighment: Weighment;
  warnings: Warning[];
}

export interface WeighmentServiceOptions {
  stationId: string;
  /**
   * Called after any change is committed, so the sync worker can push it
   * immediately (brief §11a). Fired AFTER the transaction, never inside it —
   * a slow or throwing listener must not hold a database write open.
   */
  onChange?: () => void;
}

export class WeighmentService {
  private readonly weighments: WeighmentRepository;
  private readonly audit: AuditRepository;
  private readonly customers: CustomerRepository;
  private readonly meta: MetaStore;

  constructor(
    private readonly db: Db,
    private readonly options: WeighmentServiceOptions,
  ) {
    this.weighments = new WeighmentRepository(db);
    this.audit = new AuditRepository(db);
    this.customers = new CustomerRepository(db);
    this.meta = new MetaStore(db);
  }

  // --- Pass 1 ---------------------------------------------------------------

  createFirstWeight(input: CreateWeighmentInput): CreateResult {
    // Read before the write transaction: this is advice for the operator, not
    // a precondition, so it must not widen the lock or block the save.
    const openForPlate = this.weighments.findOpenByPlate(input.vehicle_plate);
    const warnings: Warning[] = openForPlate.length
      ? [
          {
            code: 'DUPLICATE_OPEN_PLATE',
            message: `${input.vehicle_plate} already has an open ticket (${openForPlate
              .map((w) => w.slip_number)
              .join(', ')}).`,
            details: { slip_numbers: openForPlate.map((w) => w.slip_number) },
          },
        ]
      : [];

    const at = nowUtc();

    const weighment = this.db.transaction((): Weighment => {
      const slipNumber = this.nextSlipNumber();

      const record: Weighment = {
        id: newId(),
        slip_number: slipNumber,
        status: 'OPEN',
        station_id: this.options.stationId,

        customer_name: input.customer_name,
        customer_company: input.customer_company,
        customer_phone: input.customer_phone,
        vehicle_type: input.vehicle_type,
        vehicle_plate: input.vehicle_plate,
        container_number: input.container_number,
        product: input.product,

        first_weight_kg: input.first_weight_kg,
        first_weight_at: at,
        first_weight_src: input.first_weight_src,
        second_weight_kg: null,
        second_weight_at: null,
        second_weight_src: null,
        net_weight_kg: 0,

        amount_charged: input.amount_charged,
        currency: DEFAULT_CURRENCY,

        operator_username: input.operator_username,
        created_at: at,
        updated_at: at,
        void_reason: null,
        voided_at: null,
      };

      this.weighments.insert(record);

      // Inside the transaction: the directory is a view of the weighments, so
      // it must not be able to record a customer whose weighing rolled back.
      this.customers.remember({
        name: record.customer_name,
        company: record.customer_company,
        phone: record.customer_phone,
        vehicle_type: record.vehicle_type,
        vehicle_plate: record.vehicle_plate,
        product: record.product,
      });

      this.audit.append({
        weighment_id: record.id,
        action: 'CREATED',
        actor_username: record.operator_username,
        at,
        detail: {
          slip_number: record.slip_number,
          first_weight_kg: record.first_weight_kg,
          source: record.first_weight_src,
          vehicle_plate: record.vehicle_plate,
        },
      });

      // A hand-typed weight is a fact about the record, so it gets its own
      // entry rather than being buried in the CREATED detail.
      if (record.first_weight_src === 'MANUAL') {
        this.audit.append({
          weighment_id: record.id,
          action: 'MANUAL_WEIGHT',
          actor_username: record.operator_username,
          at,
          detail: { which: 'FIRST', weight_kg: record.first_weight_kg },
        });
      }

      return record;
    })();

    this.notifyChanged();
    return { weighment, warnings };
  }

  // --- Pass 2 ---------------------------------------------------------------

  getBySlip(rawSlip: string): WeighmentWithSync {
    const slipNumber = normalizeSlipNumber(rawSlip);
    const record = this.weighments.findBySlip(slipNumber);
    if (!record) {
      throw new AppError('SLIP_NOT_FOUND', `No weighment found for slip ${slipNumber}.`, {
        slip_number: slipNumber,
      });
    }
    return record;
  }

  complete(rawSlip: string, input: CompleteWeighmentInput): Weighment {
    const existing = this.getBySlip(rawSlip);

    // Re-completion is blocked; the UI turns this code into a reprint offer.
    if (existing.status === 'COMPLETED') {
      throw new AppError(
        'ALREADY_COMPLETED',
        `Slip ${existing.slip_number} is already completed. You can reprint it instead.`,
        { slip_number: existing.slip_number, completed_at: existing.updated_at },
      );
    }
    if (existing.status === 'VOID') {
      throw new AppError(
        'ALREADY_VOID',
        `Slip ${existing.slip_number} was voided and cannot be completed.`,
        { slip_number: existing.slip_number, void_reason: existing.void_reason },
      );
    }

    const at = nowUtc();
    const net = netWeightKg(existing.first_weight_kg, input.second_weight_kg);

    const result = this.db.transaction((): Weighment => {
      this.weighments.applySecondWeight({
        id: existing.id,
        second_weight_kg: input.second_weight_kg,
        second_weight_at: at,
        second_weight_src: input.second_weight_src,
        net_weight_kg: net,
        amount_charged: input.amount_charged,
        // Only these two may be corrected at pass 2; identity fields are locked.
        product: input.product ?? existing.product,
        container_number: input.container_number ?? existing.container_number ?? null,
        updated_at: at,
      });

      this.audit.append({
        weighment_id: existing.id,
        action: 'SECOND_WEIGHT',
        actor_username: input.operator_username,
        at,
        detail: {
          second_weight_kg: input.second_weight_kg,
          source: input.second_weight_src,
          first_weight_kg: existing.first_weight_kg,
          net_weight_kg: net,
        },
      });

      if (input.second_weight_src === 'MANUAL') {
        this.audit.append({
          weighment_id: existing.id,
          action: 'MANUAL_WEIGHT',
          actor_username: input.operator_username,
          at,
          detail: { which: 'SECOND', weight_kg: input.second_weight_kg },
        });
      }

      this.audit.append({
        weighment_id: existing.id,
        action: 'COMPLETED',
        actor_username: input.operator_username,
        at,
        detail: {
          net_weight_kg: net,
          amount_charged: input.amount_charged,
          // The amount is editable, so record when it left the auto-filled value.
          amount_changed_from: existing.amount_charged,
        },
      });

      const updated = this.weighments.findById(existing.id);
      if (!updated) throw new AppError('INTERNAL_ERROR', 'Weighment vanished during completion.');
      const { sync: _sync, ...dto } = updated;
      return dto;
    })();

    this.notifyChanged();
    return result;
  }

  // --- Void & reprint -------------------------------------------------------

  void(rawSlip: string, input: VoidWeighmentInput): Weighment {
    const existing = this.getBySlip(rawSlip);

    if (existing.status === 'COMPLETED') {
      throw new AppError(
        'CANNOT_VOID_COMPLETED',
        `Slip ${existing.slip_number} is completed and cannot be voided.`,
        { slip_number: existing.slip_number },
      );
    }
    if (existing.status === 'VOID') {
      throw new AppError('ALREADY_VOID', `Slip ${existing.slip_number} is already voided.`, {
        slip_number: existing.slip_number,
      });
    }

    const at = nowUtc();

    const result = this.db.transaction((): Weighment => {
      this.weighments.markVoid({
        id: existing.id,
        void_reason: input.reason,
        voided_at: at,
        updated_at: at,
      });

      this.audit.append({
        weighment_id: existing.id,
        action: 'VOIDED',
        actor_username: input.operator_username,
        at,
        detail: { reason: input.reason, first_weight_kg: existing.first_weight_kg },
      });

      const updated = this.weighments.findById(existing.id);
      if (!updated) throw new AppError('INTERNAL_ERROR', 'Weighment vanished during void.');
      const { sync: _sync, ...dto } = updated;
      return dto;
    })();

    this.notifyChanged();
    return result;
  }

  /** Reprints are allowed in any status, and always logged (brief §7.7). */
  recordReprint(
    rawSlip: string,
    input: ReprintWeighmentInput,
  ): { weighment: Weighment; entry: AuditEntry } {
    const existing = this.getBySlip(rawSlip);
    const entry = this.audit.append({
      weighment_id: existing.id,
      action: 'REPRINTED',
      actor_username: input.operator_username,
      detail: { receipt: input.receipt, status: existing.status },
    });
    const { sync: _sync, ...dto } = existing;
    // A reprint only writes an audit entry, but that entry still has to reach
    // the cloud, so it triggers a sync like any other change.
    this.notifyChanged();
    return { weighment: dto, entry };
  }

  // --- Queries --------------------------------------------------------------

  list(options: Parameters<WeighmentRepository['list']>[0] = {}): WeighmentWithSync[] {
    return this.weighments.list(options);
  }

  searchCustomers(query: string, limit?: number) {
    return this.customers.search(query, limit);
  }

  auditTrail(weighmentId: string): AuditEntry[] {
    return this.audit.listForWeighment(weighmentId);
  }

  pendingSyncCount(): number {
    return this.weighments.countUnsynced();
  }

  /** Records the cloud permanently refused — quarantined, not retried. */
  blockedSyncCount(): number {
    return this.weighments.countBlocked();
  }

  listBlockedSync(): WeighmentWithSync[] {
    return this.weighments.listBlocked();
  }

  /**
   * Returns a quarantined record to the outbox once the conflict behind it has
   * been cleared — typically the duplicate in the cloud having been removed.
   */
  retrySync(rawSlip: string): WeighmentWithSync {
    const record = this.getBySlip(rawSlip);
    this.weighments.unblock([record.id]);
    // Same trigger a save uses, so the record goes back up immediately rather
    // than waiting for the periodic sweep.
    this.notifyChanged();
    return this.weighments.findById(record.id)!;
  }

  private notifyChanged(): void {
    try {
      this.options.onChange?.();
    } catch {
      // Sync is best-effort and always retried. A listener that throws must
      // never turn a successfully saved weighment into a failed request.
    }
  }

  // --- Slip numbers ---------------------------------------------------------

  /**
   * Must run inside the insert transaction: the counter is read, the candidate
   * checked against the table, and the row written without another save being
   * able to slip in between and take the same number.
   */
  private nextSlipNumber(): string {
    const fromMeta = this.meta.getNumber(META_KEYS.slipCounter, 0);
    const fromRows = this.weighments.maxSlipCounter();
    // The meta counter can be behind if a previous run died mid-transaction;
    // the table is authoritative, so take whichever is further along.
    const lastCounter = Math.max(fromMeta, fromRows);

    const { slipNumber, counter } = generateSlipNumber({
      mode: 'counter',
      lastCounter,
      stationId: this.options.stationId,
      isTaken: (slip) => this.weighments.slipExists(slip),
    });

    this.meta.set(META_KEYS.slipCounter, String(counter));
    return slipNumber;
  }
}
