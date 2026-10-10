import { defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config'

// Same sizes as the minimal-2023 preset, but the maskable and Apple icons are padded onto the app's
// mustard instead of white, so the rounded square doesn't sit in a white frame.
const mustard = '#B8901C'

export default defineConfig({
  headLinkOptions: { preset: '2023' },
  preset: {
    ...minimal2023Preset,
    maskable: { ...minimal2023Preset.maskable, padding: 0.2, resizeOptions: { background: mustard, fit: 'contain' } },
    apple: { ...minimal2023Preset.apple, padding: 0.12, resizeOptions: { background: mustard, fit: 'contain' } },
  },
  images: ['public/icon.svg'],
})
