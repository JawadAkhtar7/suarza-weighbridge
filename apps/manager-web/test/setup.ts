import '@testing-library/jest-dom/vitest';
import { beforeEach, vi } from 'vitest';

Object.defineProperty(window, 'print', { value: vi.fn(), writable: true });

// Recharts measures its container; jsdom reports zero and the chart renders
// nothing, so a fixed size is stubbed in.
Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, value: 800 });
Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, value: 400 });
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

beforeEach(() => {
  window.localStorage.clear();
  setViewport(true);
});

// jsdom has no matchMedia. Defaults to the desktop breakpoint so the table
// tests exercise the table; the phone list has its own tests that flip it.
export function setViewport(isWide: boolean): void {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: isWide,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

setViewport(true);
