import { expect as baseExpect, type BrowserContext, type Page, type TestInfo } from '@playwright/test'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Helpers for the scan end-to-end tests: the app with the pretend engines, a pretend Wikipedia and place lookup (this
// machine cannot reach the real ones, and tests must not depend on them), a look into the database, and a few checks.

/**
 * `expect` that waits up to 10 seconds instead of 5: the machine may be busy with other work (four shared cores), and a
 * screen that needs a moment longer is not a failure.
 */
export const expect = baseExpect.configure({ timeout: 10_000 })

export const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..')
export const PHOTOS = join(ROOT, 'tests', 'fixtures', 'photos')
export const VISION_FIXTURES = join(ROOT, 'tests', 'fixtures', 'vision')
export const AUDIO = join(ROOT, 'tests', 'fixtures', 'audio')

export interface AppOptions {
  /** Which story the pretend engines tell (clear, low, unclear, empty, download-error, storage-full). Default: clear. */
  scenario?: string
  /** The speed of the pretend engines in milliseconds. Default 60. */
  delay?: number
  /** Use the real engines (they need the model files). Default: the pretend ones. */
  engines?: 'fake' | 'real'
  /** More localStorage entries, for example the settings. */
  storage?: Record<string, string>
}

/** Opens a screen as a returning visitor, with the pretend engines and no real network. Call before anything else on the page. */
export async function openApp(page: Page, path: string, options: AppOptions = {}): Promise<void> {
  await mockWeb(page.context())
  await page.addInitScript(
    ({ scenario, delay, engines, storage }) => {
      try {
        localStorage.setItem('birddex:welcomed', '1')
        if (engines === 'fake') {
          localStorage.setItem('birddex:engines', 'fake')
          localStorage.setItem('birddex:fakeDelay', String(delay))
        }
        if (scenario) localStorage.setItem('birddex:fake', scenario)
        // The live camera catches by itself by default; most tests want to look at the screen, so it is off unless asked for.
        if (!(storage as Record<string, string>)['birddex:settings']) localStorage.setItem('birddex:settings', JSON.stringify({ autoCatch: false }))
        for (const [key, value] of Object.entries(storage)) localStorage.setItem(key, value)
      } catch {
        // No storage: the test will say so.
      }
    },
    { scenario: options.scenario, delay: options.delay ?? 60, engines: options.engines ?? 'fake', storage: options.storage ?? {} },
  )
  await page.goto(`/#${path}`)
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible()
}

const CORS = { 'access-control-allow-origin': '*' }

/**
 * Answers the web services the screens may call: the Wikipedia summary, the Commons credit and the pictures of the reference
 * photos, and the place lookup. Needs a context with `serviceWorkers: 'block'` (requests that go through the app's service
 * worker are not seen by routes).
 */
export async function mockWeb(context: BrowserContext, options: { placeName?: string | null } = {}): Promise<void> {
  await context.route(/^https:\/\/en\.wikipedia\.org\/api\/rest_v1\/page\/summary\//, (route) => {
    const title = decodeURIComponent(route.request().url().split('/summary/')[1]).replace(/_/g, ' ')
    const file = `${title.replace(/[^A-Za-z0-9]+/g, '_')}.jpg`
    return route.fulfill({
      status: 200,
      headers: CORS,
      json: {
        type: 'standard',
        title,
        thumbnail: { source: `https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/${file}/330px-${file}`, width: 330, height: 220 },
        originalimage: { source: `https://upload.wikimedia.org/wikipedia/commons/a/ab/${file}`, width: 1200, height: 800 },
        content_urls: { desktop: { page: `https://en.wikipedia.org/wiki/${title.replace(/ /g, '_')}` } },
      },
    })
  })
  await context.route(/^https:\/\/commons\.wikimedia\.org\/w\/api\.php/, (route) =>
    route.fulfill({
      status: 200,
      headers: CORS,
      json: {
        query: {
          pages: [
            {
              imageinfo: [
                { extmetadata: { Artist: { value: 'Jana Fotografka' }, LicenseShortName: { value: 'CC BY-SA 4.0' }, License: { value: 'cc-by-sa-4.0' }, NonFree: { value: 'false' } } },
              ],
            },
          ],
        },
      },
    }),
  )
  await context.route(/^https:\/\/upload\.wikimedia\.org\//, (route) =>
    route.fulfill({
      status: 200,
      headers: CORS,
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="330" height="220"><rect width="330" height="220" fill="#7aa6d8"/><circle cx="200" cy="100" r="44" fill="#222"/><path d="M240 100l40 10-40 12z" fill="#e8a33a"/></svg>',
    }),
  )
  await context.route(/^https:\/\/nominatim\.openstreetmap\.org\/reverse/, (route) =>
    options.placeName === null
      ? route.fulfill({ status: 200, headers: CORS, json: { error: 'Unable to geocode' } })
      : route.fulfill({ status: 200, headers: CORS, json: { address: { city: options.placeName ?? 'Praha', country: 'Česko' } } }),
  )
}

/** The first visit: presses "download the bird brain" on whatever screen shows it, and waits until the banner is gone or says "ready". */
export async function downloadBrain(page: Page): Promise<void> {
  await page.getByTestId('model-download').click()
  await expect(page.getByTestId('model-banner')).toHaveCount(0, { timeout: 30_000 })
}

export interface SavedCatch {
  id: string
  speciesId: string
  method: string
  confidence: number
  caughtAt: number
  location?: { lat: number; lon: number }
  placeName?: string
  mediaId?: string
}

export interface SavedMedia {
  id: string
  kind: string
  mime: string
  size: number
  durationS?: number
  /** Pixels of a saved picture. */
  width?: number
  height?: number
}

/** What is in the app's database: every catch, and every saved photo or clip with its size (and the pixels of a photo). */
export async function readDatabase(page: Page): Promise<{ catches: SavedCatch[]; media: SavedMedia[] }> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('birddex')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const all = <T>(store: string) =>
      new Promise<T[]>((resolve, reject) => {
        if (!db.objectStoreNames.contains(store)) return resolve([])
        const request = db.transaction(store).objectStore(store).getAll()
        request.onsuccess = () => resolve(request.result as T[])
        request.onerror = () => reject(request.error)
      })
    const catches = await all<SavedCatch>('catches')
    const records = await all<{ id: string; kind: string; mime: string; blob: Blob; durationS?: number }>('media')
    const media = await Promise.all(
      records.map(async (record) => {
        const described: SavedMedia = { id: record.id, kind: record.kind, mime: record.mime, size: record.blob.size, durationS: record.durationS }
        if (record.kind === 'image') {
          const bitmap = await createImageBitmap(record.blob)
          described.width = bitmap.width
          described.height = bitmap.height
          bitmap.close()
        }
        return described
      }),
    )
    db.close()
    return { catches, media }
  })
}

/** The average colour of the saved picture of a catch (to tell which part of a photo was kept), as [red, green, blue]. */
export async function savedImageColour(page: Page, mediaId: string): Promise<[number, number, number]> {
  return page.evaluate(async (id) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('birddex')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const record = await new Promise<{ blob: Blob }>((resolve, reject) => {
      const request = db.transaction('media').objectStore('media').get(id)
      request.onsuccess = () => resolve(request.result as { blob: Blob })
      request.onerror = () => reject(request.error)
    })
    db.close()
    const bitmap = await createImageBitmap(record.blob)
    const canvas = document.createElement('canvas')
    canvas.width = 16
    canvas.height = 16
    const context = canvas.getContext('2d')!
    context.drawImage(bitmap, 0, 0, 16, 16)
    const { data } = context.getImageData(0, 0, 16, 16)
    let red = 0
    let green = 0
    let blue = 0
    for (let i = 0; i < data.length; i += 4) {
      red += data[i]
      green += data[i + 1]
      blue += data[i + 2]
    }
    const count = data.length / 4
    return [red / count, green / count, blue / count] as [number, number, number]
  }, mediaId)
}

export interface SyntheticPicture {
  width: number
  height: number
  /** halves: red on the left, blue on the right. gradient: a smooth ramp (small file even when huge). */
  kind: 'halves' | 'gradient'
  name?: string
  type?: string
}

/** Makes a picture inside the page and chooses it in a file input, as if the person had picked it (for sizes no fixture has). */
export async function chooseSyntheticPicture(page: Page, inputTestId: string, picture: SyntheticPicture): Promise<void> {
  await page.evaluate(
    async ({ inputTestId, width, height, kind, name, type }) => {
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const context = canvas.getContext('2d')!
      if (kind === 'halves') {
        context.fillStyle = '#d02020'
        context.fillRect(0, 0, width / 2, height)
        context.fillStyle = '#2040d0'
        context.fillRect(width / 2, 0, width / 2, height)
      } else {
        const gradient = context.createLinearGradient(0, 0, width, height)
        gradient.addColorStop(0, '#30603a')
        gradient.addColorStop(1, '#d0c090')
        context.fillStyle = gradient
        context.fillRect(0, 0, width, height)
      }
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((made) => (made ? resolve(made) : reject(new Error('no blob'))), type, 0.8))
      canvas.width = 0
      canvas.height = 0
      const input = document.querySelector<HTMLInputElement>(`[data-testid="${inputTestId}"]`)
      if (!input) throw new Error(`no input ${inputTestId}`)
      const transfer = new DataTransfer()
      transfer.items.add(new File([blob], name, { type }))
      input.files = transfer.files
      input.dispatchEvent(new Event('change', { bubbles: true }))
    },
    { inputTestId, width: picture.width, height: picture.height, kind: picture.kind, name: picture.name ?? 'synthetic.jpg', type: picture.type ?? 'image/jpeg' },
  )
}

/** How far the screen is wider than the phone: zero when nothing sticks out to the side. */
export async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => {
    const screen = document.querySelector('.bd-lcd')
    return Math.max(
      document.documentElement.scrollWidth - document.documentElement.clientWidth,
      document.body.scrollWidth - document.body.clientWidth,
      screen ? screen.scrollWidth - screen.clientWidth : 0,
    )
  })
}

/** Every control inside the screen that a finger has to hit and that is smaller than 44 px in either direction. */
export async function smallTouchTargets(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const found: string[] = []
    const controls = document.querySelectorAll<HTMLElement>('.bd-lcd a[href], .bd-lcd button, .bd-lcd label.bd-btn, .bd-lcd input:not(.bd-sr-only)')
    controls.forEach((element) => {
      const rect = element.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) return
      // The corner brackets of the crop box draw 28 px but are tappable over 44 px (the tap area is a pseudo-element).
      if (element.classList.contains('bd-crop__handle')) {
        if (rect.width + 16 < 43.5 || rect.height + 16 < 43.5) found.push(`handle ${Math.round(rect.width)}x${Math.round(rect.height)}`)
        return
      }
      if (rect.width < 43.5 || rect.height < 43.5) found.push(`${element.tagName.toLowerCase()}.${element.className} "${element.textContent?.trim() ?? ''}" ${Math.round(rect.width)}x${Math.round(rect.height)}`)
    })
    return found
  })
}

/** Boxes inside the screen whose text sticks out of them to the side (a word too wide for its place, over its neighbour). */
export async function overflowingText(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const found: string[] = []
    document.querySelectorAll<HTMLElement>('.bd-lcd *').forEach((element) => {
      if (element.classList.contains('bd-sr-only') || element.closest('.bd-sr-only')) return
      const style = getComputedStyle(element)
      // Boxes that scroll or clip on purpose (the crop box, the level meter) are not text boxes.
      if (style.display === 'inline' || style.display === 'contents' || style.overflowX !== 'visible') return
      const rect = element.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) return
      if (!Array.from(element.childNodes).some((node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').trim() !== '')) return
      if (element.scrollWidth - element.clientWidth > 1) found.push(`${element.tagName.toLowerCase()}.${element.className} "${(element.textContent ?? '').trim().slice(0, 40)}" ${element.scrollWidth}>${element.clientWidth}`)
    })
    return found
  })
}

/** Saves a screenshot next to the test results, where it can be looked at. */
export async function shot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  // Let the screen finish fading in, so that the picture shows the screen the way a person sees it.
  await page.waitForTimeout(500)
  await page.screenshot({ path: testInfo.outputPath(`${name}.png`) })
}

/** Sets what the browser says about the page being visible (the phone does this when the person leaves the app). */
export async function setPageHidden(page: Page, hidden: boolean): Promise<void> {
  await page.evaluate((value) => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => value })
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (value ? 'hidden' : 'visible') })
    document.dispatchEvent(new Event('visibilitychange'))
  }, hidden)
}
