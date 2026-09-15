import { describe, expect, it } from 'vitest';
import {
  VEHICLE_TYPES,
  VEHICLE_TYPE_DEFS,
  defaultPricingTable,
  getVehicleType,
  priceFor,
  vehicleTypeLabel,
} from '../src/constants/vehicle-types.js';
import { formatPKR, parseAmount } from '../src/utils/currency.js';

describe('vehicle types', () => {
  it('defines every type in the brief exactly once', () => {
    expect(VEHICLE_TYPE_DEFS).toHaveLength(VEHICLE_TYPES.length);
    expect(new Set(VEHICLE_TYPE_DEFS.map((d) => d.key)).size).toBe(VEHICLE_TYPES.length);
  });

  it('labels every type', () => {
    for (const key of VEHICLE_TYPES) {
      expect(vehicleTypeLabel(key).length).toBeGreaterThan(0);
      expect(getVehicleType(key).defaultPrice).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('pricing', () => {
  it('seeds the Settings table from the defaults', () => {
    expect(defaultPricingTable().truck).toBe(300);
    expect(defaultPricingTable().other).toBe(0);
  });

  it('prefers a Settings override over the seed price', () => {
    expect(priceFor('truck')).toBe(300);
    expect(priceFor('truck', { truck: 450 })).toBe(450);
  });

  it('falls back to the seed when Settings has no entry for that type', () => {
    expect(priceFor('dumper', { truck: 450 })).toBe(400);
  });
});

describe('currency', () => {
  it('formats PKR as Rs with thousands separators', () => {
    expect(formatPKR(1234)).toBe('Rs 1,234');
    expect(formatPKR(0)).toBe('Rs 0');
    expect(formatPKR(1234567)).toBe('Rs 1,234,567');
  });

  it('parses what an operator might type into the amount field', () => {
    expect(parseAmount('1,250')).toBe(1250);
    expect(parseAmount('Rs 1250')).toBe(1250);
    expect(parseAmount('  1250 ')).toBe(1250);
    expect(parseAmount('abc')).toBe(0);
  });
});
