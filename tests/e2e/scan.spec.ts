import { chromium, test, type Browser, type Page } from '@playwright/test'
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  chooseSyntheticPicture,
  downloadBrain,
  expect,
  horizontalOverflow,
  openApp,
  overflowingText,
  PHOTOS,
  readDatabase,
  ROOT,
  savedImageColour,
  setPageHidden,
  shot,
  smallTouchTargets,
  VISION_FIXTURES,
} from './scan-helpers'
import { collectErrors } from './shell-helpers'
import { buildExifSegment } from '../unit/helpers/exif-jpeg'

// The scan screens with the pretend engines (?engines=fake): the hub, the sound, photo and live screens, the result screen,
// the catch, and what the Dex shows afterwards. Every flow runs in real Chromium, with a fake microphone and camera.
// A few tests at the end use the real models; they skip themselves when public/models is not there.
//
//   CHROMIUM_PATH=/opt/pw-browsers/chromium E2E_PORT=4187 npx playwright test tests/e2e/scan.spec.ts
//
// The pretend Wikipedia and place lookup need the service worker out of the way (see scan-helpers.ts).

// The app is used on a phone: every flow runs at the size of a small one (the layout tests below also try 360x800).
test.use({ serviceWorkers: 'block', viewport: { width: 390, height: 844 } })

const MALLARD = join(PHOTOS, 'Mallard_drake_on_Union_Bay_Natural_Area.jpg')
const ROTATED = join(VISION_FIXTURES, 'mallard-exif-rotated.jpg')

const PHONES = [
  { width: 390, height: 844 },
  { width: 360, height: 800 },
] as const

const device = (page: Page) => page.getByTestId('device')
const cards = (page: Page) => page.getByTestId('result-card')

/**
 * Drags a corner bracket of the crop box so that the corner of the box lands on (fractionX, fractionY) of the picture.
 * The finger takes the bracket a little inside the corner, so the drag is corrected by that distance.
 */
async function dragCorner(page: Page, corner: 'nw' | 'ne' | 'sw' | 'se', fractionX: number, fractionY: number): Promise<void> {
  const layer = (await page.getByTestId('crop-layer').boundingBox())!
  const handle = (await page.getByTestId(`crop-${corner}`).boundingBox())!
  const cornerX = corner.includes('w') ? layer.x : layer.x + layer.width
  const cornerY = corner.includes('n') ? layer.y : layer.y + layer.height
  const grabX = handle.x + handle.width / 2
  const grabY = handle.y + handle.height / 2
  await page.mouse.move(grabX, grabY)
  await page.mouse.down()
  await page.mouse.move(layer.x + layer.width * fractionX + (grabX - cornerX), layer.y + layer.height * fractionY + (grabY - cornerY), { steps: 8 })
  await page.mouse.up()
}

/** Presses Chytit on the first card, answers the question and waits for the success screen. */
async function catchFirst(page: Page): Promise<void> {
  await cards(page).first().getByRole('button', { name: 'Chytit' }).click()
  const dialog = page.getByRole('alertdialog', { name: 'Přidat do Dexu?' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Chytit' }).click()
  await expect(page.getByTestId('catch-success')).toBeVisible()
}

// ---------------------------------------------------------------------------------------------------------------------
// The hub
// ---------------------------------------------------------------------------------------------------------------------

test.describe('the scan hub', () => {
  test('shows the three ways and offers the download of the bird brain, then says it is ready', async ({ page }, testInfo) => {
    const errors = collectErrors(page)
    await openApp(page, '/scan', { delay: 150 })
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Skenovat')
    await expect(page.getByTestId('nav-scan')).toHaveAttribute('aria-current', 'page')

    for (const [id, title] of [
      ['tile-sound', 'Poslouchat'],
      ['tile-photo', 'Vyfotit nebo z galerie'],
      ['tile-live', 'Živá kamera'],
    ] as const) {
      await expect(page.getByTestId(id)).toContainText(title)
    }

    const banner = page.getByTestId('model-banner')
    await expect(banner).toContainText('Ptačí mozek')
    await expect(banner.getByRole('button', { name: 'Stáhnout ptačí mozek' })).toBeVisible()
    await expect(banner).toContainText('(asi 90 MB, nejlépe přes Wi-Fi)')
    await shot(page, testInfo, 'hub-needed')

    await banner.getByRole('button', { name: 'Stáhnout ptačí mozek' }).click()
    const bar = page.getByRole('progressbar', { name: 'Stahování ptačího mozku' })
    await expect(bar).toBeVisible()
    await expect(page.getByTestId('model-banner')).toContainText('Nech aplikaci otevřenou')
    await shot(page, testInfo, 'hub-downloading')
    await expect(page.getByTestId('model-ready')).toHaveText('Ptačí mozek je připravený. Funguje i bez internetu.', { timeout: 20_000 })
    await expect(page.getByTestId('model-banner')).toHaveCount(0)
    await shot(page, testInfo, 'hub-ready')
    expect(errors).toEqual([])
  })

  test('shows a failed download calmly and finishes it after "Zkusit znovu"', async ({ page }) => {
    await openApp(page, '/scan', { scenario: 'download-error' })
    await page.getByTestId('model-download').click()
    const alert = page.getByRole('alert')
    await expect(alert).toContainText('Nepodařilo se stáhnout rozpoznávací model. Zkontroluj připojení a zkus to znovu.')
    await expect(device(page)).toBeVisible()
    // Each pretend engine fails once: the sound model, then (after "try again") the photo model.
    await alert.getByRole('button', { name: 'Zkusit znovu' }).click()
    await expect(page.getByTestId('model-banner')).toContainText('Zkontroluj připojení')
    await page.getByTestId('model-retry').click()
    await expect(page.getByTestId('model-ready')).toBeVisible({ timeout: 20_000 })
  })

  test('says that the phone is full when there is no room for the models', async ({ page }) => {
    await openApp(page, '/scan', { scenario: 'storage-full' })
    await page.getByTestId('model-download').click()
    await expect(page.getByRole('alert')).toContainText('V telefonu došlo místo')
    await expect(page.getByTestId('model-retry')).toBeVisible()
  })

  test('opens each way from its button', async ({ page }) => {
    await openApp(page, '/scan')
    await page.getByTestId('tile-sound').click()
    await expect(page).toHaveURL(/#\/scan\/sound$/)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Poslech')
    await page.getByRole('link', { name: 'Zpět' }).click()
    await page.getByTestId('tile-photo').click()
    await expect(page).toHaveURL(/#\/scan\/photo$/)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Fotka')
    await page.getByRole('link', { name: 'Zpět' }).click()
    await page.getByTestId('tile-live').click()
    await expect(page).toHaveURL(/#\/scan\/live$/)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Živá kamera')
  })

  test('once downloaded the other screens do not ask again, and start their engine by themselves', async ({ page }) => {
    await openApp(page, '/scan', { delay: 20 })
    await page.getByTestId('model-download').click()
    await expect(page.getByTestId('model-ready')).toBeVisible({ timeout: 20_000 })
    for (const path of ['sound', 'photo', 'live']) {
      await page.getByTestId(`tile-${path}`).click()
      await expect(page.getByTestId('model-banner')).toHaveCount(0)
      await page.getByRole('link', { name: 'Zpět' }).click()
    }
  })
})

// ---------------------------------------------------------------------------------------------------------------------
// Sound
// ---------------------------------------------------------------------------------------------------------------------

test.describe('scan by sound', () => {
  test('listens, shows the level and the top guesses, and after Done the catch goes into the Dex with the clip', async ({ page }, testInfo) => {
    const errors = collectErrors(page)
    const placeLookups: string[] = []
    page.on('request', (request) => {
      if (request.url().includes('nominatim.openstreetmap.org')) placeLookups.push(request.url())
    })
    await openApp(page, '/scan/sound', { delay: 120 })
    await expect(page.getByTestId('sound-start')).toBeDisabled()
    await shot(page, testInfo, 'sound-needed')
    await downloadBrain(page)

    const start = page.getByTestId('sound-start')
    await expect(start).toBeEnabled()
    await expect(start).toContainText('Začít poslouchat')
    await shot(page, testInfo, 'sound-idle')

    await start.click()
    await expect(page.getByTestId('sound-stop')).toBeVisible()
    await expect(device(page)).toHaveAttribute('data-status', 'listening')
    await expect(page.getByRole('meter', { name: 'Hlasitost mikrofonu' })).toBeVisible()
    await expect(page.getByTestId('guess-name').first()).toHaveText('Sýkora koňadra')
    await expect(page.getByTestId('hearing-bird')).toHaveAttribute('data-on', 'true')
    await expect(page.getByTestId('elapsed')).not.toHaveText('0:00', { timeout: 5000 })
    await expect(page.getByTestId('guess-percent').first()).toHaveText(/^9\d\s%$/, { timeout: 5000 })
    await expect(page.getByTestId('guess')).toHaveCount(3)
    await shot(page, testInfo, 'sound-listening')

    await page.getByTestId('sound-stop').click()
    await expect(page).toHaveURL(/#\/result$/)
    await expect(cards(page)).toHaveCount(3)
    await expect(device(page)).toHaveAttribute('data-status', 'idle')

    // Only the sure guess can be caught; the others say why not.
    const first = cards(page).nth(0)
    await expect(first.getByTestId('candidate-name')).toHaveText('Sýkora koňadra')
    await expect(first.getByRole('button', { name: 'Chytit' })).toBeEnabled()
    for (const index of [1, 2]) {
      await expect(cards(page).nth(index).getByRole('button', { name: 'Chytit' })).toBeEnabled()
      await expect(cards(page).nth(index).getByTestId('catch-reason')).toContainText('Zatím to není dost jisté')
    }
    // What will be saved: the clip, the time and the place.
    await expect(page.getByTestId('result-audio')).toBeVisible()
    await expect(page.getByTestId('result-when')).toContainText(new Date().getFullYear().toString())
    // The coordinates for now: the name of the place is looked up only when the catch is confirmed (privacy).
    await expect(page.getByTestId('result-where')).toHaveText(/50,08° S, 14,43° V/)
    expect(placeLookups).toEqual([])
    await shot(page, testInfo, 'result-sound')

    // The question, in Czech, before anything is saved.
    await first.getByRole('button', { name: 'Chytit' }).click()
    const dialog = page.getByRole('alertdialog', { name: 'Přidat do Dexu?' })
    await expect(dialog).toContainText('Sýkora koňadra')
    await expect(dialog).toContainText('Uložím ho i s datem, místem a nahrávkou.')
    await shot(page, testInfo, 'result-confirm')
    await dialog.getByRole('button', { name: 'Ještě ne' }).click()
    await expect(dialog).toHaveCount(0)
    expect((await readDatabase(page).catch(() => ({ catches: [] }))).catches).toHaveLength(0)
    await first.getByRole('button', { name: 'Chytit' }).click()
    await dialog.getByRole('button', { name: 'Chytit' }).click()

    await expect(page.getByTestId('catch-message')).toHaveText('Máš ho! Sýkora koňadra je v Dexu.')
    await expect(page.getByTestId('celebration')).toBeAttached()
    await expect(device(page)).toHaveAttribute('data-status', 'success')
    await shot(page, testInfo, 'catch-success')

    const saved = await readDatabase(page)
    expect(saved.catches).toHaveLength(1)
    expect(saved.catches[0]).toMatchObject({ speciesId: 'parus-major', method: 'sound', placeName: 'Praha', location: { lat: 50.08, lon: 14.43 } })
    expect(saved.catches[0].confidence).toBeGreaterThan(0.9)
    expect(saved.catches[0].caughtAt).toBeGreaterThan(Date.now() - 120_000)
    expect(saved.media).toHaveLength(1)
    expect(saved.media[0]).toMatchObject({ kind: 'audio', mime: 'audio/wav', durationS: 2 })
    expect(saved.media[0].size).toBeGreaterThan(10_000)
    expect(saved.catches[0].mediaId).toBe(saved.media[0].id)

    // The Dex now shows the bird as caught, and the bird's page has the catch with its clip.
    await page.getByTestId('to-dex').click()
    await expect(page).toHaveURL(/#\/species\/parus-major/)
    await expect(page.getByTestId('status-caught')).toBeVisible()
    await expect(page.getByTestId('catch-item')).toHaveCount(1)
    await expect(page.getByTestId('catch-item')).toHaveAttribute('data-method', 'sound')
    await page.getByTestId('nav-dex').click()
    await expect(page.locator('[data-testid="species-card"][data-species-id="parus-major"]')).toHaveAttribute('data-caught', 'true')

    expect(errors).toEqual([])
  })

  test('with nothing sure enough it says "Nic jistého", gives tips, and "Zkusit znovu" goes back to listening', async ({ page }, testInfo) => {
    await openApp(page, '/scan/sound', { scenario: 'low', delay: 80 })
    await downloadBrain(page)
    await page.getByTestId('sound-start').click()
    await expect(page.getByTestId('guess')).toHaveCount(3)
    await page.getByTestId('sound-stop').click()
    await expect(page).toHaveURL(/#\/result$/)
    const panel = page.getByTestId('nothing-sure')
    await expect(panel).toContainText('Nic jistého')
    await expect(panel).toContainText('Poslouchej aspoň deset sekund.')
    await expect(page.getByRole('heading', { name: 'Moje tipy, zatím nejisté' })).toBeVisible()
    await expect(cards(page)).toHaveCount(3)
    for (let index = 0; index < 3; index++) await expect(cards(page).nth(index).getByRole('button', { name: 'Chytit' })).toBeEnabled()
    await shot(page, testInfo, 'result-nothing-sure')
    await page.getByTestId('retry-scan').click()
    await expect(page).toHaveURL(/#\/scan\/sound$/)
    expect((await readDatabase(page).catch(() => ({ catches: [] }))).catches).toHaveLength(0)
  })

  test('says "Nic jistého" with different tips when not even a guess came out', async ({ page }) => {
    await openApp(page, '/scan/sound', { scenario: 'empty', delay: 60 })
    await downloadBrain(page)
    await page.getByTestId('sound-start').click()
    await expect(page.getByTestId('sound-stop')).toBeVisible()
    await expect(page.getByText('Zatím nic nepoznávám. Poslouchám dál…')).toBeVisible()
    await page.getByTestId('sound-stop').click()
    await expect(page.getByTestId('nothing-sure')).toContainText('Tentokrát se mi nepodařilo nic poznat')
    await expect(cards(page)).toHaveCount(0)
  })

  test('stops listening and keeps what it heard when the page goes to the background', async ({ page }) => {
    await openApp(page, '/scan/sound', { delay: 60 })
    await downloadBrain(page)
    await page.getByTestId('sound-start').click()
    await expect(page.getByTestId('guess')).toHaveCount(3)
    await setPageHidden(page, true)
    await expect(page.getByText('Poslech se zastavil')).toBeVisible()
    await expect(page.getByText('Když aplikace zmizí z obrazovky, telefon mi vypne mikrofon.')).toBeVisible()
    await expect(page.getByTestId('sound-stop')).toHaveCount(0)
    await expect(device(page)).toHaveAttribute('data-status', 'idle')
    await setPageHidden(page, false)
    await page.getByRole('button', { name: 'Zobrazit výsledek' }).click()
    await expect(page).toHaveURL(/#\/result$/)
    await expect(cards(page).first().getByTestId('candidate-name')).toHaveText('Sýkora koňadra')
  })

  test('leaving the screen while it listens stops the listening', async ({ page }) => {
    await openApp(page, '/scan/sound', { delay: 60 })
    await downloadBrain(page)
    await page.getByTestId('sound-start').click()
    await expect(page.getByTestId('sound-stop')).toBeVisible()
    await page.getByTestId('nav-dex').click()
    await expect(device(page)).toHaveAttribute('data-status', 'idle')
    await page.getByTestId('nav-scan').click()
    await page.getByTestId('tile-sound').click()
    await expect(page.getByTestId('sound-start')).toBeVisible()
  })
})

// ---------------------------------------------------------------------------------------------------------------------
// Photo
// ---------------------------------------------------------------------------------------------------------------------

test.describe('scan by photo', () => {
  test('a photo from the gallery, an optional crop, "Určit", the result and the catch with the photo saved', async ({ page }, testInfo) => {
    const errors = collectErrors(page)
    await openApp(page, '/scan/photo', { delay: 100 })
    await shot(page, testInfo, 'photo-needed')
    await downloadBrain(page)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Fotka')
    await expect(page.getByText('Vyfotit', { exact: true })).toBeVisible()
    await expect(page.getByText('Vybrat z galerie')).toBeVisible()
    await shot(page, testInfo, 'photo-choose')

    await page.getByTestId('photo-pick').setInputFiles(MALLARD)
    const preview = page.getByTestId('photo-preview')
    await expect(preview).toBeVisible()
    await expect(preview.locator('img')).toHaveAttribute('src', /^blob:/)
    await expect(page.getByTestId('crop-box')).toBeVisible()
    await shot(page, testInfo, 'photo-preview')

    // Drag the box: the right-bottom corner inwards, then the box itself.
    const layer = (await page.getByTestId('crop-layer').boundingBox())!
    await dragCorner(page, 'se', 0.8, 0.8)
    const box = (await page.getByTestId('crop-box').boundingBox())!
    expect(box.width).toBeCloseTo(layer.width * 0.8, -0.5)
    expect(box.height).toBeCloseTo(layer.height * 0.8, -0.5)
    expect(box.x).toBeCloseTo(layer.x, 0)
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2 + layer.width * 0.1, box.y + box.height / 2 + layer.height * 0.1, { steps: 6 })
    await page.mouse.up()
    const moved = (await page.getByTestId('crop-box').boundingBox())!
    expect(moved.x).toBeGreaterThan(box.x + layer.width * 0.05)
    expect(moved.x + moved.width).toBeLessThanOrEqual(layer.x + layer.width + 1)
    await shot(page, testInfo, 'photo-crop')

    // "Celá fotka" takes the crop away again.
    await page.getByRole('button', { name: 'Celá fotka' }).click()
    const full = (await page.getByTestId('crop-box').boundingBox())!
    expect(full.width).toBeCloseTo(layer.width, 0)

    await page.getByTestId('photo-identify').click()
    await expect(page.getByText('Prohlížím fotku…')).toBeVisible()
    await expect(device(page)).toHaveAttribute('data-status', 'busy')
    await expect(page).toHaveURL(/#\/result$/)
    await expect(cards(page)).toHaveCount(3)
    await expect(cards(page).first().getByTestId('candidate-name')).toHaveText('Sýkora koňadra')
    await expect(page.getByTestId('result-image')).toBeVisible()
    await expect(page.getByTestId('result-where')).toHaveText(/50,08° S, 14,43° V/)
    await shot(page, testInfo, 'result-photo')

    await catchFirst(page)
    await shot(page, testInfo, 'catch-success-photo')
    const saved = await readDatabase(page)
    expect(saved.catches).toHaveLength(1)
    expect(saved.catches[0]).toMatchObject({ speciesId: 'parus-major', method: 'photo', placeName: 'Praha' })
    expect(saved.media).toHaveLength(1)
    expect(saved.media[0]).toMatchObject({ kind: 'image', mime: 'image/jpeg' })
    // The fixture is 960x640: it is kept at that size (nothing is scaled up), as a JPEG.
    expect([saved.media[0].width, saved.media[0].height]).toEqual([960, 640])
    expect(saved.media[0].size).toBeGreaterThan(5000)
    expect(errors).toEqual([])
  })

  test('shows a photo that a phone saved turned (EXIF) the right way up, and saves it that way', async ({ page }) => {
    await openApp(page, '/scan/photo', { delay: 30 })
    await downloadBrain(page)
    await page.getByTestId('photo-take').setInputFiles(ROTATED)
    const preview = page.getByTestId('photo-preview')
    await expect(preview).toBeVisible()
    // The file is stored 640x960 with the note "turn it 90 degrees": the bird is shown wide, as it was seen.
    await expect(preview).toHaveAttribute('data-width', '960')
    await expect(preview).toHaveAttribute('data-height', '640')
    await page.getByTestId('photo-identify').click()
    await expect(page).toHaveURL(/#\/result$/)
    await catchFirst(page)
    const saved = await readDatabase(page)
    expect([saved.media[0].width, saved.media[0].height]).toEqual([960, 640])
  })

  test('an old photo from the gallery is saved with its own date and without the place of the phone', async ({ page }) => {
    await openApp(page, '/scan/photo', { delay: 30 })
    await downloadBrain(page)
    // A photo from 2 May 2020 with no GPS: the EXIF block goes right after the start of the JPEG.
    const original = readFileSync(MALLARD)
    const exif = Buffer.from(buildExifSegment({ date: '2020:05:02 08:15:00' }))
    const old = Buffer.concat([original.subarray(0, 2), exif, original.subarray(2)])
    await page.getByTestId('photo-pick').setInputFiles({ name: 'old.jpg', mimeType: 'image/jpeg', buffer: old })
    await expect(page.getByTestId('photo-preview')).toBeVisible()
    await page.getByTestId('photo-identify').click()
    await expect(page).toHaveURL(/#\/result$/)
    await expect(page.getByTestId('result-when')).toContainText('2. 5. 2020')
    await expect(page.getByTestId('result-where')).toHaveText('Místo neznámé')
    await catchFirst(page)
    const saved = await readDatabase(page)
    expect(saved.catches[0].location).toBeUndefined()
    expect(new Date(saved.catches[0].caughtAt).getFullYear()).toBe(2020)
  })

  test('scales a huge photo down before it is identified and saved: at most 1280 pixels, JPEG', async ({ page }) => {
    await openApp(page, '/scan/photo', { delay: 30 })
    await downloadBrain(page)
    await chooseSyntheticPicture(page, 'photo-pick', { width: 8000, height: 6000, kind: 'gradient' })
    const preview = page.getByTestId('photo-preview')
    await expect(preview).toBeVisible({ timeout: 30_000 })
    // The opened picture is kept at most 2048 pixels wide, however big the file was.
    await expect(preview).toHaveAttribute('data-width', '2048')
    await expect(preview).toHaveAttribute('data-height', '1536')
    await page.getByTestId('photo-identify').click()
    await expect(page).toHaveURL(/#\/result$/)
    await catchFirst(page)
    const saved = await readDatabase(page)
    expect(saved.media[0]).toMatchObject({ kind: 'image', mime: 'image/jpeg', width: 1280, height: 960 })
  })

  test('keeps exactly the part of the photo inside the crop box', async ({ page }) => {
    await openApp(page, '/scan/photo', { delay: 30 })
    await downloadBrain(page)
    // Red on the left half, blue on the right half.
    await chooseSyntheticPicture(page, 'photo-pick', { width: 1600, height: 1200, kind: 'halves' })
    await expect(page.getByTestId('photo-preview')).toBeVisible({ timeout: 30_000 })
    // Drag the top-left corner to 60 percent across and 30 percent down: only blue stays, 40 percent wide and 70 percent high.
    await dragCorner(page, 'nw', 0.6, 0.3)
    await page.getByTestId('photo-identify').click()
    await expect(page).toHaveURL(/#\/result$/)
    await catchFirst(page)
    const saved = await readDatabase(page)
    const [red, , blue] = await savedImageColour(page, saved.media[0].id)
    expect(blue).toBeGreaterThan(150)
    expect(red).toBeLessThan(60)
    // And the saved picture has the shape of the box: 40 percent wide, 70 percent high of 1600x1200.
    expect(saved.media[0].width! / saved.media[0].height!).toBeCloseTo((1600 * 0.4) / (1200 * 0.7), 1)
  })

  test('moves the crop box with the arrow keys and resizes it from a corner', async ({ page }) => {
    await openApp(page, '/scan/photo', { delay: 30 })
    await downloadBrain(page)
    await page.getByTestId('photo-pick').setInputFiles(MALLARD)
    await expect(page.getByTestId('photo-preview')).toBeVisible()
    const layer = (await page.getByTestId('crop-layer').boundingBox())!
    await page.getByTestId('crop-se').focus()
    for (let i = 0; i < 10; i++) await page.keyboard.press('ArrowLeft')
    const box = (await page.getByTestId('crop-box').boundingBox())!
    expect(box.width).toBeLessThan(layer.width * 0.85)
    await page.getByTestId('crop-box').focus()
    for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowRight')
    const moved = (await page.getByTestId('crop-box').boundingBox())!
    expect(moved.x).toBeGreaterThan(box.x)
  })

  test('explains a file the browser cannot open (HEIC) and a file that is not a picture, and lets the person try again', async ({ page }) => {
    await openApp(page, '/scan/photo', { delay: 30 })
    await downloadBrain(page)
    await page.getByTestId('photo-pick').setInputFiles({ name: 'IMG_0042.HEIC', mimeType: 'image/heic', buffer: Buffer.from('not really a heic file, just bytes'.repeat(20)) })
    await expect(page.getByText(/Formát HEIC neumím přečíst/)).toBeVisible()
    await page.getByTestId('photo-pick').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') })
    await expect(page.getByText('Tohle není obrázek. Vyber prosím fotku.')).toBeVisible()
    await page.getByTestId('photo-pick').setInputFiles({ name: 'broken.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('this is not a jpeg') })
    await expect(page.getByText(/Fotku se nepodařilo otevřít/)).toBeVisible()
    // The two buttons are still there, and a good photo works afterwards.
    await page.getByTestId('photo-pick').setInputFiles(MALLARD)
    await expect(page.getByTestId('photo-preview')).toBeVisible()
    await expect(page.getByText('Tohle není obrázek')).toHaveCount(0)
    // With a picture on the screen a bad file leaves the picture alone, and the message is next to the button that was pressed.
    await page.getByTestId('photo-other').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') })
    const note = page.getByText('Tohle není obrázek. Vyber prosím fotku.')
    await expect(note).toBeVisible()
    await expect(page.getByTestId('photo-preview')).toBeVisible()
    const other = (await page.getByTestId('photo-other').locator('xpath=ancestor::label').boundingBox())!
    expect((await note.boundingBox())!.y, 'the message is below the button').toBeGreaterThan(other.y)
  })

  test('says calmly when the picture cannot be identified, shows it above the key, and works at the next try', async ({ page }) => {
    await openApp(page, '/scan/photo', { delay: 30 })
    await downloadBrain(page)
    await page.getByTestId('photo-pick').setInputFiles(MALLARD)
    await expect(page.getByTestId('photo-preview')).toBeVisible()
    // From here on the browser cannot make a JPEG, so the picture cannot be saved with the guesses: identifying fails.
    await page.evaluate(() => {
      const window_ = window as unknown as { __toBlob?: HTMLCanvasElement['toBlob'] }
      window_.__toBlob = HTMLCanvasElement.prototype.toBlob
      HTMLCanvasElement.prototype.toBlob = (callback: BlobCallback) => callback(null)
    })
    await page.getByTestId('photo-identify').click()
    const notice = page.getByRole('alert')
    await expect(notice).toContainText('Něco se nepovedlo')
    // The key is in a bar over the bottom of the screen: the message must not hide behind it.
    await expect.poll(async () => {
      const box = (await notice.boundingBox())!
      const key = (await page.getByTestId('photo-identify').boundingBox())!
      return box.y + box.height <= key.y + 1
    }).toBe(true)
    await page.evaluate(() => {
      HTMLCanvasElement.prototype.toBlob = (window as unknown as { __toBlob: HTMLCanvasElement['toBlob'] }).__toBlob
    })
    await page.getByTestId('photo-identify').click()
    await expect(page).toHaveURL(/#\/result$/)
  })

  test('has the file inputs the phones need: camera with capture=environment, gallery without', async ({ page }) => {
    await openApp(page, '/scan/photo')
    const take = page.getByTestId('photo-take')
    const pick = page.getByTestId('photo-pick')
    await expect(take).toHaveAttribute('accept', 'image/*')
    await expect(take).toHaveAttribute('capture', 'environment')
    await expect(pick).toHaveAttribute('accept', 'image/*')
    await expect(pick).not.toHaveAttribute('capture', /.*/)
  })

  test('two guesses close together do not hold back the Catch button: the percentage decides, and the person chooses', async ({ page }) => {
    await openApp(page, '/scan/photo', { scenario: 'unclear', delay: 30 })
    await downloadBrain(page)
    await page.getByTestId('photo-pick').setInputFiles(MALLARD)
    await page.getByTestId('photo-identify').click()
    await expect(page).toHaveURL(/#\/result$/)
    await expect(cards(page)).toHaveCount(3)
    await expect(cards(page).nth(0).getByRole('button', { name: 'Chytit' })).toBeEnabled()
    await expect(cards(page).nth(1).getByRole('button', { name: 'Chytit' })).toBeEnabled()
    // The top guess is above the percentage, so there is no "nothing sure" message.
    await expect(page.getByTestId('nothing-sure')).toHaveCount(0)
  })

  test('the strict setting needs more certainty than the normal one', async ({ page }) => {
    await openApp(page, '/scan/photo', { scenario: 'clear', delay: 30, storage: { 'birddex:settings': JSON.stringify({ sensitivity: 'strict', soundEffects: true }) } })
    await downloadBrain(page)
    await page.getByTestId('photo-pick').setInputFiles(MALLARD)
    await page.getByTestId('photo-identify').click()
    await expect(page).toHaveURL(/#\/result$/)
    // 0.88 with a clear lead passes even strict (0.75 and a lead of 0.25) ...
    await expect(cards(page).first().getByRole('button', { name: 'Chytit' })).toBeEnabled()
    // ... and the bar shows where the line is.
    await expect(cards(page).first().getByRole('meter')).toBeVisible()
  })
})

// ---------------------------------------------------------------------------------------------------------------------
// Live camera
// ---------------------------------------------------------------------------------------------------------------------

test.describe('scan with the live camera', () => {
  test('shows the camera, locks on a bird, and Catch goes to the result and the Dex with the snapshot', async ({ page }, testInfo) => {
    const errors = collectErrors(page)
    await openApp(page, '/scan/live', { delay: 250 })
    await downloadBrain(page)
    await expect(page.getByTestId('live-catch')).toHaveCount(0)
    await shot(page, testInfo, 'live-idle')

    await page.getByTestId('live-start').click()
    await expect(page.getByTestId('reticle')).toBeVisible()
    await expect(page.getByTestId('live-catch')).toBeDisabled()
    await expect(page.getByText('Tlačítko se odemkne, až ptáka zaměřím.')).toBeVisible()
    await expect(device(page)).toHaveAttribute('data-status', 'busy')
    await shot(page, testInfo, 'live-searching')

    await expect(page.getByTestId('live-view')).toHaveAttribute('data-locked', 'true', { timeout: 20_000 })
    await expect(page.getByTestId('live-status')).toHaveText('Mám ho na mušce!')
    await expect(page.getByTestId('live-guess')).toContainText('Sýkora koňadra')
    await expect(page.getByTestId('live-catch')).toBeEnabled()
    await shot(page, testInfo, 'live-locked')

    await page.getByTestId('live-catch').click()
    await expect(page).toHaveURL(/#\/result$/)
    await expect(cards(page).first().getByTestId('candidate-name')).toHaveText('Sýkora koňadra')
    await expect(page.getByTestId('result-image')).toBeVisible()
    await shot(page, testInfo, 'result-live')
    await catchFirst(page)

    const saved = await readDatabase(page)
    expect(saved.catches[0]).toMatchObject({ speciesId: 'parus-major', method: 'live', placeName: 'Praha' })
    expect(saved.media[0]).toMatchObject({ kind: 'image', mime: 'image/jpeg' })
    expect(saved.media[0].width).toBeGreaterThan(100)
    await page.getByTestId('nav-dex').click()
    await expect(page.locator('[data-testid="species-card"][data-species-id="parus-major"]')).toHaveAttribute('data-caught', 'true')
    expect(errors).toEqual([])
  })

  test('never locks on a shaky, unsure view, so the Catch button stays off', async ({ page }) => {
    await openApp(page, '/scan/live', { scenario: 'low', delay: 120 })
    await downloadBrain(page)
    await page.getByTestId('live-start').click()
    await expect(page.getByTestId('live-guess')).toBeVisible({ timeout: 15_000 })
    await page.waitForTimeout(1500)
    await expect(page.getByTestId('live-view')).not.toHaveAttribute('data-locked', 'true')
    await expect(page.getByTestId('live-view')).not.toHaveAttribute('data-locked', 'true')
  })

  test('catches by itself as soon as the bird is sure enough: no tap, the catch is saved and the Dex has it', async ({ page }) => {
    await openApp(page, '/scan/live', { delay: 250, storage: { 'birddex:settings': JSON.stringify({ autoCatch: true }) } })
    await downloadBrain(page)
    await page.getByTestId('live-start').click()
    // Nobody presses Catch: the screen goes to the result, saves it, and celebrates.
    await expect(page.getByTestId('catch-message')).toContainText('Sýkora koňadra', { timeout: 30_000 })
    await expect(page.getByRole('alertdialog')).toHaveCount(0)
    await page.getByTestId('to-dex').click()
    await expect(page).toHaveURL(/#\/species\/parus-major/)
    await expect(page.getByTestId('status-caught')).toBeVisible()
    await expect(page.getByTestId('catch-item')).toHaveAttribute('data-method', 'live')
  })

  test('switches the camera off when the person leaves the screen', async ({ page }) => {
    await page.addInitScript(() => {
      const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
      const opened: MediaStream[] = []
      ;(window as unknown as { __streams: MediaStream[] }).__streams = opened
      navigator.mediaDevices.getUserMedia = async (constraints) => {
        const stream = await original(constraints)
        opened.push(stream)
        return stream
      }
    })
    await openApp(page, '/scan/live', { delay: 60 })
    await downloadBrain(page)
    await page.getByTestId('live-start').click()
    // The reticle shows while the camera is still opening; the camera is on when the pictures arrive.
    await expect(page.getByTestId('live-view')).toHaveAttribute('data-phase', 'running')
    const live = () => page.evaluate(() => (window as unknown as { __streams: MediaStream[] }).__streams.flatMap((s) => s.getTracks()).filter((track) => track.readyState === 'live').length)
    expect(await live()).toBeGreaterThan(0)
    // The camera covers the whole phone, so the navigation bar is not there to tap: leaving works as the Back button does it.
    await page.evaluate(() => {
      window.location.hash = '/'
    })
    await expect(page.getByTestId('nav-dex')).toBeVisible()
    await expect.poll(live).toBe(0)
  })

  test('switches the camera off when the page goes to the background', async ({ page }) => {
    await openApp(page, '/scan/live', { delay: 60 })
    await downloadBrain(page)
    await page.getByTestId('live-start').click()
    // Only a camera that is on is switched off: a page that is hidden while the camera question is open does not count.
    await expect(page.getByTestId('live-view')).toHaveAttribute('data-phase', 'running')
    await setPageHidden(page, true)
    await expect(page.getByText('Kamera se vypnula, když aplikace zmizela z obrazovky. Zapni ji znovu.')).toBeVisible()
    await setPageHidden(page, false)
    await page.getByTestId('live-start').click()
    await expect(page.getByTestId('reticle')).toBeVisible()
  })

  test('says so after six seconds without a picture, and offers the photo screen', async ({ page }) => {
    // A camera that opens but never sends a picture: a stream without any track.
    await page.addInitScript(() => {
      navigator.mediaDevices.getUserMedia = async () => new MediaStream()
    })
    await openApp(page, '/scan/live', { delay: 60 })
    await downloadBrain(page)
    await page.getByTestId('live-start').click()
    await expect(page.getByTestId('reticle')).toBeVisible()
    await expect(page.getByText('Kamera nic neukazuje')).toHaveCount(0)
    const notice = page.getByRole('status').filter({ hasText: 'Kamera nic neukazuje' })
    await expect(notice).toBeVisible({ timeout: 12_000 })
    await expect(notice).toContainText('Z kamery nepřichází obraz')
    await expect(page.getByTestId('reticle')).toHaveCount(0)
    await notice.getByRole('link', { name: 'Místo toho vyfotit' }).click()
    await expect(page).toHaveURL(/#\/scan\/photo$/)
  })
})

// ---------------------------------------------------------------------------------------------------------------------
// Permissions: a browser that has not been allowed anything
// ---------------------------------------------------------------------------------------------------------------------

test.describe('when the microphone or the camera is not allowed', () => {
  let browser: Browser

  test.beforeAll(async () => {
    // No --use-fake-ui-for-media-stream: nobody says yes, so the browser says no.
    browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--use-fake-device-for-media-stream'] })
  })

  test.afterAll(async () => {
    await browser?.close()
  })

  test('the camera screen explains it in Czech, with the steps for iPhone and Android, and offers the photo screen', async ({}, testInfo) => {
    const context = await browser.newContext({ baseURL: testInfo.project.use.baseURL, serviceWorkers: 'block', viewport: { width: 390, height: 844 }, permissions: [] })
    try {
      const page = await context.newPage()
      await openApp(page, '/scan/live', { delay: 30 })
      await downloadBrain(page)
      await page.getByTestId('live-start').click()
      const alert = page.getByRole('alert')
      await expect(alert).toContainText('Chybí povolení ke kameře', { timeout: 15_000 })
      await expect(alert).toContainText('Povol ji v nastavení prohlížeče nebo telefonu')
      await expect(alert).toContainText('iPhone:')
      await expect(alert).toContainText('Android:')
      await expect(alert.getByRole('button', { name: 'Zkusit znovu' })).toBeVisible()
      await shot(page, testInfo, 'live-denied')
      await alert.getByRole('link', { name: 'Místo toho vyfotit' }).click()
      await expect(page).toHaveURL(/#\/scan\/photo$/)
    } finally {
      await context.close()
    }
  })

  test('the sound screen explains it in Czech when the real microphone is refused', async ({}, testInfo) => {
    test.skip(!modelsPresent(), 'the model files are not in public/models (run: npm run fetch-models)')
    test.setTimeout(180_000)
    const context = await browser.newContext({ baseURL: testInfo.project.use.baseURL, serviceWorkers: 'block', viewport: { width: 390, height: 844 }, permissions: [] })
    try {
      const page = await context.newPage()
      // The real engines: the microphone is opened by the real capture code, which is what the person's phone runs.
      await openApp(page, '/scan/sound', { engines: 'real' })
      await downloadBrain(page)
      await expect(page.getByTestId('sound-start')).toBeEnabled({ timeout: 60_000 })
      await page.getByTestId('sound-start').click()
      const alert = page.getByRole('alert')
      await expect(alert).toContainText('Chybí povolení k mikrofonu', { timeout: 30_000 })
      await expect(alert).toContainText('iPhone:')
      await expect(alert).toContainText('Android:')
      await shot(page, testInfo, 'sound-denied')
      await expect(alert.getByRole('button', { name: 'Zkusit znovu' })).toBeVisible()
    } finally {
      await context.close()
    }
  })
})

// ---------------------------------------------------------------------------------------------------------------------
// The result screen on its own, and layout
// ---------------------------------------------------------------------------------------------------------------------

test.describe('the result screen', () => {
  test('goes back to the hub when there is nothing to decide about (reloaded page)', async ({ page }) => {
    await openApp(page, '/scan/sound', { delay: 60 })
    await downloadBrain(page)
    await page.getByTestId('sound-start').click()
    await expect(page.getByTestId('guess')).toHaveCount(3)
    await page.getByTestId('sound-stop').click()
    await expect(page).toHaveURL(/#\/result$/)
    await page.reload()
    await expect(page).toHaveURL(/#\/scan$/)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Skenovat')
  })

  test('"Zahodit" drops the result without saving anything', async ({ page }) => {
    await openApp(page, '/scan/sound', { delay: 60 })
    await downloadBrain(page)
    await page.getByTestId('sound-start').click()
    await expect(page.getByTestId('guess')).toHaveCount(3)
    await page.getByTestId('sound-stop').click()
    await page.getByTestId('discard').click()
    await expect(page).toHaveURL(/#\/scan$/)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Skenovat')
    await page.goBack()
    // The result is gone: going back to it sends the person to the hub again.
    await expect(page).toHaveURL(/#\/scan$/)
    expect((await readDatabase(page).catch(() => ({ catches: [] }))).catches).toHaveLength(0)
  })

  test('catching the same bird twice counts it as one species and says so the second time', async ({ page }) => {
    await openApp(page, '/scan/sound', { delay: 60 })
    await downloadBrain(page)
    for (const round of [1, 2]) {
      if (round === 2) await page.getByTestId('scan-next').click()
      if (round === 2) await page.getByTestId('tile-sound').click()
      await page.getByTestId('sound-start').click()
      await expect(page.getByTestId('guess-percent').first()).toHaveText(/^9\d\s%$/, { timeout: 5000 })
      await page.getByTestId('sound-stop').click()
      if (round === 2) await expect(cards(page).first()).toContainText('Už v Dexu')
      await catchFirst(page)
      if (round === 2) await expect(page.getByTestId('catch-success')).toContainText('Další úlovek tohoto druhu.')
    }
    const saved = await readDatabase(page)
    expect(saved.catches).toHaveLength(2)
    expect(new Set(saved.catches.map((c) => c.speciesId)).size).toBe(1)
  })

  test('shows the photo credit of the reference picture on a card', async ({ page }) => {
    await openApp(page, '/scan/sound', { delay: 60 })
    await downloadBrain(page)
    await page.getByTestId('sound-start').click()
    await expect(page.getByTestId('guess')).toHaveCount(3)
    await page.getByTestId('sound-stop').click()
    const first = cards(page).first()
    await expect(first.locator('.bd-result-card__credit')).toContainText('Jana Fotografka')
    await expect(first.locator('.bd-result-card__credit')).toContainText('CC BY-SA 4.0')
    await expect(first.locator('.bd-result-photo img')).toBeVisible()
  })
})

test.describe('layout on small phones', () => {
  for (const { width, height } of PHONES) {
    test(`no sideways scrolling and touch targets of 44 px at ${width}x${height}, on every scan screen and state`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height })
      await openApp(page, '/scan', { delay: 40 })
      const check = async (label: string) => {
        expect(await horizontalOverflow(page), `${label}: sideways overflow`).toBe(0)
        expect(await smallTouchTargets(page), `${label}: small targets`).toEqual([])
        expect(await overflowingText(page), `${label}: text that sticks out of its box`).toEqual([])
      }
      await check('hub, bird brain needed')
      await shot(page, testInfo, `hub-${width}`)
      await page.getByTestId('model-download').click()
      await expect(page.getByTestId('model-ready')).toBeVisible({ timeout: 20_000 })
      await check('hub, ready')

      await page.getByTestId('tile-sound').click()
      await expect(page.getByTestId('sound-start')).toBeEnabled()
      await check('sound, idle')
      await shot(page, testInfo, `sound-idle-${width}`)
      await page.getByTestId('sound-start').click()
      await expect(page.getByTestId('guess')).toHaveCount(3)
      await check('sound, listening')
      // The three guesses and the key fit on one screen (the person looks at them while holding the phone towards a bird).
      const lastGuess = (await page.getByTestId('guess').last().boundingBox())!
      const key = (await page.getByTestId('sound-stop').boundingBox())!
      expect(lastGuess.y + lastGuess.height, 'the last guess ends above the key').toBeLessThanOrEqual(key.y + 1)
      await shot(page, testInfo, `sound-listening-${width}`)
      await page.getByTestId('sound-stop').click()
      await expect(cards(page)).toHaveCount(3)
      await check('result, sound')
      await shot(page, testInfo, `result-${width}`)
      await page.getByTestId('screen').evaluate((element) => element.scrollTo(0, element.scrollHeight))
      await check('result, scrolled down')
      await shot(page, testInfo, `result-bottom-${width}`)
      await catchFirst(page)
      await check('success')
      await shot(page, testInfo, `success-${width}`)

      await page.getByTestId('scan-next').click()
      await page.getByTestId('tile-photo').click()
      await check('photo, choose')
      await shot(page, testInfo, `photo-choose-${width}`)
      await page.getByTestId('photo-pick').setInputFiles(MALLARD)
      await expect(page.getByTestId('photo-preview')).toBeVisible()
      await check('photo, preview')
      // The main button is always in reach, however tall the picture is.
      const identify = (await page.getByTestId('photo-identify').boundingBox())!
      const lcd = (await page.getByTestId('screen').boundingBox())!
      expect(identify.y + identify.height, 'Určit is inside the visible screen').toBeLessThanOrEqual(lcd.y + lcd.height + 1)
      await shot(page, testInfo, `photo-preview-${width}`)
      await page.getByRole('link', { name: 'Zpět' }).click()

      await page.getByTestId('tile-live').click()
      await check('live, idle')
      await page.getByTestId('live-start').click()
      await expect(page.getByTestId('live-view')).toHaveAttribute('data-locked', 'true', { timeout: 20_000 })
      await check('live, locked')
      await shot(page, testInfo, `live-locked-${width}`)
    })
  }

  test('the screens work in landscape on a small phone too (no sideways scrolling)', async ({ page }) => {
    await page.setViewportSize({ width: 844, height: 390 })
    await openApp(page, '/scan', { delay: 30 })
    for (const path of ['/scan', '/scan/sound', '/scan/photo', '/scan/live']) {
      await page.goto(`/#${path}`)
      await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible()
      expect(await horizontalOverflow(page), path).toBe(0)
    }
  })
})

// ---------------------------------------------------------------------------------------------------------------------
// The real engines on the real screens (they need the model files)
// ---------------------------------------------------------------------------------------------------------------------

function modelsPresent(): boolean {
  return existsSync(join(ROOT, 'public', 'models', 'manifest.json'))
}

test.describe('the real engines behind the real screens', () => {
  test.skip(!modelsPresent(), 'the model files are not in public/models (run: npm run fetch-models)')
  test.describe.configure({ mode: 'serial' })
  test.setTimeout(240_000)

  test('the hub downloads the real bird brain with progress and then everything works offline-ready', async ({ page }, testInfo) => {
    const errors = collectErrors(page)
    await openApp(page, '/scan', { engines: 'real' })
    await expect(page.getByTestId('model-download')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByTestId('model-banner')).toContainText('asi 90 MB')
    await page.getByTestId('model-download').click()
    await expect(page.getByRole('progressbar', { name: 'Stahování ptačího mozku' })).toBeVisible()
    await expect(page.getByTestId('model-ready')).toBeVisible({ timeout: 120_000 })
    await shot(page, testInfo, 'real-hub-ready')
    // The next visit finds everything on the phone.
    await page.reload()
    await expect(page.getByTestId('model-ready')).toBeVisible({ timeout: 20_000 })
    await page.getByTestId('tile-sound').click()
    await expect(page.getByTestId('sound-start')).toBeEnabled({ timeout: 60_000 })
    expect(errors.filter((message) => !/WebGPU|Failed to create default/.test(message))).toEqual([])
  })

  test('a real photo of a Mallard is identified through the photo screen and caught', async ({ page }, testInfo) => {
    await openApp(page, '/scan/photo', { engines: 'real' })
    await page.getByTestId('model-download').click({ timeout: 20_000 })
    await page.getByTestId('photo-pick').setInputFiles(MALLARD)
    await expect(page.getByTestId('photo-identify')).toBeEnabled({ timeout: 120_000 })
    await page.getByTestId('photo-identify').click()
    await expect(page).toHaveURL(/#\/result$/, { timeout: 60_000 })
    await expect(cards(page).first().getByTestId('candidate-name')).toHaveText('Kachna divoká')
    await expect(cards(page).first().getByRole('button', { name: 'Chytit' })).toBeEnabled()
    await shot(page, testInfo, 'real-result-photo')
    await catchFirst(page)
    const saved = await readDatabase(page)
    expect(saved.catches[0]).toMatchObject({ speciesId: 'anas-platyrhynchos', method: 'photo' })
  })
})

test.describe('the real sound engine with a recorded bird as the microphone', () => {
  test.skip(!modelsPresent(), 'the model files are not in public/models (run: npm run fetch-models)')
  test.setTimeout(240_000)
  let browser: Browser

  test.beforeAll(async () => {
    browser = await chromium.launch({
      executablePath: process.env.CHROMIUM_PATH || undefined,
      args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${join(ROOT, 'tests', 'fixtures', 'audio', 'birdnet-demo-sample.wav')}`],
    })
  })

  test.afterAll(async () => {
    await browser?.close()
  })

  test('hears the Lesser Redpoll, shows it live, and the catch saves the clip', async ({}, testInfo) => {
    const context = await browser.newContext({ baseURL: testInfo.project.use.baseURL, serviceWorkers: 'block', viewport: { width: 390, height: 844 }, permissions: ['microphone', 'geolocation'], geolocation: { latitude: 50.08, longitude: 14.43 } })
    try {
      const page = await context.newPage()
      const errors = collectErrors(page)
      await openApp(page, '/scan/sound', { engines: 'real', storage: { 'birddex:settings': JSON.stringify({ sensitivity: 'easy', soundEffects: true }) } })
      await page.getByTestId('model-download').click({ timeout: 20_000 })
      await expect(page.getByTestId('sound-start')).toBeEnabled({ timeout: 120_000 })
      await page.getByTestId('sound-start').click()
      await expect(page.getByTestId('sound-stop')).toBeVisible({ timeout: 30_000 })
      await expect(page.getByTestId('guess').first()).toBeVisible({ timeout: 40_000 })
      await expect(page.getByTestId('hearing-bird')).toHaveAttribute('data-on', 'true', { timeout: 30_000 })
      await shot(page, testInfo, 'real-sound-listening')
      await page.getByTestId('sound-stop').click()
      await expect(page).toHaveURL(/#\/result$/, { timeout: 30_000 })
      await expect(cards(page).first()).toBeVisible()
      await shot(page, testInfo, 'real-result-sound')
      const firstName = await cards(page).first().getByTestId('candidate-name').textContent()
      // BirdNET hears redpolls: the Lesser Redpoll (Čečetka malá) or its twin the Common Redpoll (Čečetka zimní).
      expect(firstName).toMatch(/Čečetka/)
      await expect(page.getByTestId('result-audio')).toBeVisible()
      await catchFirst(page)
      const saved = await readDatabase(page)
      expect(saved.media[0]).toMatchObject({ kind: 'audio', mime: 'audio/wav' })
      expect(saved.media[0].durationS).toBeGreaterThan(2)
      expect(errors.filter((message) => !/WebGPU|Failed to create default/.test(message))).toEqual([])
    } finally {
      await context.close()
    }
  })
})

test.describe('the real live scanner with a photo as the camera picture', () => {
  test.skip(!modelsPresent(), 'the model files are not in public/models (run: npm run fetch-models)')
  test.setTimeout(240_000)
  let browser: Browser

  test.beforeAll(async () => {
    const folder = join(ROOT, 'test-results', `scan-${process.env.E2E_PORT ?? 'x'}`)
    mkdirSync(folder, { recursive: true })
    // One JPEG is a valid motion JPEG file with one frame: Chromium plays it in a loop as the camera picture.
    const camera = join(folder, 'mallard.mjpeg')
    copyFileSync(MALLARD, camera)
    browser = await chromium.launch({
      executablePath: process.env.CHROMIUM_PATH || undefined,
      args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${camera}`],
    })
  })

  test.afterAll(async () => {
    await browser?.close()
  })

  test('locks on the Mallard and catches it', async ({}, testInfo) => {
    const context = await browser.newContext({ baseURL: testInfo.project.use.baseURL, serviceWorkers: 'block', viewport: { width: 390, height: 844 }, permissions: ['camera', 'geolocation'], geolocation: { latitude: 50.08, longitude: 14.43 } })
    try {
      const page = await context.newPage()
      await openApp(page, '/scan/live', { engines: 'real' })
      await page.getByTestId('model-download').click({ timeout: 20_000 })
      await expect(page.getByTestId('live-start')).toBeEnabled({ timeout: 120_000 })
      await page.getByTestId('live-start').click()
      await expect(page.getByTestId('live-view')).toHaveAttribute('data-locked', 'true', { timeout: 60_000 })
      await expect(page.getByTestId('live-guess')).toContainText('Kachna divoká')
      await shot(page, testInfo, 'real-live-locked')
      await page.getByTestId('live-catch').click()
      await expect(page).toHaveURL(/#\/result$/)
      await expect(cards(page).first().getByTestId('candidate-name')).toHaveText('Kachna divoká')
      await catchFirst(page)
      const saved = await readDatabase(page)
      expect(saved.catches[0]).toMatchObject({ speciesId: 'anas-platyrhynchos', method: 'live' })
      expect(saved.media[0]).toMatchObject({ kind: 'image', mime: 'image/jpeg' })
    } finally {
      await context.close()
    }
  })
})
