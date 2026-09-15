/** Polls the agent for the live reading (brief §4: polling, never a socket). */

import { useQuery } from '@tanstack/react-query';
import { agentApi } from '../lib/api.js';
import { LIVE_WEIGHT_POLL_MS, SYNC_STATUS_POLL_MS } from '../lib/constants.js';
import { deriveIndicatorState, type IndicatorState } from '../lib/indicator-state.js';

export interface LiveWeightResult {
  weightKg: number;
  state: IndicatorState;
  simulated: boolean;
  indicatorError: string | null;
  agentReachable: boolean;
}

export function useLiveWeight(): LiveWeightResult {
  const query = useQuery({
    queryKey: ['live-weight'],
    queryFn: agentApi.getLiveWeight,
    refetchInterval: LIVE_WEIGHT_POLL_MS,
    // A failed poll is not worth retrying — the next tick is 300ms away, and
    // retries would stack up into a burst the moment the agent comes back.
    retry: false,
    // Every reading is stale the instant it arrives; that is the point.
    staleTime: 0,
    gcTime: 0,
  });

  const reading = query.data ?? null;
  const agentReachable = !query.isError;

  return {
    weightKg: reading?.weight_kg ?? 0,
    state: deriveIndicatorState(reading, agentReachable),
    simulated: reading?.simulated ?? false,
    indicatorError: reading?.error ?? null,
    agentReachable,
  };
}

export function useSyncStatus() {
  const query = useQuery({
    queryKey: ['sync-status'],
    queryFn: agentApi.getSyncStatus,
    refetchInterval: SYNC_STATUS_POLL_MS,
    retry: false,
  });

  return {
    online: query.data?.online ?? false,
    pendingCount: query.data?.pending_count ?? 0,
    blockedCount: query.data?.blocked_count ?? 0,
    lastError: query.data?.last_error ?? null,
    known: query.isSuccess,
  };
}
