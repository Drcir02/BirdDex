import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }

// GitHub Pages serves the site under /<repo>/, so the deploy passes BASE_PATH=/<repo>/.
const base = process.env.BASE_PATH ?? '/'
const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export default defineConfig({
  base,
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
    // The developer pages are in the test build only (the end-to-end tests use them): see src/app/devRoutes.ts.
    __DEV_ROUTES__: JSON.stringify(Boolean(process.env.E2E_PORT || process.env.BIRDDEX_DEV_ROUTES)),
  },
  plugins: [
    react(),
    VitePWA({
      // 'prompt': a new version waits until src/app/appUpdate.ts says the app is idle. With 'autoUpdate' the page reloaded
      // by itself, also in the middle of a scan or on the result screen.
      registerType: 'prompt',
      includeAssets: ['icons/*.png', 'worklets/*.js'],
      manifest: {
        name: 'BirdDex',
        short_name: 'BirdDex',
        description: 'Ptačí atlas a sbírka ptáků České republiky a Evropy.',
        lang: 'cs',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#b3202a',
        theme_color: '#b3202a',
        start_url: base,
        scope: base,
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        globIgnores: ['vendor/**', 'models/**'],
        navigateFallback: `${base}index.html`,
        cleanupOutdatedCaches: true,
        // The first visit takes control of the page at once (offline use works without a second visit).
        clientsClaim: true,
        // These rules are regular expressions on purpose. A function would be copied into the service worker as text,
        // where the variable `base` does not exist: the rule would throw on every request and never cache anything
        // (so the model runtimes in vendor/ were not available offline).
        runtimeCaching: [
          {
            // The model list can change between deploys, so ask the network first.
            urlPattern: new RegExp(`${escapeRegExp(base)}models/manifest\\.json(\\?.*)?$`),
            handler: 'NetworkFirst',
            options: { cacheName: 'birddex-model-list', networkTimeoutSeconds: 3 },
          },
          {
            // The model runtimes (WebAssembly, 9 MB each) are cached the first time they are used. The model files in
            // models/ are not: src/ml/runtime/modelStore.ts keeps its own copy, and a second one would only use up the
            // phone's storage.
            urlPattern: new RegExp(`${escapeRegExp(base)}vendor/`),
            handler: 'CacheFirst',
            options: { cacheName: 'birddex-heavy-v1', cacheableResponse: { statuses: [200] } },
          },
          {
            // Reference photos from Wikipedia (src/features/photos). Each is kept the first time it is shown, so a bird that
            // was looked at once also has its picture offline. The pages ask for them with crossOrigin="anonymous", which
            // makes the answers readable instead of opaque (an opaque answer counts for several MB of the storage quota);
            // status 0 stays allowed for any request that is not. The oldest go first when there are more than 800.
            urlPattern: /^https:\/\/upload\.wikimedia\.org\//,
            handler: 'CacheFirst',
            options: {
              cacheName: 'birddex-photos-v1',
              cacheableResponse: { statuses: [0, 200] },
              expiration: { maxEntries: 800, purgeOnQuotaError: true },
            },
          },
        ],
      },
    }),
  ],
})
