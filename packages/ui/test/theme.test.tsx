/**
 * Light/dark: the default, what is remembered, and staying in step.
 *
 * Each test loads a fresh copy of the module under test, because the theme is
 * deliberately module-level state — one value per document. React and the
 * testing library are re-imported alongside it so every test runs against one
 * self-consistent React world rather than mixing two copies.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

async function freshTheme() {
  vi.resetModules();
  document.documentElement.className = '';
  document.documentElement.style.colorScheme = '';

  const rtl = await import('@testing-library/react');
  const theme = await import('../src/hooks/use-theme.js');
  const { ThemeToggle } = await import('../src/components/ui/theme-toggle.js');
  return { ...rtl, ...theme, ThemeToggle };
}

const isDark = () => document.documentElement.classList.contains('dark');

afterEach(() => {
  window.localStorage.clear();
});

describe('the default', () => {
  it('is light for a first-time user, whatever the machine prefers', async () => {
    // A shared weighbridge PC set to dark by whoever installed Windows does
    // not get to decide how the app greets the next person.
    vi.stubGlobal('matchMedia', () => ({
      matches: true,
      media: '(prefers-color-scheme: dark)',
      addEventListener: () => {},
      removeEventListener: () => {},
    }));

    const { render, screen, ThemeToggle, cleanup } = await freshTheme();
    render(<ThemeToggle />);

    expect(isDark()).toBe(false);
    expect(screen.getByRole('button')).toHaveAccessibleName('Switch to dark mode');
    cleanup();
    vi.unstubAllGlobals();
  });

  it('is the stored choice when there is one', async () => {
    window.localStorage.setItem('suarza.theme', 'dark');

    const { render, screen, ThemeToggle, cleanup } = await freshTheme();
    render(<ThemeToggle />);

    expect(isDark()).toBe(true);
    expect(document.documentElement.style.colorScheme).toBe('dark');
    // The label says what pressing it does, not what the screen is.
    expect(screen.getByRole('button')).toHaveAccessibleName('Switch to light mode');
    cleanup();
  });

  it('ignores a stored value that is not a theme', async () => {
    window.localStorage.setItem('suarza.theme', 'midnight');

    const { render, ThemeToggle, cleanup } = await freshTheme();
    render(<ThemeToggle />);

    expect(isDark()).toBe(false);
    cleanup();
  });
});

describe('toggling', () => {
  it('flips the class, the colour scheme and what is remembered', async () => {
    const { render, screen, fireEvent, ThemeToggle, cleanup } = await freshTheme();
    render(<ThemeToggle />);

    fireEvent.click(screen.getByRole('button'));
    expect(isDark()).toBe(true);
    expect(document.documentElement.style.colorScheme).toBe('dark');
    expect(window.localStorage.getItem('suarza.theme')).toBe('dark');

    fireEvent.click(screen.getByRole('button'));
    expect(isDark()).toBe(false);
    expect(window.localStorage.getItem('suarza.theme')).toBe('light');
    cleanup();
  });

  it('still works when the browser refuses storage', async () => {
    // A locked-down browser throws on write. A theme is not worth a blank page.
    const setItem = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new Error('denied');
      });

    const { render, screen, fireEvent, ThemeToggle, cleanup } = await freshTheme();
    render(<ThemeToggle />);

    expect(() => fireEvent.click(screen.getByRole('button'))).not.toThrow();
    expect(isDark()).toBe(true);

    setItem.mockRestore();
    cleanup();
  });
});

describe('one theme per document', () => {
  it('keeps every consumer in step', async () => {
    // The manager dashboard reads the theme twice over: the toggle in the
    // header, and the chart colours, which Recharts writes into SVG
    // attributes. Per-component state would leave the charts light after the
    // header went dark.
    const { render, screen, fireEvent, useTheme, ThemeToggle, cleanup } = await freshTheme();

    function Reader() {
      const { theme } = useTheme();
      return <span data-testid="reader">{theme}</span>;
    }

    render(
      <>
        <ThemeToggle />
        <Reader />
      </>,
    );

    expect(screen.getByTestId('reader')).toHaveTextContent('light');
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByTestId('reader')).toHaveTextContent('dark');
    cleanup();
  });

  it('follows a change made in another tab', async () => {
    const { render, screen, fireEvent, ThemeToggle, cleanup } = await freshTheme();
    render(<ThemeToggle />);

    window.localStorage.setItem('suarza.theme', 'dark');
    fireEvent(
      window,
      new StorageEvent('storage', { key: 'suarza.theme', newValue: 'dark' }),
    );

    expect(isDark()).toBe(true);
    expect(screen.getByRole('button')).toHaveAccessibleName('Switch to light mode');
    cleanup();
  });
});

describe('the boot script', () => {
  it('paints dark before React mounts, and only for a stored dark', async () => {
    const { THEME_BOOT_SCRIPT } = await freshTheme();

    window.localStorage.setItem('suarza.theme', 'dark');
    new Function(THEME_BOOT_SCRIPT)();
    expect(isDark()).toBe(true);

    document.documentElement.className = '';
    window.localStorage.setItem('suarza.theme', 'light');
    new Function(THEME_BOOT_SCRIPT)();
    expect(isDark()).toBe(false);

    document.documentElement.className = '';
    window.localStorage.removeItem('suarza.theme');
    new Function(THEME_BOOT_SCRIPT)();
    expect(isDark()).toBe(false);
  });
});
