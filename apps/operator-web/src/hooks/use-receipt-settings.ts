/** Station settings shared across the app, owned by the agent. */

import { createContext, useContext } from 'react';
import type { ReceiptSettings } from '../lib/receipt-settings.js';

export interface ReceiptSettingsContextValue {
  settings: ReceiptSettings;
  update: (next: ReceiptSettings) => void;
  isSaving: boolean;
  isLoaded: boolean;
}

export const ReceiptSettingsContext = createContext<ReceiptSettingsContextValue | null>(null);

export function useReceiptSettings(): ReceiptSettingsContextValue {
  const value = useContext(ReceiptSettingsContext);
  if (!value) throw new Error('useReceiptSettings must be used inside ReceiptSettingsProvider');
  return value;
}
