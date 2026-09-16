/**
 * The light/dark switch.
 *
 * One button rather than a menu: the operator wants the screen to stop glaring,
 * not to reason about theme settings. Light until someone says otherwise.
 */

import * as React from 'react';
import { Moon, Sun } from 'lucide-react';
import { Button } from './button.js';
import { useTheme } from '../../hooks/use-theme.js';

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, toggle } = useTheme();
  const goingDark = theme === 'light';

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={className}
      onClick={toggle}
      // Says what pressing it does, not what the screen currently is — the
      // icon already shows that, and a label that reads the other way round is
      // the classic way these end up confusing.
      aria-label={goingDark ? 'Switch to dark mode' : 'Switch to light mode'}
      title={goingDark ? 'Dark mode' : 'Light mode'}
    >
      {goingDark ? <Moon className="h-5 w-5" /> : <Sun className="h-5 w-5" />}
    </Button>
  );
}
