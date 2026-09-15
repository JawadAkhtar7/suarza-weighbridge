import { describe, expect, it } from 'vitest';
import { cn } from '../src/lib/utils.js';

describe('cn', () => {
  it('lets a caller override a default', () => {
    expect(cn('p-4', 'p-6')).toBe('p-6');
  });

  it('keeps the custom text-weight size alongside a text colour', () => {
    // Regression: tailwind-merge treated the unknown `text-weight` as a colour
    // and dropped it, rendering the live weight at body size.
    const result = cn('tabular text-weight', 'text-foreground');
    expect(result).toContain('text-weight');
    expect(result).toContain('text-foreground');
  });

  it('still de-duplicates real font-size conflicts', () => {
    expect(cn('text-weight', 'text-sm')).toBe('text-sm');
  });

  it('still de-duplicates text colours', () => {
    expect(cn('text-foreground', 'text-muted-foreground')).toBe('text-muted-foreground');
  });
});
