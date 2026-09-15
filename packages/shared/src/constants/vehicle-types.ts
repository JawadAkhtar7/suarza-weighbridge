/**
 * Vehicle types and their default pricing (brief §6).
 *
 * Prices are PLACEHOLDERS in PKR pending the client's confirmed rate card.
 * They are only the *default* seed for the Settings pricing table — at runtime
 * the operator/admin edits them, and the amount field on the weighing form is
 * always freely editable regardless of what the table says.
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

export type VehicleType = (typeof VEHICLE_TYPES)[number];

export interface VehicleTypeDef {
  key: VehicleType;
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

const BY_KEY = new Map<VehicleType, VehicleTypeDef>(VEHICLE_TYPE_DEFS.map((d) => [d.key, d]));

export function getVehicleType(key: VehicleType): VehicleTypeDef {
  const def = BY_KEY.get(key);
  if (!def) throw new Error(`Unknown vehicle type: ${key}`);
  return def;
}

export function vehicleTypeLabel(key: VehicleType): string {
  return BY_KEY.get(key)?.label ?? key;
}

/** Pricing table shape used by Settings; seeded from the defaults above. */
export type PricingTable = Record<VehicleType, number>;

export function defaultPricingTable(): PricingTable {
  return Object.fromEntries(VEHICLE_TYPE_DEFS.map((d) => [d.key, d.defaultPrice])) as PricingTable;
}

/** Price lookup that falls back to the seed table when Settings has no entry. */
export function priceFor(key: VehicleType, table?: Partial<PricingTable>): number {
  const override = table?.[key];
  return typeof override === 'number' ? override : getVehicleType(key).defaultPrice;
}
