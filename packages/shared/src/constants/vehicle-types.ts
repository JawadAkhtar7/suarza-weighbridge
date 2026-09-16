/**
 * The vehicle types a weighbridge starts with, and their seed prices.
 *
 * These are no longer the whole story. The manager now keeps the real
 * catalogue — adding types, renaming them and setting rates — and the
 * weighbridge pulls it down. This list is what a brand-new cloud database is
 * seeded with, and the fallback a weighbridge uses before its first sync.
 *
 * `vehicle_type` on a record is therefore a plain key, not one of a fixed set:
 * a type the client invents next year has to be storable without a code change.
 * The keys below stay in the list so historical records keep their labels.
 */

export const VEHICLE_TYPES = [
  'truck',
  'container',
  'trailer',
  'dumper',
  'tractor_trolley',
  'mazda',
  'pickup',
  'loader_rickshaw',
  'gadha_gari',
  'motorcycle_loader',
  'other',
] as const;

/**
 * A vehicle type key as stored on a record.
 *
 * Deliberately `string`, not a union of the seeds: the catalogue is data now.
 * The seeded keys are still listed above because they are what most records
 * carry and what a fresh install offers.
 */
export type VehicleType = string;

/** The keys this product ships with, for seeding and for tests. */
export type SeedVehicleType = (typeof VEHICLE_TYPES)[number];

export interface VehicleTypeDef {
  key: SeedVehicleType;
  label: string;
  /** Default charge in PKR. `[PLACEHOLDER]` — confirm with client. */
  defaultPrice: number;
}

export const VEHICLE_TYPE_DEFS: readonly VehicleTypeDef[] = [
  { key: 'truck', label: 'Truck', defaultPrice: 300 },
  { key: 'container', label: 'Container', defaultPrice: 500 },
  { key: 'trailer', label: 'Trailer', defaultPrice: 600 },
  { key: 'dumper', label: 'Dumper', defaultPrice: 400 },
  { key: 'tractor_trolley', label: 'Tractor Trolley', defaultPrice: 200 },
  { key: 'mazda', label: 'Mazda / Mini Truck (Shehzore)', defaultPrice: 250 },
  { key: 'pickup', label: 'Pickup (Suzuki)', defaultPrice: 150 },
  { key: 'loader_rickshaw', label: 'Loader Rickshaw (Chingchi)', defaultPrice: 100 },
  { key: 'gadha_gari', label: 'Gadha Gari (Donkey Cart)', defaultPrice: 50 },
  { key: 'motorcycle_loader', label: 'Motorcycle Loader', defaultPrice: 50 },
  // `other` is intentionally 0: it means "operator types the amount by hand".
  { key: 'other', label: 'Other', defaultPrice: 0 },
] as const;

const BY_KEY = new Map<string, VehicleTypeDef>(VEHICLE_TYPE_DEFS.map((d) => [d.key, d]));

export function getVehicleType(key: VehicleType): VehicleTypeDef | undefined {
  return BY_KEY.get(key);
}

/**
 * A key turned into a stable one: lower case, words joined by underscores.
 *
 * Applied when the manager names a new type, so `Shehzore 20ft` is stored as
 * `shehzore_20ft` and stays that key even if the label is corrected later.
 */
export function vehicleTypeKey(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
}

/**
 * What to show for a stored key.
 *
 * Three steps, in order of how much they can be trusted: the label the record
 * itself carries (what was printed at the time), then the seeded catalogue,
 * then the key made readable. The last is what keeps a type invented by the
 * manager legible on a tier that has not synced the catalogue yet.
 */
export function vehicleTypeLabel(key: VehicleType, stored?: string | null): string {
  if (stored && stored.trim()) return stored;
  const seeded = BY_KEY.get(key);
  if (seeded) return seeded.label;
  return key
    .split('_')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/** Rates by vehicle type key. Open-ended, because the catalogue is data. */
export type PricingTable = Record<string, number>;

export function defaultPricingTable(): PricingTable {
  return Object.fromEntries(VEHICLE_TYPE_DEFS.map((d) => [d.key, d.defaultPrice]));
}

/**
 * The rate for a type: what the synced catalogue says, else the seed, else
 * zero — which means "the operator types the amount", the same as `other`.
 */
export function priceFor(key: VehicleType, table?: Partial<PricingTable>): number {
  const override = table?.[key];
  if (typeof override === 'number') return override;
  return BY_KEY.get(key)?.defaultPrice ?? 0;
}
