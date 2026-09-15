/**
 * Keyboard shortcuts (brief §9). The operator works fast and often one-handed
 * with the other on the slip pad, so the three actions that repeat all day get
 * function keys — which, unlike letter chords, stay available while a text
 * field has focus.
 */

import { useEffect, useRef } from 'react';

export type HotkeyMap = Record<string, (() => void) | undefined>;

export function useHotkeys(map: HotkeyMap, enabled = true): void {
  // Kept in a ref so re-registering the listener isn't needed every render.
  const mapRef = useRef(map);
  mapRef.current = map;

  useEffect(() => {
    if (!enabled) return;

    const onKeyDown = (event: KeyboardEvent) => {
      const handler = mapRef.current[event.key];
      if (!handler) return;
      // Browsers bind some function keys; the operator's intent wins here.
      event.preventDefault();
      handler();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enabled]);
}
