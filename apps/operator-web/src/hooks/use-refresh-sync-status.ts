/**
 * Every save, completion and void changes the pending-sync count, but the
 * status poll only runs every few seconds — long enough for the operator to
 * save a record and see a count that doesn't include it yet. Anything that
 * writes should nudge the count rather than wait for the next tick.
 */

import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

export function useRefreshSyncStatus(): () => void {
  const queryClient = useQueryClient();
  return useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['sync-status'] });
  }, [queryClient]);
}
