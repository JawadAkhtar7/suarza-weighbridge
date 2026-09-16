import { beforeEach, describe, expect, it } from 'vitest';
import { netWeightKg } from '@suarza/shared';
import { openDatabase, type Db } from '../src/db/connection.js';
import { WeighmentService } from '../src/services/weighment-service.js';
import { AppError } from '../src/errors.js';

let db: Db;
let service: WeighmentService;

const firstWeightInput = (overrides: Record<string, unknown> = {}) => ({
  customer_name: 'Ali Raza',
  customer_company: 'Raza Traders',
  vehicle_type: 'truck' as const,
  vehicle_plate: 'LES-1234',
  product: 'Cement',
  first_weight_kg: 8000,
  first_weight_src: 'SERIAL' as const,
  amount_charged: 300,
  operator_username: 'operator',
  ...overrides,
});

beforeEach(() => {
  db = openDatabase({ path: ':memory:' });
  service = new WeighmentService(db, { stationId: 'A' });
});

describe('createFirstWeight', () => {
  it('stores an OPEN ticket with a slip number and no net weight yet', () => {
    const { weighment } = service.createFirstWeight(firstWeightInput());

    expect(weighment.slip_number).toBe('SI-000001');
    expect(weighment.status).toBe('OPEN');
    expect(weighment.second_weight_kg).toBeNull();
    expect(weighment.net_weight_kg).toBe(0);
    expect(weighment.currency).toBe('PKR');
    expect(weighment.station_id).toBe('A');
  });

  it('persists the record so it survives a fresh read', () => {
    const { weighment } = service.createFirstWeight(firstWeightInput());
    const fetched = service.getBySlip(weighment.slip_number);
    expect(fetched.id).toBe(weighment.id);
    expect(fetched.first_weight_kg).toBe(8000);
  });

  it('issues sequential slip numbers', () => {
    const slips = [1, 2, 3].map(
      () => service.createFirstWeight(firstWeightInput()).weighment.slip_number,
    );
    expect(slips).toEqual(['SI-000001', 'SI-000002', 'SI-000003']);
  });

  it('records a CREATED audit entry', () => {
    const { weighment } = service.createFirstWeight(firstWeightInput());
    const trail = service.auditTrail(weighment.id);
    expect(trail.map((e) => e.action)).toEqual(['CREATED']);
    expect(trail[0]?.detail).toMatchObject({ slip_number: 'SI-000001', first_weight_kg: 8000 });
  });

  it('flags a hand-typed first weight in its own audit entry', () => {
    const { weighment } = service.createFirstWeight(
      firstWeightInput({ first_weight_src: 'MANUAL' }),
    );
    const actions = service.auditTrail(weighment.id).map((e) => e.action);
    expect(actions).toContain('MANUAL_WEIGHT');
  });

  it('warns about a duplicate open plate without blocking the save', () => {
    service.createFirstWeight(firstWeightInput());
    const second = service.createFirstWeight(firstWeightInput());

    expect(second.weighment.status).toBe('OPEN');
    expect(second.warnings).toHaveLength(1);
    expect(second.warnings[0]?.code).toBe('DUPLICATE_OPEN_PLATE');
    expect(second.warnings[0]?.details?.['slip_numbers']).toEqual(['SI-000001']);
  });

  it('does not warn when the earlier ticket for that plate is closed', () => {
    const { weighment } = service.createFirstWeight(firstWeightInput());
    service.complete(weighment.slip_number, {
      second_weight_kg: 20_000,
      second_weight_src: 'SERIAL',
      amount_charged: 300,
      operator_username: 'operator',
    });

    expect(service.createFirstWeight(firstWeightInput()).warnings).toEqual([]);
  });
});

describe('complete', () => {
  it('computes net weight as the absolute difference and marks it COMPLETED', () => {
    const { weighment } = service.createFirstWeight(firstWeightInput());
    const completed = service.complete(weighment.slip_number, {
      second_weight_kg: 20_000,
      second_weight_src: 'SERIAL',
      amount_charged: 350,
      operator_username: 'operator',
    });

    expect(completed.status).toBe('COMPLETED');
    expect(completed.net_weight_kg).toBe(12_000);
    expect(completed.amount_charged).toBe(350);
    expect(completed.second_weight_at).not.toBeNull();
  });

  it('is correct when the truck arrives loaded and leaves empty', () => {
    const { weighment } = service.createFirstWeight(firstWeightInput({ first_weight_kg: 20_000 }));
    const completed = service.complete(weighment.slip_number, {
      second_weight_kg: 8000,
      second_weight_src: 'SERIAL',
      amount_charged: 300,
      operator_username: 'operator',
    });

    expect(completed.net_weight_kg).toBe(12_000);
    expect(completed.net_weight_kg).toBe(netWeightKg(20_000, 8000));
  });

  it('accepts the operator correcting product and container at pass 2', () => {
    const { weighment } = service.createFirstWeight(firstWeightInput());
    const completed = service.complete(weighment.slip_number, {
      second_weight_kg: 20_000,
      second_weight_src: 'SERIAL',
      amount_charged: 300,
      operator_username: 'operator',
      product: 'Sand',
      container_number: 'CONT-99',
    });

    expect(completed.product).toBe('Sand');
    expect(completed.container_number).toBe('CONT-99');
  });

  it('leaves the identity fields locked', () => {
    const { weighment } = service.createFirstWeight(firstWeightInput());
    const completed = service.complete(weighment.slip_number, {
      second_weight_kg: 20_000,
      second_weight_src: 'SERIAL',
      amount_charged: 300,
      operator_username: 'operator',
    });

    expect(completed.customer_name).toBe('Ali Raza');
    expect(completed.vehicle_plate).toBe('LES-1234');
    expect(completed.first_weight_kg).toBe(8000);
  });

  it('logs SECOND_WEIGHT and COMPLETED in order', () => {
    const { weighment } = service.createFirstWeight(firstWeightInput());
    service.complete(weighment.slip_number, {
      second_weight_kg: 20_000,
      second_weight_src: 'SERIAL',
      amount_charged: 300,
      operator_username: 'operator',
    });

    expect(service.auditTrail(weighment.id).map((e) => e.action)).toEqual([
      'CREATED',
      'SECOND_WEIGHT',
      'COMPLETED',
    ]);
  });

  it('refuses to complete twice and says a reprint is the way out', () => {
    const { weighment } = service.createFirstWeight(firstWeightInput());
    const complete = () =>
      service.complete(weighment.slip_number, {
        second_weight_kg: 20_000,
        second_weight_src: 'SERIAL',
        amount_charged: 300,
        operator_username: 'operator',
      });

    complete();
    expect(complete).toThrow(AppError);
    try {
      complete();
    } catch (error) {
      expect((error as AppError).code).toBe('ALREADY_COMPLETED');
      expect((error as AppError).message).toMatch(/reprint/i);
    }
  });

  it('refuses to complete a voided ticket', () => {
    const { weighment } = service.createFirstWeight(firstWeightInput());
    service.void(weighment.slip_number, {
      reason: 'Truck never returned',
      operator_username: 'operator',
    });

    try {
      service.complete(weighment.slip_number, {
        second_weight_kg: 20_000,
        second_weight_src: 'SERIAL',
        amount_charged: 300,
        operator_username: 'operator',
      });
      expect.unreachable('completing a void ticket must throw');
    } catch (error) {
      expect((error as AppError).code).toBe('ALREADY_VOID');
    }
  });
});

describe('getBySlip', () => {
  it('accepts what the operator types off the printed slip', () => {
    const { weighment } = service.createFirstWeight(firstWeightInput());
    expect(service.getBySlip('si-000001').id).toBe(weighment.id);
    expect(service.getBySlip('1').id).toBe(weighment.id);
    expect(service.getBySlip('  SI-000001 ').id).toBe(weighment.id);
  });

  it('reports a missing slip clearly', () => {
    try {
      service.getBySlip('SI-999999');
      expect.unreachable('an unknown slip must throw');
    } catch (error) {
      expect((error as AppError).code).toBe('SLIP_NOT_FOUND');
      expect((error as AppError).statusCode).toBe(404);
    }
  });
});

describe('void', () => {
  it('voids an OPEN ticket with a reason and keeps the row', () => {
    const { weighment } = service.createFirstWeight(firstWeightInput());
    const voided = service.void(weighment.slip_number, {
      reason: 'Truck never returned',
      operator_username: 'operator',
    });

    expect(voided.status).toBe('VOID');
    expect(voided.void_reason).toBe('Truck never returned');
    expect(voided.voided_at).not.toBeNull();
    // Void, never delete (brief §7.6) — the record is still fetchable.
    expect(service.getBySlip(weighment.slip_number).status).toBe('VOID');
  });

  it('refuses to void a completed ticket', () => {
    const { weighment } = service.createFirstWeight(firstWeightInput());
    service.complete(weighment.slip_number, {
      second_weight_kg: 20_000,
      second_weight_src: 'SERIAL',
      amount_charged: 300,
      operator_username: 'operator',
    });

    try {
      service.void(weighment.slip_number, {
        reason: 'Changed my mind',
        operator_username: 'operator',
      });
      expect.unreachable('voiding a completed ticket must throw');
    } catch (error) {
      expect((error as AppError).code).toBe('CANNOT_VOID_COMPLETED');
    }
  });
});

describe('recordReprint', () => {
  it('logs every reprint without changing the record', () => {
    const { weighment } = service.createFirstWeight(firstWeightInput());
    service.recordReprint(weighment.slip_number, {
      operator_username: 'operator',
      receipt: 'FIRST',
    });
    service.recordReprint(weighment.slip_number, {
      operator_username: 'operator',
      receipt: 'FIRST',
    });

    const reprints = service.auditTrail(weighment.id).filter((e) => e.action === 'REPRINTED');
    expect(reprints).toHaveLength(2);
    expect(service.getBySlip(weighment.slip_number).status).toBe('OPEN');
  });
});

describe('the list the operator picks from', () => {
  it('puts tickets still awaiting a second weight first', async () => {
    // The operator's list is paged now, so this ordering has to come from the
    // database: sorting a page in the browser would leave an open ticket
    // stranded on a page nobody loaded, and open tickets are the whole reason
    // that list exists.
    const first = service.createFirstWeight(firstWeightInput({ vehicle_plate: 'LES-0001' })).weighment;
    service.complete(first.slip_number, {
      second_weight_kg: 20_000,
      second_weight_src: 'SERIAL',
      amount_charged: 300,
      payment_status: 'PAID',
      operator_username: 'operator',
    });
    const stillOpen = service.createFirstWeight(firstWeightInput({ vehicle_plate: 'LES-0002' })).weighment;

    const rows = service.list({ limit: 10 });
    expect(rows[0]!.slip_number).toBe(stillOpen.slip_number);
    expect(rows[1]!.slip_number).toBe(first.slip_number);
  });

  it('counts every record, not just the page asked for', async () => {
    // What tells a "Load more" button whether anything is left.
    for (const plate of ['LES-0001', 'LES-0002', 'LES-0003']) {
      service.createFirstWeight(firstWeightInput({ vehicle_plate: plate }));
    }

    expect(service.list({ limit: 2 })).toHaveLength(2);
    expect(service.countWeighments()).toBe(3);
  });

  it('pages without repeating or skipping a record', async () => {
    for (const plate of ['LES-0001', 'LES-0002', 'LES-0003', 'LES-0004']) {
      service.createFirstWeight(firstWeightInput({ vehicle_plate: plate }));
    }

    const page1 = service.list({ limit: 2, offset: 0 }).map((row) => row.slip_number);
    const page2 = service.list({ limit: 2, offset: 2 }).map((row) => row.slip_number);

    expect(new Set([...page1, ...page2]).size).toBe(4);
  });
});

describe('outbox bookkeeping', () => {
  it('marks every new and updated record as pending sync', () => {
    const { weighment } = service.createFirstWeight(firstWeightInput());
    expect(service.pendingSyncCount()).toBe(1);

    service.complete(weighment.slip_number, {
      second_weight_kg: 20_000,
      second_weight_src: 'SERIAL',
      amount_charged: 300,
      operator_username: 'operator',
    });
    // Still one record, still pending — the completion made it stale again.
    expect(service.pendingSyncCount()).toBe(1);
  });
});
