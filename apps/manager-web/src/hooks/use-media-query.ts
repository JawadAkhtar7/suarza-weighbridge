/** Reacts to a CSS media query, so layout choices in JS track the CSS ones. */

import { useEffect, useState } from 'react';

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window === 'undefined' ? false : window.matchMedia(query).matches,
  );

  useEffect(() => {
    const list = window.matchMedia(query);
    const onChange = () => setMatches(list.matches);
    onChange();
    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}

/** Tailwind's `md` breakpoint, kept in one place so JS and CSS agree. */
export const MD_BREAKPOINT = '(min-width: 768px)';
