import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * Agent routes, proxied in dev so the app can always use relative URLs.
 *
 * MUST match `API_PREFIXES` in apps/agent/src/static.ts. A route missing here
 * does not fail loudly — Vite's SPA fallback answers it with index.html and a
 * 200, and the app then tries to parse HTML as JSON and quietly shows nothing.
 */
const AGENT_ROUTES = [
  '/live-weight',
  '/sync-status',
  '/health',
  '/weighments',
  '/simulator',
  '/settings',
  '/customers',
];

const AGENT_ORIGIN = process.env['AGENT_ORIGIN'] ?? 'http://127.0.0.1:3100';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'icon-192.png', 'icon-512.png'],
      manifest: {
        name: 'Suarza Weighbridge — Operator',
        short_name: 'Weighbridge',
        description: 'Weigh trucks, capture weights and print receipts at the weighbridge.',
        theme_color: '#0a4d6e',
        background_color: '#ffffff',
        display: 'standalone',
        orientation: 'any',
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
        // The app shell is precached so the operator can work through a
        // reboot or a service restart with no network at all.
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // Agent calls must NEVER be served from cache: a cached live weight or
        // a cached weighment is worse than an error, because the operator
        // cannot tell it is stale. Everything here is same-origin with the
        // agent in production, so the paths are matched directly.
        runtimeCaching: AGENT_ROUTES.map((route) => ({
          urlPattern: new RegExp(`^${route}`),
          handler: 'NetworkOnly' as const,
        })),
        navigateFallbackDenylist: AGENT_ROUTES.map((route) => new RegExp(`^${route}`)),
      },
      devOptions: {
        // Keeping the SW off in dev avoids stale bundles during development;
        // `pnpm build && pnpm preview` is how the PWA behaviour gets checked.
        enabled: false,
      },
    }),
  ],
  optimizeDeps: {
    // Workspace packages ship TypeScript source; pre-bundling them would hide
    // edits made in packages/ui behind a stale optimised chunk.
    exclude: ['@suarza/ui', '@suarza/shared'],
  },
  server: {
    port: 5173,
    // Vite refuses requests whose Host header it does not recognise, which is
    // every tunnelled hostname. Opened up so the dev server can be reached
    // through a tunnel while a remote client tests it.
    allowedHosts: true,
    proxy: Object.fromEntries(
      AGENT_ROUTES.map((route) => [route, { target: AGENT_ORIGIN, changeOrigin: true }]),
    ),
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
