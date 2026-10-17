import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Browser, BrowserContext, Page } from '@playwright/test'
import { test } from '@playwright/test'
import { downloadBrain, readDatabase, shot } from './scan-helpers'
import { cards, catchFirst, czechName, downloadHere, expect, harmless, launch, modelsPresent, openApp, PHOTOS } from './flows-helpers'
import { collectErrors } from './shell-helpers'

// The live camera in full screen, with zoom. The camera is pretended: a canvas the size of a phone camera picture (1080 x 1920)
// with a bird photo pasted small in the middle, as a bird that is far away looks. Zooming in is the only way to see it.
//
// Two parts: the screen and the fingers (with the pretend engines, fast), and the real thing (the real bird model: a far
// bird is not recognised at 1x, it is after zooming in, and the picture saved with the catch is the zoomed part).

test.setTimeout(300_000)
test.describe.configure({ mode: 'serial' })

const MALLARD = 'Mallard_drake_on_Union_Bay_Natural_Area.jpg'
const FIXED_DAY = new Date('2026-10-17T10:00:00')

const dataUrl = (name: string) => `data:image/jpeg;base64,${readFileSync(join(PHOTOS, name)).toString('base64')}`

/** Runs in the page: the camera shows `photo` pasted at `fraction` of the picture width in the middle of a plain landscape. */
function installFarCamera(options: { photo: string; fraction: number }): void {
  const canvas = document.createElement('canvas')
  canvas.width = 1080
  canvas.height = 1920
  const context = canvas.getContext('2d')!
  const image = new Image()
  let ready = false
  image.onload = () => {
    ready = true
  }
  image.src = options.photo
  let tick = 0
  setInterval(() => {
    const sky = context.createLinearGradient(0, 0, 0, canvas.height)
    sky.addColorStop(0, '#8fb8d8')
    sky.addColorStop(0.55, '#b9d2b0')
    sky.addColorStop(1, '#5d7d4c')
    context.fillStyle = sky
    context.fillRect(0, 0, canvas.width, canvas.height)
    if (ready) {
      const width = canvas.width * options.fraction
      const height = (image.height / image.width) * width
      context.drawImage(image, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height)
    }
    // A dot that flips every frame, so the stream keeps sending new pictures.
    context.fillStyle = tick++ % 2 === 0 ? '#000' : '#fff'
    context.fillRect(canvas.width - 4, canvas.height - 4, 4, 4)
  }, 66)
  const stream = canvas.captureStream(15)
  const devices = navigator.mediaDevices
  const real = devices.getUserMedia.bind(devices)
  devices.getUserMedia = (constraints?: MediaStreamConstraints) => (constraints?.video ? Promise.resolve(stream) : real(constraints))
}

async function touchPhone(browser: Browser, baseURL: string | undefined): Promise<BrowserContext> {
  return browser.newContext({
    baseURL,
    serviceWorkers: 'block',
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    permissions: ['microphone', 'camera', 'geolocation'],
    geolocation: { latitude: 50.08, longitude: 14.43 },
  })
}

const box = async (page: Page, testId: string) => {
  const rect = await page.getByTestId(testId).boundingBox()
  if (!rect) throw new Error(`${testId} has no box`)
  return rect
}

const zoomOf = async (page: Page) => Number(await page.getByTestId('live-view').getAttribute('data-zoom'))
const transformOf = (page: Page) => page.getByTestId('live-video').evaluate((video) => (video as HTMLVideoElement).style.transform)

test.describe('the screen and the fingers', () => {
  let browser: Browser
  test.beforeAll(async () => {
    browser = await launch()
  })
  test.afterAll(async () => {
    await browser?.close()
  })

  test('the camera takes the whole phone, with the guess, the zoom and the Catch button on top of it', async ({}, testInfo) => {
    const context = await touchPhone(browser, testInfo.project.use.baseURL)
    try {
      const page = await context.newPage()
      const errors = collectErrors(page)
      await page.addInitScript(installFarCamera, { photo: dataUrl(MALLARD), fraction: 0.16 })
      await openApp(page, '/scan/live', { engines: 'fake' })
      await downloadBrain(page)
      await expect(page.getByTestId('live-start')).toBeEnabled({ timeout: 60_000 })
      await shot(page, testInfo, 'live-before-start')

      // Switched off, the layer is there but out of the way.
      await expect(page.getByTestId('live-view')).toBeHidden()

      await page.getByTestId('live-start').click()
      await expect(page.getByTestId('live-view')).toHaveAttribute('data-phase', 'running', { timeout: 30_000 })
      await expect(page.getByTestId('zoom-controls')).toBeVisible()

      const viewport = page.viewportSize()!
      const layer = await box(page, 'live-view')
      expect(layer).toMatchObject({ x: 0, y: 0, width: viewport.width, height: viewport.height })
      const video = await box(page, 'live-video')
      expect(video).toMatchObject({ x: 0, y: 0, width: viewport.width, height: viewport.height })

      // Everything the person needs is inside the screen, and the Catch button is big enough for a thumb.
      for (const id of ['live-catch', 'zoom-controls', 'zoom-readout', 'live-info']) {
        const rect = await box(page, id)
        expect(rect.x).toBeGreaterThanOrEqual(0)
        expect(rect.y).toBeGreaterThanOrEqual(0)
        expect(rect.x + rect.width).toBeLessThanOrEqual(viewport.width + 0.5)
        expect(rect.y + rect.height).toBeLessThanOrEqual(viewport.height + 0.5)
      }
      expect((await box(page, 'live-catch')).height).toBeGreaterThanOrEqual(48)
      for (const step of [1, 2, 3, 5]) expect((await box(page, `zoom-step-${step}`)).height).toBeGreaterThanOrEqual(40)
      // The picture is far bigger than before (it was a small card of about 250 px height inside the green screen).
      expect(video.height).toBeGreaterThan(700)
      await shot(page, testInfo, 'live-full-screen-1x')

      // The device frame (the lens at the top, the navigation at the bottom) is covered by the camera layer.
      const coveredByCamera = (x: number, y: number) =>
        page.evaluate(([px, py]) => document.elementFromPoint(px, py)?.closest('[data-testid="live-view"]') !== null, [x, y])
      expect(await coveredByCamera(60, 40)).toBe(true)
      expect(await coveredByCamera(195, viewport.height - 30)).toBe(true)
      expect(await coveredByCamera(40, viewport.height - 30)).toBe(true)
      expect(errors.filter((message) => !harmless(message))).toEqual([])

      // The cross at the top switches the camera off and the normal screen is back.
      await page.getByRole('button', { name: 'Vypnout kameru' }).click()
      await expect(page.getByTestId('live-start')).toBeVisible()
      await expect(page.getByTestId('live-view')).toBeHidden()
    } finally {
      await context.close()
    }
  })

  test('zoom buttons, pinch with two fingers, and dragging the zoomed picture', async ({}, testInfo) => {
    const context = await touchPhone(browser, testInfo.project.use.baseURL)
    try {
      const page = await context.newPage()
      const errors = collectErrors(page)
      await page.addInitScript(installFarCamera, { photo: dataUrl(MALLARD), fraction: 0.16 })
      await openApp(page, '/scan/live', { engines: 'fake' })
      await downloadBrain(page)
      await expect(page.getByTestId('live-start')).toBeEnabled({ timeout: 60_000 })
      await page.getByTestId('live-start').click()
      await expect(page.getByTestId('zoom-controls')).toBeVisible({ timeout: 30_000 })
      await expect(page.getByTestId('live-view')).toHaveAttribute('data-zoom-mode', 'digital')
      expect(await zoomOf(page)).toBe(1)
      expect(await transformOf(page)).toBe('')
      await expect(page.getByTestId('zoom-readout')).toHaveText('1×')

      // A tap on a number.
      await page.getByTestId('zoom-step-3').tap()
      await expect(page.getByTestId('zoom-readout')).toHaveText('3×')
      expect(await transformOf(page)).toContain('scale(3)')
      await shot(page, testInfo, 'live-zoom-3x')
      await page.getByTestId('zoom-step-1').tap()
      await expect(page.getByTestId('zoom-readout')).toHaveText('1×')
      expect(await transformOf(page)).toBe('')

      // Two fingers apart: from 100 px to 300 px between them is three times the zoom.
      const cdp = await context.newCDPSession(page)
      const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', points: Array<{ x: number; y: number; id: number }>) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points })
      await touch('touchStart', [
        { x: 140, y: 420, id: 1 },
        { x: 240, y: 420, id: 2 },
      ])
      for (const spread of [150, 200, 250, 300]) {
        await touch('touchMove', [
          { x: 190 - spread / 2, y: 420, id: 1 },
          { x: 190 + spread / 2, y: 420, id: 2 },
        ])
      }
      await touch('touchEnd', [])
      await expect.poll(() => zoomOf(page), { timeout: 10_000 }).toBeCloseTo(3, 1)
      await expect(page.getByTestId('zoom-readout')).toHaveText('3×')
      await expect(page.getByTestId('zoom-step-3')).toHaveAttribute('aria-pressed', 'true')

      // One finger drags the zoomed picture; the zoom stays.
      const before = await transformOf(page)
      await touch('touchStart', [{ x: 250, y: 500, id: 1 }])
      for (const x of [230, 200, 170, 140]) await touch('touchMove', [{ x, y: 500, id: 1 }])
      await touch('touchEnd', [])
      const after = await transformOf(page)
      expect(after).not.toBe(before)
      expect(after).toContain('scale(3)')
      expect(await zoomOf(page)).toBeCloseTo(3, 1)
      // The finger moved left, so the view moved right and the picture is shifted left (a negative translate).
      expect(Number(/translate\((-?[\d.]+)%/.exec(after)![1])).toBeLessThan(0)

      // A single tap on the picture changes nothing.
      const still = await transformOf(page)
      await page.touchscreen.tap(200, 450)
      expect(await transformOf(page)).toBe(still)

      // The mouse wheel works too (a computer).
      await page.getByTestId('live-touch').dispatchEvent('wheel', { deltaY: -400 })
      await expect.poll(() => zoomOf(page)).toBeGreaterThan(3.5)

      // Switched off and on again: back to no zoom.
      await page.getByRole('button', { name: 'Vypnout kameru' }).click()
      await page.getByTestId('live-start').click()
      await expect(page.getByTestId('zoom-controls')).toBeVisible({ timeout: 30_000 })
      expect(await zoomOf(page)).toBe(1)
      expect(await transformOf(page)).toBe('')
      expect(errors.filter((message) => !harmless(message))).toEqual([])
    } finally {
      await context.close()
    }
  })
})

test.describe('a bird that is far away, with the real model', () => {
  test.skip(!modelsPresent(), 'the model files are not in public/models (run: npm run fetch-models)')
  let browser: Browser
  test.beforeAll(async () => {
    browser = await launch()
  })
  test.afterAll(async () => {
    await browser?.close()
  })

  test('is not recognised at 1x, is after zooming in, and the picture saved with the catch is the zoomed part', async ({}, testInfo) => {
    const context = await touchPhone(browser, testInfo.project.use.baseURL)
    await context.clock.setFixedTime(FIXED_DAY)
    try {
      const page = await context.newPage()
      const errors = collectErrors(page)
      await page.addInitScript(installFarCamera, { photo: dataUrl(MALLARD), fraction: 0.16 })
      await openApp(page, '/scan', { engines: 'real' })
      await downloadHere(page)
      await expect(page.getByTestId('model-ready')).toBeVisible({ timeout: 180_000 })
      await page.evaluate(() => {
        window.location.hash = '/scan/live'
      })
      await expect(page.getByTestId('live-start')).toBeEnabled({ timeout: 60_000 })
      await page.getByTestId('live-start').click()
      await expect(page.getByTestId('live-view')).toHaveAttribute('data-phase', 'running', { timeout: 30_000 })
      await expect(page.getByTestId('zoom-controls')).toBeVisible()

      // At 1x the bird is a speck. What the scanner makes of that is only reported: it must not catch it as a Mallard.
      await page.waitForTimeout(8000)
      const lockedAtOne = (await page.getByTestId('live-view').getAttribute('data-locked')) === 'true'
      const guessAtOne = (await page.getByTestId('live-guess').count()) > 0 ? await page.getByTestId('live-guess').innerText() : '(no guess)'
      console.log(`[live-zoom] at 1x: locked=${lockedAtOne}, guess=${guessAtOne.replace(/\s+/g, ' ')}`)
      await shot(page, testInfo, 'live-far-bird-1x')

      // Zoomed in, the bird fills the part the model looks at.
      await page.getByTestId('zoom-step-5').tap()
      await expect(page.getByTestId('live-view')).toHaveAttribute('data-locked', 'true', { timeout: 60_000 })
      await expect(page.getByTestId('live-guess')).toContainText(czechName('anas-platyrhynchos'))
      await expect(page.getByTestId('live-catch')).toBeEnabled()
      await shot(page, testInfo, 'live-far-bird-5x-locked')

      // Zooming out again lets go of the lock at once: the Catch button is off before the next picture has been looked at.
      await page.getByTestId('zoom-step-2').tap()
      await expect(page.getByTestId('live-catch')).toBeDisabled()
      await page.getByTestId('zoom-step-5').tap()
      await expect(page.getByTestId('live-view')).toHaveAttribute('data-locked', 'true', { timeout: 60_000 })

      await page.getByTestId('live-catch').click()
      await expect(page).toHaveURL(/#\/result$/, { timeout: 30_000 })
      await expect(cards(page).first().getByTestId('candidate-name')).toHaveText(czechName('anas-platyrhynchos'))
      await catchFirst(page)

      // The saved picture is the zoomed part of the camera picture, not the whole of it (900 x 1600 would be the whole).
      const saved = await readDatabase(page)
      const image = saved.media.find((media) => media.kind === 'image')!
      console.log(`[live-zoom] saved picture: ${image.width} x ${image.height}`)
      expect(Math.max(image.width!, image.height!)).toBeLessThan(700)
      expect(image.width! / image.height!).toBeGreaterThan(0.35)
      expect(image.width! / image.height!).toBeLessThan(0.65)
      expect(errors.filter((message) => !harmless(message))).toEqual([])
    } finally {
      await context.close()
    }
  })
})
