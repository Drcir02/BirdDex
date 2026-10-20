import { expect, type Page } from '@playwright/test'

// Helpers for the Dex end-to-end tests: a pretend Wikipedia and Wikimedia (this machine cannot reach the real ones, and
// tests must not depend on them), and the hidden demo page that fills the Dex with 30 catches.

export interface WikimediaMockOptions {
  /** Wikipedia titles whose article has no picture. */
  withoutPicture?: readonly string[]
  /** Wikipedia titles whose picture has a licence the app must refuse (CC BY-NC). */
  refused?: readonly string[]
  /** Fail every request, as if there were no connection. */
  down?: boolean
  /** Refuse the wide pictures (404), as if Wikimedia no longer served that size. */
  noWidePictures?: boolean
  /** Wait this long (ms) before every answer, to see how many requests run together. */
  delayMs?: number
}

export interface WikimediaMock {
  /** The article titles that were asked for, in order. */
  summaries: string[]
  /** The files whose author and licence were asked for. */
  credits: string[]
  /** The picture addresses that were requested. */
  images: string[]
  /** How many questions to the two web services (summary and credit) were open at the same moment, at most. */
  maxInFlight(): number
  /** How many requests there have been in all, pictures included. */
  total(): number
}

const CORS = { 'access-control-allow-origin': '*' }

const fileName = (title: string) => `${title.replace(/[^A-Za-z0-9]+/g, '_')}.jpg`

/** A small drawing for a picture address, so pictures differ from bird to bird. */
function drawing(name: string): string {
  let hue = 0
  for (const char of name) hue = (hue * 31 + char.charCodeAt(0)) % 360
  return `<svg xmlns="http://www.w3.org/2000/svg" width="330" height="220" viewBox="0 0 330 220"><rect width="330" height="220" fill="hsl(${hue} 55% 62%)"/><circle cx="210" cy="95" r="46" fill="#222"/><circle cx="228" cy="82" r="6" fill="#fff"/><path d="M250 95l40 10-40 12z" fill="#e8a33a"/></svg>`
}

/**
 * Answers the three web services the reference photos use: the Wikipedia summary, the Commons credit and the pictures on
 * upload.wikimedia.org. Needs a context with `serviceWorkers: 'block'`, because requests that go through the app's
 * service worker are not seen by page.route.
 */
export async function mockWikimedia(page: Page, options: WikimediaMockOptions = {}): Promise<WikimediaMock> {
  const mock: WikimediaMock = { summaries: [], credits: [], images: [], maxInFlight: () => peak, total: () => count }
  let open = 0
  let peak = 0
  let count = 0

  // Only the questions to the services count towards the concurrency: pictures are loaded by the browser itself.
  const track = async (answer: () => Promise<void>, isQuestion = true) => {
    if (isQuestion) {
      open += 1
      peak = Math.max(peak, open)
    }
    count += 1
    try {
      if (options.delayMs) await new Promise((resolve) => setTimeout(resolve, options.delayMs))
      await answer()
    } finally {
      if (isQuestion) open -= 1
    }
  }

  await page.route(/^https:\/\/en\.wikipedia\.org\/api\/rest_v1\/page\/summary\//, (route) =>
    track(async () => {
      if (options.down) return route.abort('connectionfailed')
      const title = decodeURIComponent(route.request().url().split('/summary/')[1]).replace(/_/g, ' ')
      mock.summaries.push(title)
      const body: Record<string, unknown> = { type: 'standard', title, extract: `About ${title}.` }
      if (!options.withoutPicture?.includes(title)) {
        const file = fileName(title)
        body.thumbnail = { source: `https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/${file}/330px-${file}`, width: 330, height: 220 }
        body.originalimage = { source: `https://upload.wikimedia.org/wikipedia/commons/a/ab/${file}`, width: 1200, height: 800 }
      }
      body.content_urls = { desktop: { page: `https://en.wikipedia.org/wiki/${title.replace(/ /g, '_')}` } }
      return route.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify(body) })
    }),
  )

  // The fallbacks (Czech Wikipedia, the Commons category and search) find nothing in these tests.
  await page.route(/^https:\/\/cs\.wikipedia\.org\/api\/rest_v1\/page\/summary\//, (route) =>
    track(async () => (options.down ? route.abort('connectionfailed') : route.fulfill({ status: 404, headers: CORS, contentType: 'application/json', body: '{}' })), false),
  )

  await page.route(/^https:\/\/commons\.wikimedia\.org\/w\/api\.php/, (route) =>
    track(async () => {
      if (options.down) return route.abort('connectionfailed')
      if (!new URL(route.request().url()).searchParams.get('titles')) {
        return route.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify({ query: { pages: [] } }) })
      }
      const titles = new URL(route.request().url()).searchParams.get('titles') ?? ''
      const file = titles.replace(/^File:/, '').replace(/ /g, '_')
      mock.credits.push(file)
      const refused = options.refused?.some((title) => file.startsWith(fileName(title).replace(/\.jpg$/, '')))
      const extmetadata = refused
        ? { Artist: { value: 'Someone' }, LicenseShortName: { value: 'CC BY-NC 2.0' }, License: { value: 'cc-by-nc-2.0' } }
        : {
            Artist: { value: '<a href="//commons.wikimedia.org/wiki/User:Jan_Novak" title="User:Jan Novak">Jan Novák</a>' },
            LicenseShortName: { value: 'CC BY-SA 4.0' },
            License: { value: 'cc-by-sa-4.0' },
            NonFree: { value: 'false' },
          }
      return route.fulfill({
        status: 200,
        headers: CORS,
        contentType: 'application/json',
        body: JSON.stringify({ query: { pages: [{ title: titles, imageinfo: [{ extmetadata }] }] } }),
      })
    }),
  )

  await page.route(/^https:\/\/upload\.wikimedia\.org\//, (route) =>
    track(async () => {
      if (options.down) return route.abort('connectionfailed')
      const url = route.request().url()
      mock.images.push(url)
      if (options.noWidePictures && url.includes('/500px-')) return route.fulfill({ status: 404, headers: CORS, body: 'not served' })
      const name = decodeURIComponent(url.split('/').slice(-1)[0]).replace(/^\d+px-/, '')
      return route.fulfill({ status: 200, headers: CORS, contentType: 'image/svg+xml', body: drawing(name) })
    }, false),
  )
  return mock
}

/** Fills the Dex with the 30 demo catches through the hidden page, and waits until they are all there. */
export async function seedDemo(page: Page): Promise<void> {
  await page.goto('/#/dev/demo')
  await page.getByTestId('demo-add').click()
  await expect(page.getByTestId('demo-count')).toContainText('30', { timeout: 60_000 })
  await expect(page.getByTestId('demo-outcome')).toBeVisible()
}

/** The bird names on the cards that are on the page, in order. */
export async function cardIds(page: Page): Promise<string[]> {
  return page.getByTestId('species-card').evaluateAll((items) => items.map((item) => item.getAttribute('data-species-id') ?? ''))
}

/** Puts a catch of the person's own into the database, without going through the app's code. */
export async function addRealCatch(page: Page, speciesId: string): Promise<void> {
  await page.evaluate(
    (id) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('birddex')
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const db = open.result
          const transaction = db.transaction('catches', 'readwrite')
          transaction.objectStore('catches').put({ id: `real-${id}`, speciesId: id, caughtAt: Date.now(), method: 'photo', confidence: 0.9 })
          transaction.oncomplete = () => {
            db.close()
            resolve()
          }
          transaction.onerror = () => reject(transaction.error)
        }
      }),
    speciesId,
  )
}

/** Puts a catch with a photo of the person's own (the bytes of a picture file) into the database, without going through the app's code. */
export async function addRealPhotoCatch(page: Page, speciesId: string, bytes: Buffer): Promise<void> {
  await page.evaluate(
    ({ id, base64 }) =>
      new Promise<void>((resolve, reject) => {
        const data = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
        const open = indexedDB.open('birddex')
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const db = open.result
          const transaction = db.transaction(['catches', 'media'], 'readwrite')
          const mediaId = `photo-${id}`
          transaction.objectStore('media').put({ id: mediaId, kind: 'image', mime: 'image/jpeg', blob: new Blob([data], { type: 'image/jpeg' }), createdAt: Date.now() })
          transaction.objectStore('catches').put({ id: `real-photo-${id}`, speciesId: id, caughtAt: Date.now(), method: 'photo', confidence: 0.9, mediaId })
          transaction.oncomplete = () => {
            db.close()
            resolve()
          }
          transaction.onerror = () => reject(transaction.error)
        }
      }),
    { id: speciesId, base64: bytes.toString('base64') },
  )
}
