/** Station settings shared across the app, owned by the agent. */

import { createContext, useContext } from 'react';
import type { FramingUpdate } from '@suarza/shared';
import type { ReceiptSettings } from '../lib/receipt-settings.js';
import type { SettingsCredentials } from '../lib/api.js';

export interface ReceiptSettingsContextValue {
  settings: ReceiptSettings;
  /**
   * Saves to the agent, which refuses without a station login.
   *
   * The credentials are passed in per save and never held: there is no
   * session to expire and nothing to log out of, and a settings dialog left
   * open on the weighing screen cannot be used by whoever walks up next.
   *
   * Callbacks rather than a thrown promise, so the dialog can close on a save
   * that landed and stay open on one that did not — with the wrong password
   * highlighted, and every edit the operator made still in the form.
   */
  update: (
    next: ReceiptSettings,
    credentials: SettingsCredentials,
    options?: { onSuccess?: () => void; onError?: (error: unknown) => void },
  ) => void;
  /**
   * Reframe one camera's picture, which needs no login — the operator does it
   * by dragging the live view while a truck waits. Quiet by design: it is a
   * save the operator makes by doing something rather than by pressing Save.
   */
  updateFraming: (framing: FramingUpdate) => void;
  isSaving: boolean;
  isLoaded: boolean;
}

export const ReceiptSettingsContext = createContext<ReceiptSettingsContextValue | null>(null);

export function useReceiptSettings(): ReceiptSettingsContextValue {
  const value = useContext(ReceiptSettingsContext);
  if (!value) throw new Error('useReceiptSettings must be used inside ReceiptSettingsProvider');
  return value;
}
