/**
 * Light and dark, remembered per machine.
 *
 * The weighbridge cabin is bright at noon and dark at night, and the operator
 * screen is looked at for a whole shift — so this is a comfort setting, not a
 * decoration. It lives in the shared kit because both PWAs want exactly the
 * same behaviour.
 *
 * Light is the default. A first-time user gets the screen the product was
 * designed and reviewed in, whatever the machine's OS happens to be set to;
 * dark is then one press away and remembered from then on. The OS setting is
 * deliberately NOT followed — a shared weighbridge PC set to dark by whoever
 * installed Windows should not decide how the app greets the next operator.
 *
 * The chosen theme is ONE value per document, held in this module rather than
 * in each component's state: the manager dashboard reads it in two places at
 * once — the toggle in the header and the chart colours — and two independent
 * copies would drift apart the moment one of them changed.
 */

import * as React from 'react';

export type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'suarza.theme';

/** Storage throws in a locked-down browser; a theme is not worth a blank page. */
function readStored(): ResolvedTheme {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {
    // Fall through to the default.
  }
  return 'light';
}

/**
 * Puts the class on <html>, and tells the browser which way round things are.
 *
 * `color-scheme` is what makes native scrollbars, form controls and the canvas
 * behind the page follow the theme — without it a dark page keeps a bright
 * white scrollbar down its edge.
 */
export function applyTheme(theme: ResolvedTheme): void {
  const root = document.documentElement;
  root.classList.toggle('dark', theme === 'dark');
  root.style.colorScheme = theme;
}

/* --- The store ----------------------------------------------------------- */

/** Read from storage on first use, then owned here. */
let current: ResolvedTheme | null = null;
const listeners = new Set<() => void>();

function getSnapshot(): ResolvedTheme {
  if (current === null) current = readStored();
  return current;
}

/** No server rendering in either PWA, but the hook contract asks for it. */
function getServerSnapshot(): ResolvedTheme {
  return 'light';
}

/**
 * A second tab of the same app is still the same person at the same desk, so a
 * change in one follows into the other. `storage` only fires in OTHER
 * documents, so this never doubles up with the write that caused it.
 */
function handleStorage(event: StorageEvent): void {
  if (event.key !== null && event.key !== STORAGE_KEY) return;
  const next = readStored();
  if (next === current) return;
  current = next;
  applyTheme(next);
  emit();
}

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(onStoreChange: () => void): () => void {
  if (listeners.size === 0) window.addEventListener('storage', handleStorage);
  listeners.add(onStoreChange);
  return () => {
    listeners.delete(onStoreChange);
    if (listeners.size === 0) window.removeEventListener('storage', handleStorage);
  };
}

/** Exported for anything that needs to set the theme outside a component. */
export function setTheme(next: ResolvedTheme): void {
  if (getSnapshot() === next) return;
  current = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // The theme still applies; it is just forgotten on reload.
  }
  applyTheme(next);
  emit();
}

export interface UseThemeResult {
  theme: ResolvedTheme;
  setTheme: (next: ResolvedTheme) => void;
  toggle: () => void;
}

export function useTheme(): UseThemeResult {
  const theme = React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  // Layout effect, not effect: the class must land before the browser paints,
  // or a document whose <head> script did not run shows a flash of the other
  // theme. Idempotent, so several consumers doing it costs nothing.
  React.useLayoutEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const toggle = React.useCallback(() => {
    setTheme(getSnapshot() === 'dark' ? 'light' : 'dark');
  }, []);

  return { theme, setTheme, toggle };
}

/**
 * The script that runs before React mounts, inlined into index.html.
 *
 * Only a stored 'dark' turns the page dark — anything else, including no
 * choice at all, paints light. Kept here beside the hook so the two can never
 * disagree about the key or the class name.
 */
export const THEME_BOOT_SCRIPT = `(function(){try{if(localStorage.getItem('${STORAGE_KEY}')==='dark'){document.documentElement.classList.add('dark');document.documentElement.style.colorScheme='dark';}}catch(e){}})();`;
