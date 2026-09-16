/**
 * Light and dark, remembered per machine.
 *
 * The weighbridge cabin is bright at noon and dark at night, and the operator
 * screen is looked at for a whole shift — so this is a comfort setting, not a
 * decoration. It lives in the shared kit because the manager dashboard will
 * want exactly the same behaviour.
 *
 * Light is the default. A first-time user gets the screen the product was
 * designed and reviewed in, whatever the machine's OS happens to be set to;
 * dark is then one press away and remembered from then on. The OS setting is
 * deliberately NOT followed — a shared weighbridge PC set to dark by whoever
 * installed Windows should not decide how the app greets the next operator.
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

export interface UseThemeResult {
  theme: ResolvedTheme;
  setTheme: (next: ResolvedTheme) => void;
  toggle: () => void;
}

export function useTheme(): UseThemeResult {
  const [theme, setThemeState] = React.useState<ResolvedTheme>(readStored);

  // Layout effect, not effect: the class must land before the browser paints,
  // or every reload shows a flash of the other theme.
  React.useLayoutEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const setTheme = React.useCallback((next: ResolvedTheme) => {
    setThemeState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // The theme still applies; it is just forgotten on reload.
    }
  }, []);

  const toggle = React.useCallback(() => {
    setTheme(theme === 'dark' ? 'light' : 'dark');
  }, [theme, setTheme]);

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
