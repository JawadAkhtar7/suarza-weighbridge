/**
 * A number that counts up to its value when it changes.
 *
 * Only for the figures a manager is meant to look at — a pocket, a total.
 * Motion is a way of saying "read this", and a page where everything moves
 * says nothing. Eased out, so it slows into the real figure rather than
 * stopping dead on it.
 *
 * Respects `prefers-reduced-motion`: that setting is often set by somebody
 * for whom movement is genuinely unpleasant, and a figure that simply
 * appears is not a lesser version of this.
 */

import { useEffect, useRef, useState } from 'react';

const DURATION_MS = 700;

export function useCountUp(value: number): number {
  const [shown, setShown] = useState(value);
  const from = useRef(value);

  useEffect(() => {
    const reduced =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    if (reduced || !Number.isFinite(value)) {
      from.current = value;
      setShown(value);
      return;
    }

    const start = performance.now();
    const origin = from.current;
    let frame = 0;

    const step = (now: number) => {
      const progress = Math.min(1, (now - start) / DURATION_MS);
      // Ease-out cubic: fast at first, settling into the real figure.
      const eased = 1 - Math.pow(1 - progress, 3);
      setShown(origin + (value - origin) * eased);
      if (progress < 1) frame = requestAnimationFrame(step);
      else from.current = value;
    };

    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [value]);

  return shown;
}
