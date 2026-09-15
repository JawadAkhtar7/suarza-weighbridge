/**
 * The customer directory (operator feedback: a searchable customer picker).
 *
 * The merge rule is the part worth testing hardest: a new weighing must fill
 * in what is missing without erasing what was there.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDatabase, type Db } from '../src/db/connection.js';
import { CustomerRepository } from '../src/db/customers.js';
import { WeighmentService } from '../src/services/weighment-service.js';

let db: Db;
let customers: CustomerRepository;
let service: WeighmentService;

const weigh = (overrides: Record<string, unknown> = {}) =>
  service.createFirstWeight({
    customer_name: 'Ali Raza',
    customer_company: 'Raza Traders',
    vehicle_type: 'truck',
    vehicle_plate: 'LES-1234',
    product: 'Cement',
    first_weight_kg: 8000,
    first_weight_src: 'SERIAL',
    amount_charged: 300,
    operator_username: 'operator',
    ...overrides,
  } as never);

afterEach(() => vi.useRealTimers());

beforeEach(() => {
  db = openDatabase({ path: ':memory:' });
  customers = new CustomerRepository(db);
  service = new WeighmentService(db, { stationId: 'A' });
});

describe('built from weighings', () => {
  it('records a customer the first time they are weighed', () => {
    weigh();
    const found = customers.search('Ali');
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      name: 'Ali Raza',
      company: 'Raza Traders',
      last_vehicle_plate: 'LES-1234',
      last_product: 'Cement',
      weighment_count: 1,
    });
  });

  it('counts repeat visits rather than duplicating the customer', () => {
    weigh();
    weigh();
    weigh();
    expect(customers.count()).toBe(1);
    expect(customers.search('Ali')[0]?.weighment_count).toBe(3);
  });

  it('treats different capitalisation as the same customer', () => {
    // Otherwise the dropdown fills with near-identical entries.
    weigh();
    weigh({ customer_name: 'ali raza', customer_company: 'RAZA TRADERS' });
    expect(customers.count()).toBe(1);
  });

  it('keeps the most recent spelling, so a correction sticks', () => {
    weigh({ customer_name: 'ali raza' });
    weigh({ customer_name: 'Ali Raza' });
    expect(customers.search('')[0]?.name).toBe('Ali Raza');
  });

  it('treats the same name at a different company as a different customer', () => {
    weigh();
    weigh({ customer_company: 'Khan Brothers' });
    expect(customers.count()).toBe(2);
  });
});

describe('merging details', () => {
  it('fills in a detail the directory did not have', () => {
    weigh(); // no phone
    expect(customers.search('Ali')[0]?.phone).toBeNull();

    weigh({ customer_phone: '0300-1234567' });
    expect(customers.search('Ali')[0]?.phone).toBe('0300-1234567');
  });

  it('does NOT erase a detail when the next weighing leaves it blank', () => {
    // The operator who skips the phone box today must not wipe the number
    // someone typed last week.
    weigh({ customer_phone: '0300-1234567' });
    weigh({ customer_phone: '' });
    expect(customers.search('Ali')[0]?.phone).toBe('0300-1234567');
  });

  it('updates the last vehicle and product to the most recent ones', () => {
    weigh();
    weigh({ vehicle_plate: 'LHR-9999', vehicle_type: 'trailer', product: 'Wheat' });

    expect(customers.search('Ali')[0]).toMatchObject({
      last_vehicle_plate: 'LHR-9999',
      last_vehicle_type: 'trailer',
      last_product: 'Wheat',
    });
  });

  it('rolls back with the weighing it belongs to', () => {
    // The directory is a view of the weighments, so a customer must not
    // survive a transaction that failed half way through.
    expect(() =>
      db.transaction(() => {
        customers.remember({ name: 'Ghost Customer', company: 'Nowhere Ltd' });
        throw new Error('weighing failed after the customer was remembered');
      })(),
    ).toThrow();

    expect(customers.count()).toBe(0);
  });

  it('ignores a blank customer name rather than storing an empty entry', () => {
    customers.remember({ name: '   ', company: 'Nowhere Ltd' });
    expect(customers.count()).toBe(0);
  });
});

describe('searching', () => {
  beforeEach(() => {
    weigh({ customer_name: 'Ali Raza', customer_company: 'Raza Traders' });
    weigh({ customer_name: 'Bilal Khan', customer_company: 'Khan Brothers' });
    weigh({ customer_name: 'Muhammad Ali Tariq', customer_company: 'Tariq & Sons' });
  });

  it('finds by customer name', () => {
    expect(customers.search('Bilal').map((c) => c.name)).toEqual(['Bilal Khan']);
  });

  it('finds by company name from the same box', () => {
    expect(customers.search('Khan Brothers').map((c) => c.name)).toEqual(['Bilal Khan']);
  });

  it('is case-insensitive', () => {
    expect(customers.search('bilal')).toHaveLength(1);
  });

  it('puts prefix matches first', () => {
    // Someone typing "Ali" wants Ali Raza before Muhammad Ali Tariq.
    expect(customers.search('Ali')[0]?.name).toBe('Ali Raza');
  });

  it('returns the most recent customers when nothing is typed', () => {
    const recent = customers.search('');
    expect(recent).toHaveLength(3);
    // Deterministic even though all three were created in the same
    // millisecond — the ordering must not reshuffle between refreshes.
    expect(recent.map((c) => c.name)).toEqual(['Muhammad Ali Tariq', 'Bilal Khan', 'Ali Raza']);
  });

  it('brings a customer back to the top when they are weighed again', () => {
    // The clock is advanced because recency is recorded to the millisecond and
    // the whole setup above runs inside one. Real weighings are minutes apart.
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.now() + 60_000));

    weigh({ customer_name: 'Ali Raza', customer_company: 'Raza Traders' });
    expect(customers.search('')[0]?.name).toBe('Ali Raza');
  });

  it('treats a % in a customer name as text, not a wildcard', () => {
    weigh({ customer_name: '100% Traders', customer_company: 'Pure Co' });
    // A literal "%" search must not match everything.
    expect(customers.search('100%').map((c) => c.name)).toEqual(['100% Traders']);
    expect(customers.search('%').map((c) => c.name)).toEqual(['100% Traders']);
  });

  it('respects the limit', () => {
    expect(customers.search('', 2)).toHaveLength(2);
  });
});
