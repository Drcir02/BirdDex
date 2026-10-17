import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Browser, Page } from '@playwright/test'
import { test } from '@playwright/test'
import { downloadBrain, shot } from './scan-helpers'
import { cards, czechName, expect, harmless, launch, modelsPresent, openApp, PHOTOS, phone, readCards, readLongTasks, ROOT, watchLongTasks } from './flows-helpers'
import { collectErrors } from './shell-helpers'

// Integration checks that need no model files except where said: how the first screen loads, and the pictures a real phone sends
// (12 megapixels, stored sideways with an EXIF flag, PNG, tiny, cut off, not a picture at all). Fixtures: tests/fixtures/phone.

test.setTimeout(300_000)
test.describe.configure({ mode: 'serial' })

const PHONE = join(ROOT, 'tests', 'fixtures', 'phone')
const MALLARD = 'Mallard_drake_on_Union_Bay_Natural_Area.jpg'
const KINGFISHER = 'Common_kingfisher_at_Taipei_Zoo.jpg'
const phoneFile = (name: string) => join(PHONE, name)

let browser: Browser
test.beforeAll(async () => {
  browser = await launch()
})
test.afterAll(async () => {
  await browser?.close()
})

// ---------------------------------------------------------------------------------------------------------------------
// The first screen is light
// ---------------------------------------------------------------------------------------------------------------------

test.describe('startup', () => {
  test('the first screen loads no model, no ML runtime and no other screen, and does not block the page', async ({}, testInfo) => {
    const context = await phone(browser, testInfo)
    try {
      const page = await context.newPage()
      const requested: string[] = []
      page.on('request', (request) => requested.push(new URL(request.url()).pathname))
      await page.addInitScript(() => {
        const w = window as unknown as { __long: number[] }
        w.__long = []
        try {
          new PerformanceObserver((list) => list.getEntries().forEach((entry) => w.__long.push(Math.round(entry.duration)))).observe({ entryTypes: ['longtask'] })
        } catch {
          // No long task API.
        }
      })
      await openApp(page, '/')
      await expect(page.getByTestId('species-card').first()).toBeVisible()
      await page.waitForTimeout(1000)

      const heavy = requested.filter((path) => /\/models\/(?!manifest)|\/vendor\/|\.wasm|\.onnx|\.tflite|ort|litert|\/assets\/(engine|live|runtime|geo|scorer|frame|preprocess|fakes|ScanPhotoPage|ScanSoundPage|ScanLivePage|ResultPage|SettingsPage|AboutPage)-/i.test(path))
      expect(heavy, 'nothing of the ML code or the other screens is needed for the Dex').toEqual([])

      const timing = await page.evaluate(() => {
        const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming
        const paint = performance.getEntriesByName('first-contentful-paint')[0]
        const scripts = performance.getEntriesByType('resource').filter((entry) => /\.js(\?|$)/.test(entry.name)) as PerformanceResourceTiming[]
        return {
          domContentLoaded: Math.round(navigation.domContentLoadedEventEnd),
          firstContentfulPaint: Math.round(paint?.startTime ?? -1),
          scriptKB: Math.round(scripts.reduce((sum, entry) => sum + (entry.decodedBodySize || entry.encodedBodySize), 0) / 1024),
          scripts: scripts.length,
        }
      })
      const longTasks = await readLongTasks(page)
      console.log(`[integration] startup (this machine, local server): ${JSON.stringify(timing)}, long tasks ${JSON.stringify(longTasks)}`)
      expect(timing.scriptKB, 'JavaScript the Dex needs, in KB').toBeLessThan(800)
      expect(timing.firstContentfulPaint).toBeGreaterThan(0)
      expect(timing.firstContentfulPaint).toBeLessThan(4000)
      expect(Math.max(0, ...longTasks)).toBeLessThan(400)
    } finally {
      await context.close()
    }
  })
})

// ---------------------------------------------------------------------------------------------------------------------
// Photos from a real phone
// ---------------------------------------------------------------------------------------------------------------------

/** Records every bitmap the page decodes: how big, and whether it was given back. */
function recordBitmaps(): void {
  const w = window as unknown as { __bitmaps: Array<{ width: number; height: number; closed: boolean }> }
  w.__bitmaps = []
  const original = window.createImageBitmap.bind(window) as (...args: unknown[]) => Promise<ImageBitmap>
  ;(window as unknown as { createImageBitmap: (...args: unknown[]) => Promise<ImageBitmap> }).createImageBitmap = async (...args) => {
    const bitmap = await original(...args)
    const row = { width: bitmap.width, height: bitmap.height, closed: false }
    w.__bitmaps.push(row)
    const close = bitmap.close.bind(bitmap)
    bitmap.close = () => {
      row.closed = true
      close()
    }
    return bitmap
  }
}

const bitmaps = (page: Page) => page.evaluate(() => (window as unknown as { __bitmaps: Array<{ width: number; height: number; closed: boolean }> }).__bitmaps)

const dataUrl = (path: string) => `data:image/jpeg;base64,${readFileSync(path).toString('base64')}`

/**
 * How far the preview on the photo screen is from a reference photo (mean difference of brightness on a small grid, 0 to 255).
 * `turn` rotates the reference by quarter turns (clockwise) first, to show that a wrong direction would be far worse.
 */
async function previewDistance(page: Page, referencePath: string, turn: 0 | 1 | 2 | 3 = 0): Promise<number> {
  return page.evaluate(
    async ([reference, quarter]) => {
      const load = (src: string) =>
        new Promise<HTMLImageElement>((resolve, reject) => {
          const image = new Image()
          image.onload = () => resolve(image)
          image.onerror = () => reject(new Error('picture did not load'))
          image.src = src
        })
      const shown = document.querySelector<HTMLImageElement>('[data-testid="photo-preview"] img')
      if (!shown) throw new Error('no preview')
      const preview = await load(shown.src)
      const GRID = 24
      // The grid has the shape of the preview, and the reference is cut to that shape like the fixture was made (centred, "cover").
      const height = GRID
      const width = Math.max(1, Math.round((GRID * preview.naturalWidth) / preview.naturalHeight))
      const grid = (image: CanvasImageSource, w: number, h: number, quarterTurns: number): Uint8ClampedArray => {
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const context = canvas.getContext('2d')!
        const turned = quarterTurns % 2 === 1
        const sw = turned ? h : w
        const sh = turned ? w : h
        const scale = Math.max(width / sw, height / sh)
        context.translate(width / 2, height / 2)
        context.rotate((quarterTurns * Math.PI) / 2)
        context.drawImage(image, (-w * scale) / 2, (-h * scale) / 2, w * scale, h * scale)
        return context.getImageData(0, 0, width, height).data
      }
      const a = grid(preview, preview.naturalWidth, preview.naturalHeight, 0)
      const original = await load(reference)
      const b = grid(original, original.naturalWidth, original.naturalHeight, quarter)
      let sum = 0
      for (let i = 0; i < a.length; i += 4) sum += Math.abs(0.3 * a[i] + 0.59 * a[i + 1] + 0.11 * a[i + 2] - (0.3 * b[i] + 0.59 * b[i + 1] + 0.11 * b[i + 2]))
      return sum / (a.length / 4)
    },
    [dataUrl(referencePath), turn] as const,
  )
}

test.describe('photos from a phone', () => {
  const problem = (page: Page) => page.getByText('Fotku se nepodařilo otevřít')

  async function pick(page: Page, file: string | { name: string; mimeType: string; buffer: Buffer }): Promise<void> {
    // "Vybrat z galerie" on the first screen, "Jiná fotka" once a picture is open.
    const input = page.locator('[data-testid="photo-pick"], [data-testid="photo-other"]').first()
    await expect(input).toBeAttached()
    await input.setInputFiles(file)
  }

  const previewSize = async (page: Page) => {
    const preview = page.getByTestId('photo-preview')
    await expect(preview).toBeVisible({ timeout: 30_000 })
    return { width: Number(await preview.getAttribute('data-width')), height: Number(await preview.getAttribute('data-height')) }
  }

  test('a 12 megapixel portrait photo stored sideways (EXIF 6) is opened upright and small, with one bitmap at a time', async ({}, testInfo) => {
    const context = await phone(browser, testInfo)
    try {
      const page = await context.newPage()
      const errors = collectErrors(page)
      await page.addInitScript(recordBitmaps)
      await openApp(page, '/scan/photo')
      await downloadBrain(page)
      const before = Date.now()
      await watchLongTasks(page)
      await pick(page, phoneFile('iphone-portrait-12mp-exif6.jpg'))
      const size = await previewSize(page)
      const opened = Date.now() - before
      // 3024 x 4032 upright, kept at 2048 on the long side.
      expect(size).toEqual({ width: 1536, height: 2048 })
      // The picture is the right way up: it matches the upright reference and not a turned one.
      const upright = await previewDistance(page, join(PHOTOS, MALLARD))
      const sideways = await previewDistance(page, join(PHOTOS, MALLARD), 1)
      console.log(`[integration] 12 MP EXIF 6: opened in ${opened} ms, preview ${size.width}x${size.height}, distance to the upright reference ${upright.toFixed(1)}, to a turned one ${sideways.toFixed(1)}`)
      expect(upright).toBeLessThan(sideways / 2)
      // Memory: the browser decoded straight to the working size (no 12 MP bitmap ever existed), and gave everything back.
      const made = await bitmaps(page)
      expect(made.length).toBeGreaterThan(0)
      expect(Math.max(...made.map((bitmap) => Math.max(bitmap.width, bitmap.height)))).toBeLessThanOrEqual(2048)
      expect(made.every((bitmap) => bitmap.closed)).toBe(true)
      const longTasks = await readLongTasks(page)
      console.log(`[integration] 12 MP EXIF 6: long page tasks while opening ${JSON.stringify(longTasks)}`)
      expect(Math.max(0, ...longTasks)).toBeLessThan(400)
      await shot(page, testInfo, 'phone-12mp-portrait')
      await expect(page.getByTestId('photo-identify')).toBeEnabled()
      expect(errors.filter((message) => !harmless(message))).toEqual([])
    } finally {
      await context.close()
    }
  })

  test('the other orientations (upside down, quarter turn the other way) and a PNG come out upright too', async ({}, testInfo) => {
    const context = await phone(browser, testInfo)
    try {
      const page = await context.newPage()
      await openApp(page, '/scan/photo')
      await downloadBrain(page)

      await pick(page, phoneFile('phone-upside-down-exif3.jpg'))
      expect(await previewSize(page)).toEqual({ width: 1200, height: 900 })
      const upsideDown = await previewDistance(page, join(PHOTOS, KINGFISHER))
      expect(upsideDown).toBeLessThan((await previewDistance(page, join(PHOTOS, KINGFISHER), 2)) / 2)

      await pick(page, phoneFile('phone-portrait-exif8.jpg'))
      await expect.poll(async () => (await previewSize(page)).width).toBe(1200)
      expect((await previewSize(page)).height).toBe(900)
      const eight = await previewDistance(page, join(PHOTOS, MALLARD))
      expect(eight).toBeLessThan((await previewDistance(page, join(PHOTOS, MALLARD), 1)) / 2)

      await pick(page, phoneFile('kingfisher.png'))
      await expect.poll(async () => (await previewSize(page)).width).toBe(640)
      expect((await previewSize(page)).height).toBe(427)
      await expect(page.getByTestId('photo-identify')).toBeEnabled()
    } finally {
      await context.close()
    }
  })

  test('a tiny picture is opened and can be sent to the engine', async ({}, testInfo) => {
    const context = await phone(browser, testInfo)
    try {
      const page = await context.newPage()
      await openApp(page, '/scan/photo')
      await downloadBrain(page)
      await pick(page, phoneFile('tiny.jpg'))
      expect(await previewSize(page)).toEqual({ width: 12, height: 9 })
      await page.getByTestId('photo-identify').click()
      await expect(page).toHaveURL(/#\/result$/, { timeout: 30_000 })
      await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible()
    } finally {
      await context.close()
    }
  })

  test('a picture that is cut off, and a file that is not a picture, are explained in Czech with the pickers still there', async ({}, testInfo) => {
    const context = await phone(browser, testInfo)
    try {
      const page = await context.newPage()
      const errors = collectErrors(page)
      await openApp(page, '/scan/photo')

      await pick(page, phoneFile('truncated.jpg'))
      await expect(problem(page)).toBeVisible({ timeout: 20_000 })
      await expect(page.getByTestId('photo-preview')).toHaveCount(0)
      await expect(page.getByTestId('photo-pick')).toBeAttached()
      await expect(page.getByTestId('photo-take')).toBeAttached()
      await shot(page, testInfo, 'phone-cut-off')

      // A text file that pretends to be a JPEG.
      await page.reload()
      await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible()
      await pick(page, { name: 'IMG_0001.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('this is not a picture at all, only text') })
      await expect(problem(page)).toBeVisible({ timeout: 20_000 })

      // A document is refused before it is even read.
      await pick(page, { name: 'kniha.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 not really') })
      await expect(page.getByText('Tohle není obrázek')).toBeVisible({ timeout: 20_000 })

      // And a good one afterwards works as if nothing had happened.
      await downloadBrain(page)
      await pick(page, phoneFile('kingfisher.png'))
      await expect.poll(async () => (await previewSize(page)).width).toBe(640)
      await expect(page.getByTestId('photo-identify')).toBeEnabled()
      expect(errors.filter((message) => !harmless(message) && !/Failed to load resource|could not be decoded|decode/i.test(message))).toEqual([])
    } finally {
      await context.close()
    }
  })

  test.describe('with the real model', () => {
    test.skip(!modelsPresent(), 'the model files are not in public/models (run: npm run fetch-models)')

    test('the 12 megapixel portrait photo is identified as the Mallard, without stalling the page', async ({}, testInfo) => {
      const context = await phone(browser, testInfo)
      try {
        const page = await context.newPage()
        const errors = collectErrors(page)
        await openApp(page, '/scan/photo', { engines: 'real' })
        await page.getByTestId('model-download').click({ timeout: 30_000 })
        await pick(page, phoneFile('iphone-portrait-12mp-exif6.jpg'))
        await expect(page.getByTestId('photo-identify')).toBeEnabled({ timeout: 180_000 })
        await watchLongTasks(page)
        const started = Date.now()
        await page.getByTestId('photo-identify').click()
        await expect(page).toHaveURL(/#\/result$/, { timeout: 60_000 })
        await expect(cards(page).first()).toBeVisible()
        console.log(`[integration] 12 MP portrait: identified in ${Date.now() - started} ms; first card ${JSON.stringify((await readCards(page))[0])}`)
        await expect(cards(page).first().getByTestId('candidate-name')).toHaveText(czechName('anas-platyrhynchos'))
        expect((await readCards(page))[0].allowed).toBe(true)
        const longTasks = await readLongTasks(page)
        console.log(`[integration] 12 MP portrait: long page tasks while identifying ${JSON.stringify(longTasks)}`)
        expect(Math.max(0, ...longTasks)).toBeLessThan(300)

        // The little ones do not crash the engine: no bird is found in 12 x 9 pixels, and the screen says so kindly.
        await page.evaluate(() => {
          window.location.hash = '/scan/photo'
        })
        await pick(page, phoneFile('tiny.jpg'))
        await expect(page.getByTestId('photo-identify')).toBeEnabled({ timeout: 60_000 })
        await page.getByTestId('photo-identify').click()
        await expect(page).toHaveURL(/#\/result$/, { timeout: 60_000 })
        await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible()
        expect((await readCards(page)).every((card) => !card.allowed)).toBe(true)
        expect(errors.filter((message) => !harmless(message))).toEqual([])
      } finally {
        await context.close()
      }
    })
  })
})
