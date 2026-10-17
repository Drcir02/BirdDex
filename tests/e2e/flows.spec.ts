import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Browser, BrowserContext, Page } from '@playwright/test'
import { test } from '@playwright/test'
import { readDatabase, shot } from './scan-helpers'
import {
  cards,
  catchFirst,
  czechName,
  downloadHere,
  expect,
  harmless,
  launch,
  modelsPresent,
  openApp,
  PHOTOS,
  phone,
  readCards,
  readLongTasks,
  REDPOLL_WAV,
  watchLongTasks,
} from './flows-helpers'
import { collectErrors } from './shell-helpers'

// The whole app, end to end, with the REAL engines and the REAL models in Chromium. Only the outside world is pretended:
// the microphone plays a recorded bird, the camera shows a photo (or a pattern), the web services are mocks, and the date is
// fixed (the location filter depends on the week). These tests skip themselves when public/models is missing
// (npm run fetch-models). One context downloads the models once and then does several things, because the download and the
// start of the models are the slow part.
//
// Numbers worth knowing (docs/notes/integration.md): Prague, 17 October (week 39), the Lesser Redpoll recording gives
// "Čečetka tmavá" at 73 %, the photo of the Common Goldeneye 88 % (63 % without the location filter).

test.skip(!modelsPresent(), 'the model files are not in public/models (run: npm run fetch-models)')
test.describe.configure({ mode: 'serial' })
test.setTimeout(300_000)

const FIXED_DAY = new Date('2026-10-17T10:00:00')
/** A task that blocks the page this long counts as a stall. The phone is slower than this machine; this is the cap here. */
const LONG_TASK_LIMIT_MS = 300

const photoPath = (name: string) => join(PHOTOS, name)
const MALLARD = 'Mallard_drake_on_Union_Bay_Natural_Area.jpg'
const KINGFISHER = 'Common_kingfisher_at_Taipei_Zoo.jpg'
const GOLDENEYE = 'Common_goldeneye_at_Discovery_Park_Seattle.jpg'
const CORMORANT = 'Cormorant_on_mooring_post_Lake_Como.jpg'
const PIGEONS = 'Pigeons_near_Museumplein_Amsterdam.jpg'
const SPARROW = 'House_sparrow_bathing_in_mosaic_fountain_Park_Ridge.jpg'
const GEESE = 'Geese_in_misty_rice_paddies_Dehua_Fujian.jpg'
const GULLS = 'Gulls_on_picnic_tables_Seatt' + 'le_waterfront.jpg'
const UNKNOWN = 'Unknown_bird_no_GPS.jpg'
const WOODPECKER = 'Hairy_woodpecker_on_mossy_tree_Carkeek_Park.jpg'

const dataUrl = (name: string) => `data:image/jpeg;base64,${readFileSync(photoPath(name)).toString('base64')}`

async function fixedDay(context: BrowserContext): Promise<void> {
  await context.clock.setFixedTime(FIXED_DAY)
}

/** The first visit of a person: the hub, the download of the whole bird brain (sound, photo, location filter), until it says it is ready. */
async function downloadWholeBrain(page: Page): Promise<void> {
  await openApp(page, '/scan', { engines: 'real' })
  await downloadHere(page)
  await expect(page.getByTestId('model-ready')).toBeVisible({ timeout: 180_000 })
}

/** Opens a scan screen inside the app (no reload: the engines stay warm) and waits for its main key. */
async function goTo(page: Page, path: string): Promise<void> {
  await page.evaluate((to) => {
    window.location.hash = to
  }, path)
}

/** The percentage written on the first result card. */
async function firstPercent(page: Page): Promise<number> {
  const text = await cards(page).first().innerText()
  const match = /(\d+)\s*%/.exec(text)
  if (!match) throw new Error(`no percentage in "${text}"`)
  return Number(match[1])
}

// ---------------------------------------------------------------------------------------------------------------------
// (a) Sound
// ---------------------------------------------------------------------------------------------------------------------

test.describe('sound: a recorded Lesser Redpoll through the microphone', () => {
  let browser: Browser
  test.beforeAll(async () => {
    browser = await launch([`--use-file-for-fake-audio-capture=${REDPOLL_WAV}`])
  })
  test.afterAll(async () => {
    await browser?.close()
  })

  test('is heard, shown first, caught at normal sensitivity, and the Dex plays the saved clip', async ({}, testInfo) => {
    const context = await phone(browser, testInfo)
    await fixedDay(context)
    try {
      const page = await context.newPage()
      const errors = collectErrors(page)
      await openApp(page, '/scan/sound', { engines: 'real' })
      await downloadHere(page)
      await expect(page.getByTestId('sound-start')).toBeEnabled({ timeout: 120_000 })
      await watchLongTasks(page)
      await page.getByTestId('sound-start').click()
      await expect(page.getByTestId('sound-stop')).toBeVisible({ timeout: 30_000 })
      await expect(page.getByTestId('guess').first()).toBeVisible({ timeout: 40_000 })
      await expect(page.getByTestId('guess-name').first()).toHaveText(czechName('acanthis-cabaret'))
      await expect(page.getByTestId('hearing-bird')).toHaveAttribute('data-on', 'true', { timeout: 30_000 })
      await shot(page, testInfo, 'sound-listening')
      await page.getByTestId('sound-stop').click()
      await expect(page).toHaveURL(/#\/result$/, { timeout: 30_000 })

      // The Lesser Redpoll is the first guess and can be caught on the normal setting.
      await expect(cards(page).first().getByTestId('candidate-name')).toHaveText(czechName('acanthis-cabaret'))
      await expect(cards(page).first().getByRole('button', { name: 'Chytit' })).toBeEnabled()
      expect((await readCards(page))[0]).toEqual({ id: 'acanthis-cabaret', allowed: true })
      await expect(page.getByTestId('result-audio')).toBeVisible()
      await shot(page, testInfo, 'sound-result')

      // Listening never stalled the page (BirdNET runs in a worker).
      const longTasks = await readLongTasks(page)
      console.log(`[flows] sound: long page tasks during the scan: ${JSON.stringify(longTasks)}`)
      expect(Math.max(0, ...longTasks)).toBeLessThan(LONG_TASK_LIMIT_MS)

      await catchFirst(page)
      await page.getByTestId('to-dex').click()
      await expect(page).toHaveURL(/#\/species\/acanthis-cabaret/)
      await expect(page.getByTestId('status-caught')).toBeVisible()
      const item = page.getByTestId('catch-item')
      await expect(item).toHaveCount(1)
      await expect(item).toHaveAttribute('data-method', 'sound')
      await expect(item).toContainText('Praha')

      // The clip is saved, is a WAV, and plays.
      const saved = await readDatabase(page)
      expect(saved.catches[0]).toMatchObject({ speciesId: 'acanthis-cabaret', method: 'sound' })
      expect(saved.media[0]).toMatchObject({ kind: 'audio', mime: 'audio/wav' })
      expect(saved.media[0].durationS ?? 0).toBeGreaterThan(2)
      const audio = item.locator('audio')
      await item.getByTestId('audio-toggle').click()
      await expect.poll(() => audio.evaluate((element: HTMLAudioElement) => !element.paused && element.currentTime > 0.2), { timeout: 15_000 }).toBe(true)
      expect(await audio.evaluate((element: HTMLAudioElement) => element.duration)).toBeGreaterThan(2)

      // And the Dex list shows the bird as caught.
      await goTo(page, '/')
      await expect(page.locator('[data-testid="species-card"][data-species-id="acanthis-cabaret"]')).toHaveAttribute('data-caught', 'true')
      expect(errors.filter((message) => !harmless(message))).toEqual([])
    } finally {
      await context.close()
    }
  })
})

// ---------------------------------------------------------------------------------------------------------------------
// (b) Photo
// ---------------------------------------------------------------------------------------------------------------------

test.describe('photo: the fixture photos through the file input', () => {
  let browser: Browser
  test.beforeAll(async () => {
    browser = await launch()
  })
  test.afterAll(async () => {
    await browser?.close()
  })

  /** Picks a photo on the photo screen, presses "Určit", waits for the result screen and returns what it offers. */
  async function identify(page: Page, file: string): Promise<{ cards: Array<{ id: string; allowed: boolean }>; longTasks: number[] }> {
    await goTo(page, '/scan/photo')
    await expect(page.getByTestId('photo-pick')).toBeAttached()
    await page.getByTestId('photo-pick').setInputFiles(photoPath(file))
    await expect(page.getByTestId('photo-identify')).toBeEnabled({ timeout: 120_000 })
    await watchLongTasks(page)
    await page.getByTestId('photo-identify').click()
    await expect(page).toHaveURL(/#\/result$/, { timeout: 60_000 })
    await expect(cards(page).first()).toBeVisible()
    const found = await readCards(page)
    return { cards: found, longTasks: await readLongTasks(page) }
  }

  test('the European birds are in the top three, the foreign ones cannot be caught, and a catch lands in the Dex with its photo', async ({}, testInfo) => {
    const context = await phone(browser, testInfo)
    await fixedDay(context)
    try {
      const page = await context.newPage()
      const errors = collectErrors(page)
      await downloadWholeBrain(page)

      const longTasks: number[] = []
      const rows: string[] = []
      const european: Array<[string, string]> = [
        [KINGFISHER, 'alcedo-atthis'],
        [MALLARD, 'anas-platyrhynchos'],
        [PIGEONS, 'columba-livia'],
        [GOLDENEYE, 'bucephala-clangula'],
        [CORMORANT, 'phalacrocorax-carbo'],
      ]
      for (const [file, id] of european) {
        const result = await identify(page, file)
        longTasks.push(...result.longTasks)
        const percent = await firstPercent(page)
        rows.push(`${file.slice(0, 22)} -> ${result.cards.map((c) => `${c.id}${c.allowed ? '*' : ''}`).join(', ')} (${percent} %)`)
        expect(result.cards.map((c) => c.id), file).toContain(id)
        // The three birds that are clear at any setting can be caught on the normal one.
        if (file === KINGFISHER || file === MALLARD || file === PIGEONS) expect(result.cards[0], file).toEqual({ id, allowed: true })
        if (file === GOLDENEYE) {
          // Without the location filter this photo is 63 % sure and shares the picture with Barrow's Goldeneye; with Prague it is clear.
          expect(result.cards[0], file).toEqual({ id, allowed: true })
          expect(percent).toBeGreaterThanOrEqual(75)
        }
        if (file === MALLARD) await shot(page, testInfo, 'photo-result-mallard')
      }

      // Birds the Dex does not have, or that are not what they look like: nothing can be caught, and the screen says so kindly.
      for (const file of [GEESE, GULLS, UNKNOWN, WOODPECKER]) {
        const result = await identify(page, file)
        longTasks.push(...result.longTasks)
        rows.push(`${file.slice(0, 22)} -> ${result.cards.map((c) => `${c.id}${c.allowed ? '*' : ''}`).join(', ')}`)
        expect(result.cards.filter((c) => c.allowed), file).toEqual([])
        await expect(page.getByTestId('nothing-sure')).toBeVisible()
        for (const button of await cards(page).getByTestId('catch-button').all()) await expect(button).toBeDisabled()
        if (file === GULLS) await shot(page, testInfo, 'photo-result-gulls')
      }

      // The House Sparrow in a mosaic fountain is a known miss of the model: only report what happens.
      const sparrow = await identify(page, SPARROW)
      longTasks.push(...sparrow.longTasks)
      rows.push(`${SPARROW.slice(0, 22)} -> ${sparrow.cards.map((c) => `${c.id}${c.allowed ? '*' : ''}`).join(', ')} (known miss)`)
      console.log(`[flows] photo results (* = can be caught at normal):\n  ${rows.join('\n  ')}`)
      console.log(`[flows] photo: long page tasks while identifying: ${JSON.stringify(longTasks)}`)
      expect(Math.max(0, ...longTasks)).toBeLessThan(LONG_TASK_LIMIT_MS)

      // Catch the Mallard: the photo is saved with it and the Dex shows both.
      await identify(page, MALLARD)
      await catchFirst(page)
      await page.getByTestId('to-dex').click()
      await expect(page).toHaveURL(/#\/species\/anas-platyrhynchos/)
      await expect(page.getByTestId('status-caught')).toBeVisible()
      const item = page.getByTestId('catch-item')
      await expect(item).toHaveAttribute('data-method', 'photo')
      const picture = item.getByTestId('catch-photo').locator('img')
      await expect(picture).toBeVisible()
      expect(await picture.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBeGreaterThan(100)
      const saved = await readDatabase(page)
      expect(saved.catches[0]).toMatchObject({ speciesId: 'anas-platyrhynchos', method: 'photo', placeName: 'Praha' })
      expect(saved.media[0]).toMatchObject({ kind: 'image', mime: 'image/jpeg' })
      await goTo(page, '/')
      await expect(page.locator('[data-testid="species-card"][data-species-id="anas-platyrhynchos"]')).toHaveAttribute('data-caught', 'true')
      expect(errors.filter((message) => !harmless(message))).toEqual([])
    } finally {
      await context.close()
    }
  })
})

// ---------------------------------------------------------------------------------------------------------------------
// (c) Live camera
// ---------------------------------------------------------------------------------------------------------------------

interface FakeCameraWindow {
  __setCameraPhoto?: (url: string) => Promise<void>
}

/**
 * Replaces navigator.mediaDevices.getUserMedia for the video: the camera shows a canvas, and the test chooses which fixture
 * photo is painted on it (canvas.captureStream, like a real camera that is pointed at something). A small dot that flips
 * every frame makes sure the stream keeps sending new pictures even when the photo stays the same.
 */
function installFakeCamera(): void {
  const canvas = document.createElement('canvas')
  canvas.width = 640
  canvas.height = 480
  const context = canvas.getContext('2d')!
  context.fillStyle = '#445'
  context.fillRect(0, 0, canvas.width, canvas.height)
  let image: HTMLImageElement | undefined
  let tick = 0
  setInterval(() => {
    if (image) {
      // "cover": the photo fills the picture, as a camera sensor would.
      const scale = Math.max(canvas.width / image.width, canvas.height / image.height)
      const width = image.width * scale
      const height = image.height * scale
      context.drawImage(image, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height)
    }
    context.fillStyle = tick++ % 2 === 0 ? '#000' : '#fff'
    context.fillRect(canvas.width - 4, canvas.height - 4, 4, 4)
  }, 66)
  const stream = canvas.captureStream(15)
  const devices = navigator.mediaDevices
  const real = devices.getUserMedia.bind(devices)
  devices.getUserMedia = (constraints?: MediaStreamConstraints) => (constraints?.video ? Promise.resolve(stream) : real(constraints))
  ;(window as unknown as FakeCameraWindow).__setCameraPhoto = (url) =>
    new Promise((resolve, reject) => {
      const next = new Image()
      next.onload = () => {
        image = next
        resolve()
      }
      next.onerror = () => reject(new Error('the camera photo did not load'))
      next.src = url
    })
}

const pointCameraAt = (page: Page, file: string) => page.evaluate((url) => (window as unknown as FakeCameraWindow).__setCameraPhoto!(url), dataUrl(file))

test.describe('live camera', () => {
  let browser: Browser
  test.beforeAll(async () => {
    browser = await launch()
  })
  test.afterAll(async () => {
    await browser?.close()
  })

  test('the loop runs on the fake camera pattern, reports a frame rate and never crashes', async ({}, testInfo) => {
    const context = await phone(browser, testInfo)
    await fixedDay(context)
    try {
      const page = await context.newPage()
      const errors = collectErrors(page)
      await downloadWholeBrain(page)

      // The scan screen with the camera's own test pattern (the green moving picture of Chromium's fake device).
      await goTo(page, '/scan/live')
      await expect(page.getByTestId('live-start')).toBeEnabled({ timeout: 60_000 })
      await watchLongTasks(page)
      await page.getByTestId('live-start').click()
      await expect(page.getByTestId('live-view')).toHaveAttribute('data-phase', 'running', { timeout: 30_000 })
      await page.waitForTimeout(8000)
      await expect(page.getByTestId('live-view')).toHaveAttribute('data-phase', 'running')
      await expect(page.getByTestId('live-view')).not.toHaveAttribute('data-locked', 'true')
      await expect(page.getByTestId('live-catch')).toBeDisabled()
      await shot(page, testInfo, 'live-pattern')
      const longTasks = await readLongTasks(page)
      console.log(`[flows] live pattern: long page tasks in 8 s: ${JSON.stringify(longTasks)}`)
      expect(Math.max(0, ...longTasks)).toBeLessThan(LONG_TASK_LIMIT_MS)
      await page.getByRole('button', { name: 'Vypnout kameru' }).click()
      await expect(page.getByTestId('live-start')).toBeVisible()

      // The frame rate is read from the developer page, which logs every update of the scanner.
      await goTo(page, '/dev/photo')
      await page.waitForFunction(() => window.birddexPhotoDev !== undefined)
      await page.evaluate(() => window.birddexPhotoDev!.startLive())
      await page.waitForFunction(() => window.birddexPhotoDev!.getState().live.length >= 4, undefined, { timeout: 60_000 })
      const live = await page.evaluate(() => window.birddexPhotoDev!.getState().live.map((entry) => entry.update))
      await page.evaluate(() => window.birddexPhotoDev!.stopLive())
      const rates = live.map((update) => update.framesPerSecond).filter((rate) => rate > 0)
      console.log(`[flows] live pattern: frames per second ${JSON.stringify(rates.map((r) => Number(r.toFixed(2))))}, locked: ${live.some((u) => u.lockedSpeciesId)}`)
      expect(rates.length).toBeGreaterThanOrEqual(2)
      for (const rate of rates) {
        expect(rate).toBeGreaterThan(0.2)
        expect(rate).toBeLessThan(5)
      }
      // A moving test pattern is not a bird.
      expect(live.some((update) => update.lockedSpeciesId)).toBe(false)
      expect(errors.filter((message) => !harmless(message))).toEqual([])
    } finally {
      await context.close()
    }
  })

  test('locks on a bird shown to the camera, lets go of it, locks on another one, and catches it', async ({}, testInfo) => {
    const context = await phone(browser, testInfo)
    await fixedDay(context)
    try {
      const page = await context.newPage()
      const errors = collectErrors(page)
      await page.addInitScript(installFakeCamera)
      await downloadWholeBrain(page)
      await goTo(page, '/scan/live')
      await expect(page.getByTestId('live-start')).toBeEnabled({ timeout: 60_000 })

      // A gull photo: the scanner does not lock on, and the Catch key stays off.
      await pointCameraAt(page, GULLS)
      await page.getByTestId('live-start').click()
      await expect(page.getByTestId('live-view')).toHaveAttribute('data-phase', 'running', { timeout: 30_000 })
      await expect(page.getByTestId('live-guess')).toBeVisible({ timeout: 30_000 })
      await page.waitForTimeout(6000)
      await expect(page.getByTestId('live-view')).not.toHaveAttribute('data-locked', 'true')
      await expect(page.getByTestId('live-catch')).toBeDisabled()
      await shot(page, testInfo, 'live-gulls-no-lock')

      // The Mallard: it locks on.
      await pointCameraAt(page, MALLARD)
      await expect(page.getByTestId('live-view')).toHaveAttribute('data-locked', 'true', { timeout: 60_000 })
      await expect(page.getByTestId('live-guess')).toContainText(czechName('anas-platyrhynchos'))
      await expect(page.getByTestId('live-catch')).toBeEnabled()
      await shot(page, testInfo, 'live-mallard-locked')

      // Pointed at the gulls again, the lock is let go.
      await pointCameraAt(page, GULLS)
      await expect(page.getByTestId('live-view')).not.toHaveAttribute('data-locked', 'true', { timeout: 60_000 })
      await expect(page.getByTestId('live-catch')).toBeDisabled()

      // The Kingfisher: a different bird locks on, and it is caught.
      await pointCameraAt(page, KINGFISHER)
      await expect(page.getByTestId('live-view')).toHaveAttribute('data-locked', 'true', { timeout: 60_000 })
      await expect(page.getByTestId('live-guess')).toContainText(czechName('alcedo-atthis'))
      await page.getByTestId('live-catch').click()
      await expect(page).toHaveURL(/#\/result$/, { timeout: 30_000 })
      await expect(cards(page).first().getByTestId('candidate-name')).toHaveText(czechName('alcedo-atthis'))
      await catchFirst(page)
      await page.getByTestId('to-dex').click()
      await expect(page).toHaveURL(/#\/species\/alcedo-atthis/)
      await expect(page.getByTestId('status-caught')).toBeVisible()
      await expect(page.getByTestId('catch-item')).toHaveAttribute('data-method', 'live')
      const saved = await readDatabase(page)
      expect(saved.catches[0]).toMatchObject({ speciesId: 'alcedo-atthis', method: 'live' })
      expect(saved.media[0]).toMatchObject({ kind: 'image', mime: 'image/jpeg' })
      // The camera was switched off by leaving the screen.
      expect(errors.filter((message) => !harmless(message))).toEqual([])
    } finally {
      await context.close()
    }
  })
})

// ---------------------------------------------------------------------------------------------------------------------
// (d) Offline: after the first visit and the download, the app and the models need no network
// ---------------------------------------------------------------------------------------------------------------------

test.describe('offline after the models are cached', () => {
  let browser: Browser
  test.beforeAll(async () => {
    browser = await launch([`--use-file-for-fake-audio-capture=${REDPOLL_WAV}`])
  })
  test.afterAll(async () => {
    await browser?.close()
  })

  test('the app reloads, the Dex opens, a photo and a sound are identified with no network at all', async ({}, testInfo) => {
    // The service worker is switched ON here: it is what serves the app when there is no network.
    const context = await phone(browser, testInfo, { serviceWorkers: 'allow' })
    await fixedDay(context)
    try {
      const page = await context.newPage()
      await openApp(page, '/scan', { engines: 'real' })

      // The service worker takes the page over (after its first start the page is reloaded once, as a person would on the second visit).
      await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined))
      await page.reload()
      await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null), { timeout: 20_000 }).toBe(true)

      await downloadHere(page)
      await expect(page.getByTestId('model-ready')).toBeVisible({ timeout: 180_000 })
      // Visit what will be needed later, so that each screen's code and the species list are cached.
      await goTo(page, '/scan/photo')
      await expect(page.getByTestId('photo-pick')).toBeAttached()
      await goTo(page, '/scan/sound')
      await expect(page.getByTestId('sound-start')).toBeEnabled({ timeout: 60_000 })
      await goTo(page, '/')
      await expect(page.getByTestId('species-card').first()).toBeVisible()
      await goTo(page, '/species/anas-platyrhynchos')
      await expect(page.getByTestId('species-name')).toBeVisible()
      await goTo(page, '/scan/live')
      await goTo(page, '/result')

      // What the phone keeps: the model files in their own cache, the runtimes in the service worker's.
      const kept = await page.evaluate(async () => {
        const out: Record<string, number> = {}
        for (const name of await window.caches.keys()) out[name] = (await (await window.caches.open(name)).keys()).length
        return out
      })
      console.log(`[flows] caches: ${JSON.stringify(kept)}`)
      expect(kept['birddex-models-v1']).toBeGreaterThanOrEqual(5)
      expect(kept['birddex-heavy-v1']).toBeGreaterThanOrEqual(2)

      await context.setOffline(true)
      const errors = collectErrors(page)
      await page.goto('/#/scan/photo')
      await page.reload()
      await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible()

      // The photo engine starts from the cached files and identifies a photo.
      await expect(page.getByTestId('photo-pick')).toBeAttached()
      await page.getByTestId('photo-pick').setInputFiles(photoPath(MALLARD))
      await expect(page.getByTestId('photo-identify')).toBeEnabled({ timeout: 120_000 })
      await page.getByTestId('photo-identify').click()
      await expect(page).toHaveURL(/#\/result$/, { timeout: 60_000 })
      await expect(cards(page).first().getByTestId('candidate-name')).toHaveText(czechName('anas-platyrhynchos'))
      await expect(cards(page).first().getByRole('button', { name: 'Chytit' })).toBeEnabled()
      // No network: the name of the place is the coordinates, and the reference photo is the silhouette. Nothing breaks.
      await expect(page.getByTestId('result-where')).toBeVisible()
      await shot(page, testInfo, 'offline-photo-result')
      await catchFirst(page)

      // The sound engine too: BirdNET and the location filter come from the phone.
      await page.reload()
      await goTo(page, '/scan/sound')
      await expect(page.getByTestId('sound-start')).toBeEnabled({ timeout: 120_000 })
      await page.getByTestId('sound-start').click()
      await expect(page.getByTestId('guess').first()).toBeVisible({ timeout: 40_000 })
      await page.getByTestId('sound-stop').click()
      await expect(page).toHaveURL(/#\/result$/, { timeout: 30_000 })
      await expect(cards(page).first().getByTestId('candidate-name')).toHaveText(czechName('acanthis-cabaret'))

      // The Dex opens with the species list and the catch made offline.
      await goTo(page, '/')
      await expect(page.locator('[data-testid="species-card"][data-species-id="anas-platyrhynchos"]')).toHaveAttribute('data-caught', 'true')
      const bad = errors.filter((message) => !harmless(message) && !/ERR_INTERNET_DISCONNECTED|Failed to load resource|net::ERR|Failed to fetch/i.test(message))
      expect(bad).toEqual([])

      // Coming back online changes nothing: the models are still there and the app starts at once.
      await context.setOffline(false)
      await page.reload()
      await goTo(page, '/scan')
      await expect(page.getByTestId('model-ready')).toBeVisible({ timeout: 20_000 })
    } finally {
      await context.close()
    }
  })
})

// ---------------------------------------------------------------------------------------------------------------------
// (e) Backup: export from one phone, import on a fresh one
// ---------------------------------------------------------------------------------------------------------------------

test.describe('backup and restore', () => {
  let browser: Browser
  test.beforeAll(async () => {
    browser = await launch([`--use-file-for-fake-audio-capture=${REDPOLL_WAV}`])
  })
  test.afterAll(async () => {
    await browser?.close()
  })

  test('a real sound catch and a real photo catch survive export and import into a fresh browser profile', async ({}, testInfo) => {
    const backupFile = testInfo.outputPath('backup.zip')
    const first = await phone(browser, testInfo)
    await fixedDay(first)
    try {
      const page = await first.newPage()
      await downloadWholeBrain(page)

      // A sound catch (the recorded redpoll) ...
      await goTo(page, '/scan/sound')
      await expect(page.getByTestId('sound-start')).toBeEnabled({ timeout: 120_000 })
      await page.getByTestId('sound-start').click()
      await expect(page.getByTestId('guess').first()).toBeVisible({ timeout: 40_000 })
      await page.getByTestId('sound-stop').click()
      await expect(page).toHaveURL(/#\/result$/, { timeout: 30_000 })
      await catchFirst(page)
      // ... and a photo catch (the mallard).
      await goTo(page, '/scan/photo')
      await page.getByTestId('photo-pick').setInputFiles(photoPath(MALLARD))
      await expect(page.getByTestId('photo-identify')).toBeEnabled({ timeout: 120_000 })
      await page.getByTestId('photo-identify').click()
      await expect(page).toHaveURL(/#\/result$/, { timeout: 60_000 })
      await catchFirst(page)

      // Settings: make the backup. The browser downloads it (a phone would open its share sheet instead).
      await goTo(page, '/settings')
      await expect(page.getByTestId('backup-export')).toBeEnabled({ timeout: 20_000 })
      const download = page.waitForEvent('download', { timeout: 60_000 })
      await page.getByTestId('backup-export').click()
      // If building took long enough that the file has to be handed over with a second tap, press that too.
      await Promise.race([download.then(() => undefined), page.getByTestId('backup-save').waitFor({ timeout: 60_000 }).then(() => page.getByTestId('backup-save').click())])
      const file = await download
      expect(file.suggestedFilename()).toMatch(/^birddex-backup-\d{4}-\d{2}-\d{2}\.zip$/)
      await file.saveAs(backupFile)
      await expect(page.getByTestId('backup-message')).toHaveAttribute('data-tone', 'success')
      await shot(page, testInfo, 'backup-exported')
    } finally {
      await first.close()
    }

    // What is in the file: the manifest, both catches and both media.
    const { unzipSync, strFromU8 } = await import('fflate')
    const entries = unzipSync(new Uint8Array(readFileSync(backupFile)))
    const names = Object.keys(entries)
    const manifest = JSON.parse(strFromU8(entries['manifest.json'])) as { format: string; counts?: Record<string, number> }
    const catches = JSON.parse(strFromU8(entries['catches.json'])) as Array<{ speciesId: string; method: string }>
    console.log(`[flows] backup: ${names.length} files, ${readFileSync(backupFile).length} bytes, manifest ${JSON.stringify(manifest)}`)
    expect(manifest.format).toBe('birddex-backup')
    expect(catches.map((c) => `${c.method}:${c.speciesId}`).sort()).toEqual(['photo:anas-platyrhynchos', 'sound:acanthis-cabaret'])
    expect(names.filter((name) => name.startsWith('media/'))).toHaveLength(2)

    // A completely new browser profile: empty database, nothing downloaded. The settings screen restores the file.
    const second = await phone(browser, testInfo)
    try {
      const page = await second.newPage()
      const errors = collectErrors(page)
      await openApp(page, '/settings')
      await expect(page.getByTestId('backup-file')).toBeAttached()
      expect((await readDatabase(page).catch(() => ({ catches: [] }))).catches).toHaveLength(0)
      await page.getByTestId('backup-file').setInputFiles(backupFile)
      await expect(page.getByTestId('backup-message')).toHaveAttribute('data-tone', 'success', { timeout: 30_000 })
      await shot(page, testInfo, 'backup-restored')
      const restored = await readDatabase(page)
      expect(restored.catches.map((c) => c.speciesId).sort()).toEqual(['acanthis-cabaret', 'anas-platyrhynchos'])
      expect(restored.media.map((m) => m.kind).sort()).toEqual(['audio', 'image'])

      // The Dex shows both as caught, with the clip and the photo.
      await goTo(page, '/')
      for (const id of ['acanthis-cabaret', 'anas-platyrhynchos']) {
        await expect(page.locator(`[data-testid="species-card"][data-species-id="${id}"]`)).toHaveAttribute('data-caught', 'true')
      }
      await goTo(page, '/species/acanthis-cabaret')
      const item = page.getByTestId('catch-item')
      await item.getByTestId('audio-toggle').click()
      await expect.poll(() => item.locator('audio').evaluate((element: HTMLAudioElement) => !element.paused && element.currentTime > 0.2), { timeout: 15_000 }).toBe(true)
      await goTo(page, '/species/anas-platyrhynchos')
      const picture = page.getByTestId('catch-photo').locator('img')
      await expect(picture).toBeVisible()
      expect(await picture.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBeGreaterThan(100)

      // Importing the same file again changes nothing.
      await goTo(page, '/settings')
      await page.getByTestId('backup-file').setInputFiles(backupFile)
      await expect(page.getByTestId('backup-message')).toHaveAttribute('data-tone', 'success', { timeout: 30_000 })
      expect((await readDatabase(page)).catches).toHaveLength(2)

      // A file that is not a backup gets a calm message and changes nothing.
      await page.getByTestId('backup-file').setInputFiles({ name: 'holiday.zip', mimeType: 'application/zip', buffer: Buffer.from('this is not a zip file at all') })
      await expect(page.getByTestId('backup-message')).toHaveAttribute('data-tone', 'error', { timeout: 20_000 })
      expect((await readDatabase(page)).catches).toHaveLength(2)
      expect(errors.filter((message) => !harmless(message))).toEqual([])
    } finally {
      await second.close()
    }
  })
})

// ---------------------------------------------------------------------------------------------------------------------
// The first-run download of the bird brain, when things go wrong
// ---------------------------------------------------------------------------------------------------------------------

test.describe('first-run download of the models', () => {
  let browser: Browser
  test.beforeAll(async () => {
    browser = await launch()
  })
  test.afterAll(async () => {
    await browser?.close()
  })

  const banner = (page: Page) => page.getByTestId('model-banner')
  const NO_NETWORK = 'Chybí připojení k internetu'
  const DOWNLOAD_FAILED = 'Nepodařilo se stáhnout rozpoznávací model'
  const PHONE_FULL = 'V telefonu došlo místo'

  test('shows the size, then a progress bar that grows, then "ready"; the files stay after a reload', async ({}, testInfo) => {
    const context = await phone(browser, testInfo)
    try {
      const page = await context.newPage()
      await openApp(page, '/scan', { engines: 'real' })
      await expect(banner(page)).toContainText('asi 90 MB')
      await shot(page, testInfo, 'download-offer')
      await downloadHere(page)
      const bar = page.getByRole('progressbar', { name: 'Stahování ptačího mozku' })
      await expect(bar).toBeVisible()
      await expect(page.getByTestId('model-ready')).toBeVisible({ timeout: 180_000 })
      // The model store keeps the five files and the list in Cache Storage, each with its checksum.
      const stored = await page.evaluate(async () => {
        const cache = await caches.open('birddex-models-v1')
        return (await cache.keys()).map((request) => new URL(request.url).pathname.split('/').pop() ?? '').sort()
      })
      expect(stored).toEqual(['manifest.json', 'birdnet-v2.4-fp16.tflite', 'birdnet-v2.4-geo-fp16.tflite', 'text_classifier_int8.bin', 'wingclip_visual_int8.data', 'wingclip_visual_int8.onnx'].sort())
      await page.reload()
      await expect(page.getByTestId('model-ready')).toBeVisible({ timeout: 20_000 })
      await expect(page.getByTestId('model-download')).toHaveCount(0)
    } finally {
      await context.close()
    }
  })

  test('with no network the download says so kindly, and "Zkusit znovu" works once the network is back', async ({}, testInfo) => {
    // The person opened the app at home (the service worker kept it), then lost the network before pressing the button.
    const context = await phone(browser, testInfo, { serviceWorkers: 'allow' })
    try {
      const page = await context.newPage()
      await openApp(page, '/scan', { engines: 'real' })
      await expect(page.getByTestId('model-download')).toBeVisible()
      await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined))
      await page.reload()
      await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null), { timeout: 20_000 }).toBe(true)
      await expect(page.getByTestId('model-download')).toBeVisible()
      await context.setOffline(true)
      await downloadHere(page)
      await expect(banner(page)).toHaveAttribute('data-tone', 'error')
      await expect(banner(page)).toContainText(NO_NETWORK)
      await shot(page, testInfo, 'download-offline')
      await context.setOffline(false)
      await page.getByTestId('model-retry').click()
      await expect(page.getByTestId('model-ready')).toBeVisible({ timeout: 180_000 })
    } finally {
      await context.close()
    }
  })

  test('a damaged file (wrong checksum) is refused, never kept, and the retry fetches a good one', async ({}, testInfo) => {
    const context = await phone(browser, testInfo)
    try {
      const page = await context.newPage()
      const damaged = Buffer.from(readFileSync(join(process.cwd(), 'public', 'models', 'text_classifier_int8.bin')))
      damaged[1000] ^= 0xff
      let served = 0
      await page.route(/\/models\/text_classifier_int8\.bin/, (route) => {
        served++
        return route.fulfill({ status: 200, contentType: 'application/octet-stream', body: damaged })
      })
      await openApp(page, '/scan/photo', { engines: 'real' })
      await downloadHere(page)
      await expect(banner(page)).toHaveAttribute('data-tone', 'error', { timeout: 120_000 })
      await expect(banner(page)).toContainText(DOWNLOAD_FAILED)
      expect(served).toBeGreaterThanOrEqual(2) // it tried again before giving up
      const kept = await page.evaluate(async () => {
        const cache = await caches.open('birddex-models-v1')
        return (await cache.keys()).some((request) => request.url.includes('text_classifier_int8.bin'))
      })
      expect(kept, 'the damaged file must not be kept').toBe(false)
      await shot(page, testInfo, 'download-damaged')
      await page.unroute(/\/models\/text_classifier_int8\.bin/)
      await page.getByTestId('model-retry').click()
      await expect(page.getByTestId('photo-pick')).toBeAttached()
      await page.getByTestId('photo-pick').setInputFiles(photoPath(MALLARD))
      await expect(page.getByTestId('photo-identify')).toBeEnabled({ timeout: 180_000 })
    } finally {
      await context.close()
    }
  })

  test('a connection that drops now and then is retried without bothering anybody', async ({}, testInfo) => {
    const context = await phone(browser, testInfo)
    try {
      const page = await context.newPage()
      let dropped = 0
      await page.route(/\/models\/wingclip_visual_int8\.data/, (route) => {
        if (dropped < 2) {
          dropped++
          return route.abort('connectionreset')
        }
        return route.continue()
      })
      await openApp(page, '/scan/photo', { engines: 'real' })
      await downloadHere(page)
      await page.getByTestId('photo-pick').setInputFiles(photoPath(MALLARD))
      await expect(page.getByTestId('photo-identify')).toBeEnabled({ timeout: 180_000 })
      expect(dropped).toBe(2)
    } finally {
      await context.close()
    }
  })

  test('a server that no longer has a file (404) ends in a calm message with a retry, not a spinner', async ({}, testInfo) => {
    const context = await phone(browser, testInfo)
    try {
      const page = await context.newPage()
      await page.route(/\/models\/birdnet-v2\.4-fp16\.tflite/, (route) => route.fulfill({ status: 404, body: 'not found' }))
      await openApp(page, '/scan/sound', { engines: 'real' })
      await downloadHere(page)
      await expect(banner(page)).toHaveAttribute('data-tone', 'error', { timeout: 60_000 })
      await expect(banner(page)).toContainText(DOWNLOAD_FAILED)
      await expect(page.getByTestId('sound-start')).toBeDisabled()
      await page.unroute(/\/models\/birdnet-v2\.4-fp16\.tflite/)
      await page.getByTestId('model-retry').click()
      await expect(page.getByTestId('sound-start')).toBeEnabled({ timeout: 180_000 })
    } finally {
      await context.close()
    }
  })

  test('a full phone is told so (not enough room announced, or the write refused) and can try again after making room', async ({}, testInfo) => {
    const context = await phone(browser, testInfo)
    try {
      const page = await context.newPage()
      // Two ways a phone can be full: the browser says up front that the quota is too small, or it refuses the write.
      // The flag in localStorage is read when the browser is asked, so the test can "free some space" while the page stays open.
      await page.addInitScript(() => {
        const estimate = navigator.storage.estimate.bind(navigator.storage)
        navigator.storage.estimate = async () => (localStorage.getItem('test:full') === 'estimate' ? { quota: 40_000_000, usage: 39_000_000 } : estimate())
        const put = Cache.prototype.put
        Cache.prototype.put = function (this: Cache, ...args: Parameters<Cache['put']>) {
          if (localStorage.getItem('test:full') === 'write') return Promise.reject(new DOMException('The quota has been exceeded.', 'QuotaExceededError'))
          return put.apply(this, args)
        }
      })
      await openApp(page, '/scan', { engines: 'real', storage: { 'test:full': 'estimate' } })
      await downloadHere(page)
      await expect(banner(page)).toHaveAttribute('data-tone', 'error', { timeout: 60_000 })
      await expect(banner(page)).toContainText(PHONE_FULL)
      await shot(page, testInfo, 'download-full-estimate')

      await page.evaluate(() => localStorage.setItem('test:full', 'write'))
      await page.getByTestId('model-retry').click()
      await expect(banner(page)).toHaveAttribute('data-tone', 'error', { timeout: 120_000 })
      await expect(banner(page)).toContainText(PHONE_FULL)

      // Room was made: the same screen downloads normally.
      await page.evaluate(() => localStorage.removeItem('test:full'))
      await page.getByTestId('model-retry').click()
      await expect(page.getByTestId('model-ready')).toBeVisible({ timeout: 180_000 })
    } finally {
      await context.close()
    }
  })

  test('without a model list (the server has none) the hub explains instead of hanging', async ({}, testInfo) => {
    const context = await phone(browser, testInfo)
    try {
      const page = await context.newPage()
      await page.route(/\/models\/manifest\.json/, (route) => route.fulfill({ status: 404, body: 'nope' }))
      await openApp(page, '/scan', { engines: 'real' })
      await expect(banner(page)).toHaveAttribute('data-tone', 'error', { timeout: 30_000 })
      await expect(banner(page)).toContainText(DOWNLOAD_FAILED)
      await shot(page, testInfo, 'download-no-manifest')
      await page.unroute(/\/models\/manifest\.json/)
      await page.getByTestId('model-retry').click()
      await expect(page.getByTestId('model-ready')).toBeVisible({ timeout: 180_000 })
    } finally {
      await context.close()
    }
  })
})
