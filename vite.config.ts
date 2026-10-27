import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { VitePWA } from 'vite-plugin-pwa'
import { backendName, resolveBackend } from './scripts/backend.ts'
import { unitAnchorsPlugin } from './scripts/unitAnchorsPlugin.ts'

// https://vite.dev/config/
export default defineConfig(({ command, isPreview }) => {
  // `npm run dev` targets the local Supabase stack; builds keep the .env / CI secrets
  // (the live project). Override either with BACKEND=local|live — see scripts/backend.ts.
  // VITE_* already in process.env win over .env files, so setting them here is enough.
  if (!isPreview) {
    const name = backendName(command === 'serve' ? 'local' : 'live')
    if (name === 'local') {
      const backend = resolveBackend(name)
      process.env.VITE_SUPABASE_URL = backend.url
      process.env.VITE_SUPABASE_ANON_KEY = backend.anonKey
      process.env.VITE_VAPID_PUBLIC_KEY = backend.vapidPublicKey
    }
    process.env.VITE_BACKEND = name
  }
  return {
    plugins: [
      svelte(),
      // Saves from the unit anchor editor (/editor): local dev server only, never live.
      process.env.VITE_BACKEND === 'local' && unitAnchorsPlugin(),
      // Installable app + offline shell. Supabase traffic is cross-origin and never cached;
      // the service worker only serves the built assets and the board maps.
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['favicon.svg', 'pwa/apple-touch-icon.png', 'push-sw.js'],
        manifest: {
          name: 'Diplomacy',
          short_name: 'Diplomacy',
          start_url: '/',
          scope: '/',
          display: 'standalone',
          background_color: '#f5f5f0',
          // Deliberately none: on Android, Chrome paints an installed app's navigation bar
          // with the manifest theme_color, which has no dark variant. Without it the bar
          // follows the phone's theme; the status bar still takes the media-aware
          // <meta name="theme-color"> tags in index.html. `undefined` (not omitted) beats
          // the plugin's default green; its "missing theme_color" build warning is moot.
          theme_color: undefined,
          icons: [
            { src: '/pwa/icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: '/pwa/icon-512.png', sizes: '512x512', type: 'image/png' },
            { src: '/pwa/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
          navigateFallback: '/index.html',
          importScripts: ['push-sw.js'],
          runtimeCaching: [
            {
              urlPattern: ({ url, sameOrigin }) => sameOrigin && url.pathname.startsWith('/maps/'),
              handler: 'StaleWhileRevalidate',
              options: { cacheName: 'maps' },
            },
          ],
        },
      }),
    ],
  }
})
