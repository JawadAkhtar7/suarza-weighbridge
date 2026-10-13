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
import type { FramingUpdate } from '@suarza/shared';
import { agentApi, AgentApiError, type SettingsCredentials } from '../lib/api.js';
import { defaultReceiptSettings, type ReceiptSettings } from '../lib/receipt-settings.js';
import { ReceiptSettingsContext } from '../hooks/use-receipt-settings.js';

const SETTINGS_KEY = ['settings'] as const;

export function ReceiptSettingsProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: SETTINGS_KEY,
    queryFn: agentApi.getSettings,
    staleTime: 5 * 60 * 1000,
    /*
     * Read again whenever a window comes back into focus, however recent the
     * copy. The print tab stays open to print again, and an alignment changed
     * in the main window meanwhile must reach the next sheet from that tab —
     * it went to the printer with the offsets the tab had opened with. One
     * request to this PC's own agent; nothing to save by skipping it.
     */
    refetchOnWindowFocus: 'always',
    retry: 1,
  });

  const mutation = useMutation({
    mutationFn: ({
      settings,
      credentials,
    }: {
      settings: ReceiptSettings;
      credentials: SettingsCredentials;
      onSuccess?: () => void;
      onError?: (error: unknown) => void;
    }) => agentApi.saveSettings(settings, credentials),
    onSuccess: (saved, variables) => {
      queryClient.setQueryData(SETTINGS_KEY, saved);
      toast.success('Settings saved');
      variables.onSuccess?.();
    },
    onError: (error, variables) => {
      /*
       * A refused login is the dialog's business, not a toast's: it has to
       * stay open with the password field cleared, holding every edit the
       * operator made on the way to it. Anything else really is a failure.
       */
      if (error instanceof AgentApiError && error.code === 'INVALID_CREDENTIALS') {
        variables.onError?.(error);
        return;
      }
      toast.error('Could not save settings', {
        description: error instanceof Error ? error.message : 'Unexpected error.',
      });
      variables.onError?.(error);
    },
  });

  /* Framing is its own mutation against its own route, and silent on success:
     the operator sees the picture move, which is the whole confirmation. */
  const framing = useMutation({
    mutationFn: (update: FramingUpdate) => agentApi.saveFraming(update),
    onSuccess: (saved) => queryClient.setQueryData(SETTINGS_KEY, saved),
    onError: (error) =>
      toast.error('Could not save the camera framing', {
        description: error instanceof Error ? error.message : 'Unexpected error.',
      }),
  });

  const update = useCallback(
    (
      next: ReceiptSettings,
      credentials: SettingsCredentials,
      options?: { onSuccess?: () => void; onError?: (error: unknown) => void },
    ) => {
      mutation.mutate({
        settings: next,
        credentials,
        onSuccess: options?.onSuccess,
        onError: options?.onError,
      });
    },
    [mutation],
  );

  const updateFraming = useCallback((next: FramingUpdate) => framing.mutate(next), [framing]);

  const value = useMemo(
    () => ({
      settings: query.data ?? defaultReceiptSettings(),
      update,
      updateFraming,
      isSaving: mutation.isPending,
      isLoaded: query.isSuccess,
    }),
    [query.data, query.isSuccess, update, updateFraming, mutation.isPending],
  );

  return (
    <ReceiptSettingsContext.Provider value={value}>{children}</ReceiptSettingsContext.Provider>
  );
}
