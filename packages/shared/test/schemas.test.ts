import { describe, expect, it } from 'vitest';
import {
  completeWeighmentSchema,
  createWeighmentSchema,
  voidWeighmentSchema,
  weighmentSchema,
} from '../src/schemas/weighment.js';
import { ingestRequestSchema } from '../src/schemas/api.js';
import { newId } from '../src/utils/id.js';

const baseWeighment = () => ({
  id: newId(),
  slip_number: 'SI-000001',
  status: 'OPEN' as const,
  station_id: 'A',
  customer_name: 'Ali Raza',
  customer_company: 'Raza Traders',
  vehicle_type: 'truck' as const,
  vehicle_plate: 'LES-1234',
  product: 'Cement',
  first_weight_kg: 8000,
  first_weight_at: '2026-09-14T09:00:00.000Z',
  first_weight_src: 'SERIAL' as const,
  operator_username: 'operator',
  created_at: '2026-09-14T09:00:00.000Z',
  updated_at: '2026-09-14T09:00:00.000Z',
  amount_charged: 300,
});

describe('weighmentSchema', () => {
  it('accepts an OPEN ticket with no second weight', () => {
    const parsed = weighmentSchema.parse(baseWeighment());
    expect(parsed.second_weight_kg).toBeNull();
    expect(parsed.net_weight_kg).toBe(0);
    expect(parsed.currency).toBe('PKR');
  });

  it('rejects a negative weight', () => {
    const result = weighmentSchema.safeParse({ ...baseWeighment(), first_weight_kg: -5 });
    expect(result.success).toBe(false);
  });

  it('rejects a malformed slip number', () => {
    const result = weighmentSchema.safeParse({ ...baseWeighment(), slip_number: '000001' });
    expect(result.success).toBe(false);
  });
});

describe('createWeighmentSchema', () => {
  it('treats blank optional fields as absent', () => {
    const parsed = createWeighmentSchema.parse({
      customer_name: 'Ali Raza',
      customer_company: 'Raza Traders',
      customer_phone: '',
      container_number: '',
      vehicle_type: 'truck',
      vehicle_plate: 'LES-1234',
      product: 'Cement',
      first_weight_kg: 8000,
    });
    expect(parsed.customer_phone).toBeUndefined();
    expect(parsed.container_number).toBeUndefined();
    expect(parsed.first_weight_src).toBe('SERIAL');
  });

  it('requires the identity fields the receipt depends on', () => {
    expect(createWeighmentSchema.safeParse({ first_weight_kg: 100 }).success).toBe(false);
  });

  it('saves a customer who has no company', () => {
    // Individuals turn up without one, and refusing the weighing over it only
    // gets a placeholder typed into the field.
    const parsed = createWeighmentSchema.parse({
      customer_name: 'Ali Raza',
      vehicle_type: 'truck',
      vehicle_plate: 'LES-1234',
      product: 'Cement',
      first_weight_kg: 8000,
    });
    // Empty string, not undefined: every tier below keeps a plain `string`.
    expect(parsed.customer_company).toBe('');
  });

  it('accepts a blank company typed as spaces', () => {
    const parsed = createWeighmentSchema.parse({
      customer_name: 'Ali Raza',
      customer_company: '   ',
      vehicle_type: 'truck',
      vehicle_plate: 'LES-1234',
      product: 'Cement',
      first_weight_kg: 8000,
    });
    expect(parsed.customer_company).toBe('');
  });

  it('still demands a customer name — a receipt with no one on it is useless', () => {
    const withoutName = {
      customer_company: 'Raza Traders',
      vehicle_type: 'truck',
      vehicle_plate: 'LES-1234',
      product: 'Cement',
      first_weight_kg: 8000,
    };
    expect(createWeighmentSchema.safeParse(withoutName).success).toBe(false);
  });
});

describe('completeWeighmentSchema', () => {
  it('accepts a second weight and amount', () => {
    const parsed = completeWeighmentSchema.parse({
      second_weight_kg: 20000,
      amount_charged: 300,
    });
    expect(parsed.second_weight_src).toBe('SERIAL');
  });
});

describe('voidWeighmentSchema', () => {
  it('demands a real reason', () => {
    expect(voidWeighmentSchema.safeParse({ reason: '' }).success).toBe(false);
    expect(voidWeighmentSchema.safeParse({ reason: 'Truck never returned' }).success).toBe(true);
  });
});

describe('ingestRequestSchema', () => {
  it('carries weighments and their audit trail together', () => {
    const parsed = ingestRequestSchema.parse({
      station_id: 'A',
      weighments: [baseWeighment()],
    });
    expect(parsed.audit_entries).toEqual([]);
    expect(parsed.weighments).toHaveLength(1);
  });
});
