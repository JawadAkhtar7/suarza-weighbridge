import '@testing-library/jest-dom/vitest';
import { beforeEach, vi } from 'vitest';

/**
 * react-to-print renders into an iframe and calls `print()` on THAT window, not
 * on the main one — jsdom implements neither, so without this every receipt
 * that mounts floods the output with "Not implemented: window.print" and buries
 * real failures.
 *
 * The spy is shared so tests can assert that printing actually happened, rather
 * than only that a button exists.
 */
export const printSpy = vi.fn();

Object.defineProperty(window, 'print', { value: printSpy, writable: true });

const contentWindowDescriptor = Object.getOwnPropertyDescriptor(
  window.HTMLIFrameElement.prototype,
  'contentWindow',
);

if (contentWindowDescriptor?.get) {
  const original = contentWindowDescriptor.get;
  Object.defineProperty(window.HTMLIFrameElement.prototype, 'contentWindow', {
    configurable: true,
    get(this: HTMLIFrameElement) {
      const frameWindow = original.call(this) as (Window & { __printStubbed?: boolean }) | null;
      if (frameWindow && !frameWindow.__printStubbed) {
        frameWindow.__printStubbed = true;
        frameWindow.print = printSpy;
        // react-to-print focuses the frame before printing.
        frameWindow.focus = vi.fn();
      }
      return frameWindow;
    },
  });
}

beforeEach(() => {
  printSpy.mockClear();
  // Print settings persist per machine; without this a test that saves
  // settings would leak into the next one.
  window.localStorage.clear();
});
