import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium, type Browser, type BrowserContext, type Page, type TestInfo } from '@playwright/test'
import { expect, mockWeb, openApp, ROOT } from './scan-helpers'

// Helpers for the whole-app flow tests (tests/e2e/flows.spec.ts): a browser with a recorded bird as the microphone or a
// photo as the camera, a phone-sized context, and the checks that every flow repeats (catching, long tasks).

export { expect, mockWeb, openApp, ROOT }
export const PHOTOS = join(ROOT, 'tests', 'fixtures', 'photos')
export const REDPOLL_WAV = join(ROOT, 'tests', 'fixtures', 'audio', 'birdnet-demo-sample.wav')

interface SpeciesRow {
  id: string
  czechName: string | null
  englishName: string
  scientificName: string
}
const dex = JSON.parse(readFileSync(join(ROOT, 'public', 'data', 'species.json'), 'utf8')) as SpeciesRow[]

/** The Czech name the app shows for a species id (or the scientific name when BirdNET has no Czech one). */
export function czechName(id: string): string {
  const row = dex.find((species) => species.id === id)
  if (!row) throw new Error(`no species ${id}`)
  return row.czechName ?? row.scientificName
}

/** The species id for an English name (the fixture photos' truth.json uses English names). */
export function idOfEnglish(english: string): string | undefined {
  return dex.find((species) => species.englishName === english)?.id
}

export const modelsPresent = (): boolean => {
  try {
    return readFileSync(join(ROOT, 'public', 'models', 'manifest.json')).length > 0
  } catch {
    return false
  }
}

export async function launch(extraArgs: string[] = []): Promise<Browser> {
  return chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required', ...extraArgs],
  })
}

export interface PhoneOptions {
  /** 'block' (the default) keeps the service worker out of the way, so page.route sees every request. */
  serviceWorkers?: 'block' | 'allow'
  permissions?: string[]
  geolocation?: { latitude: number; longitude: number } | null
}

/** A phone-sized context at the baseURL of this run, standing in Prague. */
export async function phone(browser: Browser, testInfo: TestInfo, options: PhoneOptions = {}): Promise<BrowserContext> {
  return browser.newContext({
    baseURL: testInfo.project.use.baseURL,
    serviceWorkers: options.serviceWorkers ?? 'block',
    viewport: { width: 390, height: 844 },
    permissions: options.permissions ?? ['microphone', 'camera', 'geolocation'],
    ...(options.geolocation === null ? {} : { geolocation: options.geolocation ?? { latitude: 50.08, longitude: 14.43 } }),
  })
}

/** Console errors that are not a failure: LiteRT.js and the ONNX runtime print about the missing GPU. */
export const harmless = (message: string): boolean => /WebGPU|Failed to create default|GPU stall|webgpu/i.test(message)

export const cards = (page: Page) => page.getByTestId('result-card')

/** Presses Chytit on the first card and confirms the question. Waits for the success screen. */
export async function catchFirst(page: Page): Promise<void> {
  await cards(page).first().getByRole('button', { name: 'Chytit' }).click()
  const dialog = page.getByRole('alertdialog', { name: 'Přidat do Dexu?' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Chytit' }).click()
  await expect(page.getByTestId('catch-success')).toBeVisible()
}

/** What the result screen offers: the species ids in the order shown, and which of them can be caught. */
export async function readCards(page: Page): Promise<Array<{ id: string; allowed: boolean }>> {
  return cards(page).evaluateAll((elements) =>
    elements.map((element) => ({ id: element.getAttribute('data-species') ?? '', allowed: element.getAttribute('data-allowed') === 'true' })),
  )
}

/** First visit on a screen that shows the "download the bird brain" button: presses it. */
export async function downloadHere(page: Page): Promise<void> {
  await page.getByTestId('model-download').click({ timeout: 30_000 })
}

// ---------- Long tasks ----------

/** Starts watching for tasks that block the page for 50 ms or more. Call before the work, `readLongTasks` afterwards. */
export async function watchLongTasks(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __long?: number[] }
    w.__long = []
    try {
      new PerformanceObserver((list) => list.getEntries().forEach((entry) => w.__long!.push(Math.round(entry.duration)))).observe({ entryTypes: ['longtask'] })
    } catch {
      // No long task API.
    }
  })
}

export async function readLongTasks(page: Page): Promise<number[]> {
  return page.evaluate(() => (window as unknown as { __long?: number[] }).__long ?? [])
}
