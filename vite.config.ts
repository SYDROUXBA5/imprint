import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

/**
 * The built app lives under a sub-path on GitHub Pages (https://<user>.github.io/<repo>/).
 * Defaults to /imprint/; set BASE_PATH at build time if the repo is named differently.
 * The dev server stays at the root so http://localhost:5173/ just works.
 */
const trimmed = (process.env.BASE_PATH ?? 'imprint').replace(/^\/+|\/+$/g, '')
const subPath = trimmed ? `/${trimmed}/` : '/'

// https://vite.dev/config/
export default defineConfig(({ command, mode }) => {
  const base = command === 'serve' && mode === 'development' ? '/' : subPath
  return {
    base,
    plugins: [
      react(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['favicon.ico', 'icon.svg', 'apple-touch-icon-180x180.png'],
        manifest: {
          name: 'Imprint',
          short_name: 'Imprint',
          description: 'Odour imprinting log for K9 units',
          theme_color: '#B8901C',
          background_color: '#F5EFDC',
          display: 'standalone',
          start_url: base,
          scope: base,
          icons: [
            { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
            { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
            { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },
        // webp covers breeds/*.webp (spec §13.3). sw-update.js reloads pages left on an older version.
        workbox: {
          globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2,webp}'],
          globIgnores: ['sw-update.js'],
          importScripts: ['sw-update.js'],
        },
      }),
    ],
  }
})
