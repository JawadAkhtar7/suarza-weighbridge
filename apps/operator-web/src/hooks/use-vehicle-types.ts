/**
 * The rate card, as this weighbridge last pulled it from the manager.
 *
 * Read-only here by design: rates are the manager's to set, and an operator who
 * could edit them locally would give the two tiers different answers for the
 * same truck. It is a local copy rather than a live call so that weighing keeps
 * working with the line down.
 *
 * Falls back to the types this product ships with, for a bridge that has never
 * synced — an empty dropdown would stop work altogether, which is worse than
 * offering the defaults.
 */

import { useQuery } from '@tanstack/react-query';
import { VEHICLE_TYPE_DEFS } from '@suarza/shared';
import { agentApi } from '../lib/api.js';

export interface VehicleTypeOption {
  key: string;
  label: string;
  rate_pkr: number;
}

const SHIPPED: VehicleTypeOption[] = VEHICLE_TYPE_DEFS.map((def) => ({
  key: def.key,
  label: def.label,
  rate_pkr: def.defaultPrice,
}));

export function useVehicleTypes() {
  const query = useQuery({
    queryKey: ['vehicle-types'],
    queryFn: agentApi.getVehicleTypes,
    staleTime: 60_000,
  });

  const synced = query.data?.vehicle_types ?? [];
  const types = synced.length > 0 ? synced : SHIPPED;

  return {
    types,
    /** False while the catalogue is still whatever the product shipped with. */
    isSynced: synced.length > 0,
    lastSyncedAt: query.data?.last_synced_at.vehicle_types ?? null,
    rateFor: (key: string) => types.find((type) => type.key === key)?.rate_pkr ?? 0,
    labelFor: (key: string) => types.find((type) => type.key === key)?.label ?? key,
  };
}
