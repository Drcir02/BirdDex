import { defineConfig } from '@playwright/test'

// The end-to-end tests drive the built app in Chromium with a fake microphone and camera.
//
// On the cloud machine Chromium is already installed:
//   CHROMIUM_PATH=/opt/pw-browsers/chromium E2E_PORT=4181 npx playwright test
//
// Several people can run this at the same time if each uses its own E2E_PORT: every port gets its own build folder.
//
// Optional: FAKE_AUDIO_FILE=/path/to/clip.wav makes the fake microphone play that file (it loops).
const port = Number(process.env.E2E_PORT ?? 4173)
const outDir = `dist-e2e-${port}`

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 120_000,
  retries: 0,
  workers: 1,
  outputDir: `test-results/${port}`,
  use: {
    baseURL: `http://localhost:${port}`,
    launchOptions: {
      executablePath: process.env.CHROMIUM_PATH || undefined,
      args: [
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
        '--autoplay-policy=no-user-gesture-required',
        ...(process.env.FAKE_AUDIO_FILE ? [`--use-file-for-fake-audio-capture=${process.env.FAKE_AUDIO_FILE}`] : []),
      ],
    },
    permissions: ['microphone', 'camera', 'geolocation'],
    geolocation: { latitude: 50.08, longitude: 14.43 },
  },
  webServer: {
    command: `npm run vendor && npx vite build --outDir ${outDir} --emptyOutDir && npx vite preview --outDir ${outDir} --port ${port} --strictPort`,
    url: `http://localhost:${port}`,
    reuseExistingServer: false,
    timeout: 300_000,
  },
})
