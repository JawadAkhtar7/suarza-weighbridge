import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * tailwind-merge has to be told about the custom scales in our preset.
 *
 * Without this it classifies an unknown `text-*` utility as a text COLOUR, so
 * `cn('text-weight', 'text-foreground')` silently drops the font size and the
 * live-weight readout renders at body size. Every custom key added to
 * `tailwind-preset.js` needs a matching entry here.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [{ text: ['weight'] }],
    },
  },
});

/** Merge Tailwind classes so a caller's override always wins over a default. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
