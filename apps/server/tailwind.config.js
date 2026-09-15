/**
 * Styles only the public receipt page (brief §8: `/r/:slip`).
 *
 * The manager dashboard builds its own CSS through Vite; this exists purely so
 * the server can inline a stylesheet for the one page it renders itself. It
 * scans the shared Receipt component, so the page a driver scans is styled by
 * the same classes as the operator's on-screen preview.
 */

/** @type {import('tailwindcss').Config} */
export default {
  content: ['../../packages/ui/src/receipt/**/*.{ts,tsx}', './src/receipt/**/*.{ts,tsx}'],
  theme: { extend: {} },
  plugins: [],
};
