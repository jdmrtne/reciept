import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // 'prompt': a new service worker installs and WAITS instead of taking over the instant it's ready.
      // 'autoUpdate' would swap the running app out from under a guest mid-photoshoot. main.tsx (via
      // src/pwa/updateGate.ts) applies the update itself, but only once the kiosk is idle at standby.
      registerType: 'prompt',
      includeAssets: ['favicon.svg', 'favicon.ico', 'favicon-*.png', 'apple-touch-icon.png', 'og-image.png', 'icons/*.png'],
      manifest: {
        name: 'Receipt Photobooth',
        short_name: 'Photobooth',
        description: 'Self-service receipt photobooth',
        display: 'standalone',
        orientation: 'any',
        background_color: '#ffffff',
        theme_color: '#ffffff',
        id: '/',
        scope: '/',
        lang: 'en',
        start_url: '/',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,webp,woff2}'],
        // High-resolution frame artwork (src/assets/frames) is often >2 MB per PNG; the default cap would silently skip it and break offline use.
        maximumFileSizeToCacheInBytes: 12 * 1024 * 1024,
        navigateFallback: '/index.html',
        // /p/<id> is the customer's phone page. The kiosk service worker (scope '/') must never answer it from a precached shell:
        // a stale precache would boot the old kiosk bundle there. Let it go to the network, where the host rewrites it to index.html.
        navigateFallbackDenylist: [/^\/p\//],
        // Every deploy's precache otherwise stays on the tablet forever; this deletes caches from prior versions
        // once the new one takes over, so storage doesn't grow unbounded over months of unattended kiosk updates.
        cleanupOutdatedCaches: true
      }
    })
  ]
});
