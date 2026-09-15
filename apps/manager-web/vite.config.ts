import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * Cloud API routes, proxied in dev so the app always uses relative URLs.
 *
 * MUST match `API_PREFIXES` in apps/server/src/static.ts. A route missing here
 * does not fail loudly — Vite's SPA fallback answers it with index.html and a
 * 200, and the app then tries to parse HTML as JSON and quietly shows nothing.
 */
const API_ROUTES = [
  '/auth',
  '/weighments',
  '/analytics',
  '/suggestions',
  '/health',
  '/r',
  /*
   * Everything added from the ledger onwards lives under `/api`, kept apart
   * from the pages on purpose: `/ledger` is also a route in this app, and
   * proxying that prefix wholesale sent a browser refresh on /ledger to the
   * API, which answered "No route for GET /ledger" instead of serving the app.
   */
  '/api',
];

const SERVER_ORIGIN = process.env['SERVER_ORIGIN'] ?? 'http://127.0.0.1:4000';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'icon-192.png', 'icon-512.png'],
      manifest: {
        name: 'Suarza Weighbridge — Manager',
        short_name: 'Weighbridge',
        description: 'Sales, analytics and receipts from the weighbridge.',
        theme_color: '#0a4d6e',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: '/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // The dashboard reports money. A cached figure the manager cannot tell
        // is stale is worse than a spinner, so API calls are never served from
        // the service worker (brief §4: the source of truth is always the DB).
        runtimeCaching: API_ROUTES.map((route) => ({
          urlPattern: new RegExp(`^${route}`),
          handler: 'NetworkOnly' as const,
        })),
        navigateFallbackDenylist: API_ROUTES.map((route) => new RegExp(`^${route}`)),
      },
      devOptions: { enabled: false },
    }),
  ],
  optimizeDeps: { exclude: ['@suarza/ui', '@suarza/shared'] },
  server: {
    port: 5174,
    // Vite refuses requests whose Host header it does not recognise, which is
    // every tunnelled hostname. Opened up so the dev server can be reached
    // through a tunnel while a remote client tests it.
    allowedHosts: true,
    proxy: Object.fromEntries(
      API_ROUTES.map((route) => [route, { target: SERVER_ORIGIN, changeOrigin: true }]),
    ),
  },
  build: { outDir: 'dist', sourcemap: true },
});
