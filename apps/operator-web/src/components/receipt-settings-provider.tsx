/**
 * Loads station settings from the agent and keeps them available app-wide.
 *
 * While they are loading the schema defaults stand in, so the operator can
 * start weighing immediately rather than waiting on a settings fetch — the
 * defaults only affect the receipt's appearance, never the record.
 */

import { useCallback, useMemo, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from '@suarza/ui';
import { agentApi } from '../lib/api.js';
import { defaultReceiptSettings, type ReceiptSettings } from '../lib/receipt-settings.js';
import { ReceiptSettingsContext } from '../hooks/use-receipt-settings.js';

const SETTINGS_KEY = ['settings'] as const;

export function ReceiptSettingsProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: SETTINGS_KEY,
    queryFn: agentApi.getSettings,
    // Settings change rarely; refetching them on every focus is noise.
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  const mutation = useMutation({
    mutationFn: agentApi.saveSettings,
    onSuccess: (saved) => {
      queryClient.setQueryData(SETTINGS_KEY, saved);
      toast.success('Settings saved');
    },
    onError: (error) =>
      toast.error('Could not save settings', {
        description: error instanceof Error ? error.message : 'Unexpected error.',
      }),
  });

  const update = useCallback(
    (next: ReceiptSettings) => {
      mutation.mutate(next);
    },
    [mutation],
  );

  const value = useMemo(
    () => ({
      settings: query.data ?? defaultReceiptSettings(),
      update,
      isSaving: mutation.isPending,
      isLoaded: query.isSuccess,
    }),
    [query.data, query.isSuccess, update, mutation.isPending],
  );

  return (
    <ReceiptSettingsContext.Provider value={value}>{children}</ReceiptSettingsContext.Provider>
  );
}
