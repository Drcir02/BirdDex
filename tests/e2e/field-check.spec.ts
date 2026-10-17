import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'

const status = (page: import('@playwright/test').Page, id: string) => page.getByTestId(`status-${id}`)

test.describe('Field check page', () => {
  // The old home page with its link is gone: the app now opens on the Dex inside the device shell (see shell.spec.ts).
  // The field check stays reachable by its address, even before the welcome screen has been seen.
  test('opens by its address, without the welcome screen', async ({ page }) => {
    await page.goto('/#/field-check')
    await expect(page.getByRole('heading', { name: 'Field check' })).toBeVisible()
  })

  test('environment card reports a working browser', async ({ page }) => {
    await page.goto('/#/field-check')
    // Not installed to a home screen in a test browser, so "check" (warn) is the expected result.
    await expect(status(page, 'environment')).toHaveText(/pass|check/)
    await expect(page.getByTestId('card-environment')).toContainText('WebAssembly: yes')
    await expect(page.getByTestId('card-environment')).toContainText('AudioWorklet: yes')
  })

  test('microphone records from the fake device and meters it', async ({ page }) => {
    await page.goto('/#/field-check')
    await page.getByTestId('mic-start').click()
    await expect(status(page, 'microphone')).toHaveText('running')
    await expect(status(page, 'microphone')).toHaveText('pass', { timeout: 20_000 })
    await expect(page.getByTestId('card-microphone')).toContainText('Captured')
    await expect(page.getByTestId('card-microphone')).toContainText('echoCancellation=false')
  })

  test('camera shows frames from the fake device and captures one', async ({ page }) => {
    await page.goto('/#/field-check')
    await page.getByTestId('camera-start').click()
    await expect(status(page, 'camera')).toHaveText('pass', { timeout: 20_000 })
    await page.getByRole('button', { name: 'Capture a frame' }).click()
    await expect(page.getByTestId('card-camera')).toContainText('Captured a frame')
    await page.getByRole('button', { name: 'Stop' }).click()
  })

  test('location returns the configured position, rounded', async ({ page }) => {
    await page.goto('/#/field-check')
    await page.getByTestId('location-start').click()
    await expect(status(page, 'location')).toHaveText('pass', { timeout: 20_000 })
    await expect(page.getByTestId('card-location')).toContainText('50.08, 14.43')
  })

  test('storage test writes, verifies and survives a reload', async ({ page }) => {
    await page.goto('/#/field-check')
    await page.getByRole('combobox').selectOption('20')
    await page.getByTestId('storage-write').click()
    await expect(status(page, 'storage')).toHaveText('pass', { timeout: 60_000 })
    await page.getByTestId('storage-verify').click()
    await expect(page.getByTestId('card-storage')).toContainText('read back correctly', { timeout: 60_000 })

    await page.reload()
    await expect(page.getByTestId('card-storage')).toContainText('Still there: 5/5 pieces in IndexedDB, 5/5 in Cache Storage')
  })

  test('app starts offline once the service worker has cached it', async ({ page, context }) => {
    await page.goto('/#/field-check')
    await page.waitForFunction(async () => (await navigator.serviceWorker.getRegistration())?.active !== undefined, undefined, { timeout: 30_000 })
    // Reload once so the service worker controls the page, then go offline and load again.
    await page.reload()
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null)
    await context.setOffline(true)
    await page.reload()
    await expect(page.getByRole('heading', { name: 'Field check' })).toBeVisible()
    await expect(page.getByTestId('card-offline')).toContainText('Offline start works')
    await expect(status(page, 'offline')).toHaveText('pass')
    await context.setOffline(false)
  })

  test('report lists every card and can be copied', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await page.goto('/#/field-check')
    await expect(page.getByTestId('report-text')).toHaveValue(/\[(PASS|WARN)\] Device and browser/)
    await page.getByTestId('report-copy').click()
    await expect(page.getByText('Copied. Paste it into the chat.')).toBeVisible()
    const copied = await page.evaluate(() => navigator.clipboard.readText())
    expect(copied).toContain('BirdDex field check')
    expect(copied).toContain('Model speed')
  })
})

// The speed test reads the benchmarks from models/manifest.json (version 2). Playwright cannot intercept requests that a
// service worker handles, so these tests keep the worker out, and they answer the manifest themselves: the real one
// exists on a machine that has the models, and would start the real, slow benchmarks.
test.describe('Model speed test', () => {
  test.use({ serviceWorkers: 'block' })

  const input = { shape: [1, 1024], dtype: 'float32' }
  const fixture = (file: string) => {
    const bytes = readFileSync(`tests/fixtures/models/${file}`)
    return { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }
  }
  const tinyManifest = () => ({
    version: 2,
    files: [
      { id: 'tiny-onnx', file: 'tiny.onnx', label: 'Tiny model (ONNX)', ...fixture('tiny.onnx') },
      { id: 'tiny-tflite', file: 'tiny.tflite', label: 'Tiny model (TFLite)', ...fixture('tiny.tflite') },
    ],
    benchmarks: [
      { id: 'tiny-onnx', label: 'Tiny model (ONNX)', runtime: 'ort', file: 'tiny.onnx', input },
      { id: 'tiny-tflite', label: 'Tiny model (TFLite)', runtime: 'litert', file: 'tiny.tflite', input },
    ],
  })

  test('explains when no models are bundled yet', async ({ page }) => {
    await page.route('**/models/manifest.json', (route) => route.fulfill({ status: 404, body: 'not found' }))
    await page.goto('/#/field-check')
    await page.getByTestId('models-start').click()
    await expect(status(page, 'models')).toHaveText('check', { timeout: 30_000 })
    await expect(page.getByTestId('card-models')).toContainText('CPU baseline')
    await expect(page.getByTestId('card-models')).toContainText('No models are bundled in this build yet')
  })

  test('explains a model list in the old format instead of timing nothing', async ({ page }) => {
    await page.route('**/models/manifest.json', (route) => route.fulfill({ json: { models: [{ id: 'old', url: 'old.onnx' }] } }))
    await page.goto('/#/field-check')
    await page.getByTestId('models-start').click()
    await expect(status(page, 'models')).toHaveText('check', { timeout: 30_000 })
    await expect(page.getByTestId('card-models')).toContainText('The model list is not usable')
  })

  test('runs ONNX Runtime Web and LiteRT.js on the CPU path', async ({ page }) => {
    await page.route('**/models/manifest.json', (route) => route.fulfill({ json: tinyManifest() }))
    await page.route('**/models/tiny.onnx', (route) => route.fulfill({ path: 'tests/fixtures/models/tiny.onnx', contentType: 'application/octet-stream' }))
    await page.route('**/models/tiny.tflite', (route) => route.fulfill({ path: 'tests/fixtures/models/tiny.tflite', contentType: 'application/octet-stream' }))

    await page.goto('/#/field-check')
    await page.getByTestId('models-start').click()
    // WebGPU is not available in headless Chromium, so only the CPU (wasm) paths must pass.
    await expect(page.getByTestId('status-models')).toHaveText('pass', { timeout: 90_000 })
    const card = page.getByTestId('card-models')
    await expect(card).toContainText('ONNX Runtime Web / wasm: ready')
    await expect(card).toContainText('LiteRT.js / wasm: ready')
    await expect(card).toContainText('10 values')
    await expect(card).toContainText('1024 values')
    await expect(card).not.toContainText('NaN')
  })

  test('also downloads the extra files a model lists, such as the weights of a split model', async ({ page }) => {
    const manifest = tinyManifest()
    manifest.benchmarks = [{ ...manifest.benchmarks[0], externalData: ['tiny-weights.data'] } as (typeof manifest.benchmarks)[number]]
    const asked: string[] = []
    await page.route('**/models/manifest.json', (route) => route.fulfill({ json: manifest }))
    await page.route('**/models/tiny.onnx', (route) => route.fulfill({ path: 'tests/fixtures/models/tiny.onnx', contentType: 'application/octet-stream' }))
    await page.route('**/models/tiny-weights.data', (route) => {
      asked.push(route.request().url())
      return route.fulfill({ body: Buffer.alloc(64, 1), contentType: 'application/octet-stream' })
    })

    await page.goto('/#/field-check')
    await page.getByTestId('models-start').click()
    await expect(status(page, 'models')).toHaveText('pass', { timeout: 90_000 })
    // The model and its weights file: two downloads, the weights once (not once per accelerator).
    await expect(page.getByTestId('card-models').locator('li', { hasText: 'Downloaded' })).toHaveCount(2)
    expect(asked).toHaveLength(1)
    await expect(page.getByTestId('card-models')).toContainText('ONNX Runtime Web / wasm: ready')
  })
})
