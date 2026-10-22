import { expect, test, type Page } from '@playwright/test'
import { mockWikimedia, seedDemo } from './dex-helpers'
import { collectErrors, skipWelcome } from './shell-helpers'

// The Ptáci screens in a real browser, filled with the hidden demo data (30 catches of 24 species): the list of every caught
// bird with its BP, three in a row; the page of one bird with its BP bar, its five scores, the recording or the photo, and delete.
// Screenshots of the phone sizes go to test-results/birds-shots-<port>/.

test.use({ serviceWorkers: 'block', viewport: { width: 390, height: 844 } })

const port = process.env.E2E_PORT ?? '4173'
const SHOTS = `test-results/birds-shots-${port}`
const DEMO_CATCHES = 30

const cards = (page: Page) => page.getByTestId('bird-card')
// A card without a BP yet has no `data-bp`, which counts as NaN here.
const bpOf = async (page: Page) => (await cards(page).evaluateAll((items) => items.map((item) => (item.getAttribute('data-bp') === null ? Number.NaN : Number(item.getAttribute('data-bp')))))) as number[]
const idsOf = async (page: Page) => (await cards(page).evaluateAll((items) => items.map((item) => item.getAttribute('data-catch-id')))) as string[]

test.beforeEach(async ({ page }) => {
  await skipWelcome(page)
  await mockWikimedia(page)
  await seedDemo(page)
})

async function openList(page: Page, search = '') {
  await page.goto(`/#/birds${search}`)
  await expect(page.getByTestId('birds-grid')).toBeVisible()
  // The demo catches get their BP when the screen opens (they were made without one).
  await expect.poll(async () => (await bpOf(page)).every((bp) => Number.isFinite(bp)), { timeout: 15_000 }).toBe(true)
}

test.describe('the bottom bar and the gear', () => {
  test('has Ptáci on the left, Skenovat in the middle and Dex on the right, and the settings behind a gear', async ({ page }) => {
    await page.goto('/#/')
    const links = page.getByRole('navigation', { name: 'Hlavní nabídka' }).getByRole('link')
    await expect(links).toHaveText(['Ptáci', 'Skenovat', 'Dex'])
    await expect(page.getByTestId('nav-dex')).toHaveAttribute('aria-current', 'page')
    await page.getByTestId('nav-birds').click()
    await expect(page).toHaveURL(/#\/birds$/)
    await expect(page.getByTestId('nav-birds')).toHaveAttribute('aria-current', 'page')
    await page.getByTestId('nav-settings').click()
    await expect(page).toHaveURL(/#\/settings$/)
    await expect(page.getByTestId('nav-settings')).toHaveAttribute('aria-current', 'page')
    await expect(page.getByRole('heading', { level: 1, name: 'Nastavení' })).toBeVisible()
    await page.screenshot({ path: `${SHOTS}/settings-gear-390.png` })
  })

  test('has the trainer card in the Dex, folded, and not in the settings any more', async ({ page }) => {
    await page.goto('/#/')
    const toggle = page.getByTestId('trainer-toggle')
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await expect(page.getByTestId('trainer-card')).toHaveCount(0)
    await toggle.click()
    await expect(page.getByTestId('trainer-card')).toBeVisible()
    await expect(page.getByTestId('stat-species')).toHaveText('24')
    await page.screenshot({ path: `${SHOTS}/dex-trainer-390.png` })
    await page.goto('/#/settings')
    await expect(page.getByRole('heading', { level: 1, name: 'Nastavení' })).toBeVisible()
    await expect(page.getByTestId('trainer-card')).toHaveCount(0)
  })
})

test.describe('the list', () => {
  test('shows every caught bird as a card with its BP, three in a row, the strongest first', async ({ page }) => {
    const errors = collectErrors(page)
    await openList(page)
    await expect(cards(page)).toHaveCount(DEMO_CATCHES)
    await expect(page.getByTestId('birds-shown')).toHaveText('30 ptáků')

    const bp = await bpOf(page)
    expect(bp.every((value) => value > 0)).toBe(true)
    expect(bp).toEqual([...bp].sort((a, b) => b - a))

    // Three in a row: the first three cards share a row, the fourth starts the next one.
    const boxes = await Promise.all([0, 1, 2, 3].map((index) => cards(page).nth(index).boundingBox()))
    expect(Math.abs(boxes[0]!.y - boxes[1]!.y)).toBeLessThan(2)
    expect(Math.abs(boxes[1]!.y - boxes[2]!.y)).toBeLessThan(2)
    expect(boxes[3]!.y).toBeGreaterThan(boxes[0]!.y + boxes[0]!.height - 2)
    expect(boxes[0]!.x).toBeLessThan(boxes[1]!.x)
    expect(boxes[1]!.x).toBeLessThan(boxes[2]!.x)
    expect(Math.abs(boxes[0]!.width - boxes[2]!.width)).toBeLessThan(2)
    // The cards fit the screen: nothing sticks out to the right.
    const grid = await page.getByTestId('birds-grid').boundingBox()
    const lcd = await page.getByTestId('screen').boundingBox()
    expect(boxes[2]!.x + boxes[2]!.width).toBeLessThanOrEqual(lcd!.x + lcd!.width + 1)
    expect(grid!.width).toBeGreaterThan(250)
    await page.waitForTimeout(400)
    await page.screenshot({ path: `${SHOTS}/birds-list-390.png` })
    expect(errors).toEqual([])
  })

  test('fits a small phone too, three in a row', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 })
    await openList(page)
    const boxes = await Promise.all([0, 1, 2].map((index) => cards(page).nth(index).boundingBox()))
    expect(Math.abs(boxes[0]!.y - boxes[2]!.y)).toBeLessThan(2)
    expect(boxes[0]!.width).toBeGreaterThan(80)
    await page.screenshot({ path: `${SHOTS}/birds-list-360.png` })
    await page.setViewportSize({ width: 320, height: 640 })
    await expect(cards(page).first()).toBeVisible()
    await page.screenshot({ path: `${SHOTS}/birds-list-320.png` })
  })

  test('sorts by BP, newest, name and rarity, writes it into the address, and searches by name', async ({ page }) => {
    await openList(page)
    const byBp = await idsOf(page)
    const sort = page.getByTestId('birds-sort')
    await sort.selectOption('newest')
    await expect(page).toHaveURL(/#\/birds\?sort=newest$/)
    await expect.poll(() => idsOf(page)).not.toEqual(byBp)
    await sort.selectOption('name')
    await expect(page).toHaveURL(/#\/birds\?sort=name$/)
    await sort.selectOption('rarity')
    await expect(page).toHaveURL(/#\/birds\?sort=rarity$/)
    await sort.selectOption('bp')
    await expect(page).toHaveURL(/#\/birds$/)

    await page.getByRole('searchbox', { name: 'Hledat mezi ptáky' }).fill('sýkora koňadra')
    await expect(cards(page)).toHaveCount(3)
    await expect(page).toHaveURL(/q=/)
    await page.getByRole('searchbox', { name: 'Hledat mezi ptáky' }).fill('nic takového neexistuje')
    await expect(page.getByText('Nic takového nemám')).toBeVisible()
  })

  test('opens from the page of a species with only the birds of that species', async ({ page }) => {
    await page.goto('/#/species/parus-major')
    await page.getByTestId('species-birds').click()
    await expect(page).toHaveURL(/#\/birds\?species=parus-major$/)
    await expect(cards(page)).toHaveCount(3)
    await expect(page.getByTestId('birds-species-filter')).toContainText('Sýkora koňadra')
    // Two of the three are recordings (a speaker badge), one is a photo.
    await expect(cards(page).locator('.bd-bcard__badge')).toHaveCount(2)
    await page.getByTestId('birds-species-filter').getByRole('button', { name: 'Zobrazit všechny' }).click()
    await expect(cards(page)).toHaveCount(DEMO_CATCHES)
  })
})

test.describe('the page of one bird', () => {
  test('shows the BP with its bar, the five scores, when, where and how, and the demo tag', async ({ page }) => {
    const errors = collectErrors(page)
    await openList(page)
    await cards(page).first().getByRole('link').click()
    await expect(page).toHaveURL(/#\/birds\/.+/)
    const bp = Number(await page.getByTestId('bp-value').innerText())
    expect(bp).toBeGreaterThan(0)
    const bar = page.getByTestId('bp-bar')
    await expect(bar).toHaveAttribute('aria-valuenow', String(bp))
    expect(Number(await bar.getAttribute('aria-valuemax'))).toBeGreaterThanOrEqual(bp)
    expect(Number(await bar.getAttribute('aria-valuemin'))).toBeLessThanOrEqual(bp)
    await expect(page.getByTestId('bp-detail')).toHaveText(/^Základ \d+, štěstí [+−]\d+$/)
    for (const key of ['confidence', 'clarity', 'season', 'timeOfDay', 'way']) await expect(page.getByTestId(`factor-${key}`)).toBeVisible()
    await expect(page.getByTestId('bird-legacy')).toBeVisible()
    await expect(page.getByTestId('bird-when').locator('time')).toHaveText(/^\d{1,2}\. \d{1,2}\. 2026 \d{1,2}:\d{2}$/)
    await expect(page.getByTestId('bird-way')).toContainText('%')
    await expect(page.getByTestId('bird-main').getByText('UKÁZKA')).toBeVisible()
    await expect(page.getByTestId('bird-species')).toBeVisible()
    await page.waitForTimeout(400)
    await page.screenshot({ path: `${SHOTS}/bird-390.png`, fullPage: false })
    await page.getByTestId('screen').evaluate((element) => element.scrollTo(0, element.scrollHeight))
    await page.screenshot({ path: `${SHOTS}/bird-bottom-390.png` })
    expect(errors).toEqual([])
  })

  test('shows rounded coordinates with a map link when the bird has no place name, and says so when it has no place', async ({ page }) => {
    await openList(page, '?species=sitta-europaea')
    await cards(page).first().getByRole('link').click()
    await expect(page.getByTestId('bird-where')).toContainText(/\d{2},\d{2}° s\. š\., \d{1,2},\d{2}° v\. d\./)
    await expect(page.getByTestId('bird-where').getByRole('link', { name: 'Otevřít v mapě' })).toHaveAttribute('href', /openstreetmap\.org\/\?mlat=[\d.]+&mlon=[\d.]+/)
    await openList(page, '?species=grus-grus')
    await cards(page).first().getByRole('link').click()
    await expect(page.getByTestId('bird-where')).toContainText('Místo nebylo uloženo')
    await expect(page.getByRole('link', { name: 'Otevřít v mapě' })).toHaveCount(0)
  })

  test('has a recording player with its own controls that plays, pauses and seeks (a sound catch)', async ({ page }) => {
    await openList(page, '?species=parus-major')
    await cards(page).filter({ has: page.locator('.bd-bcard__badge') }).first().getByRole('link').click()
    const player = page.getByTestId('audio-player')
    await expect(player).toBeVisible()
    const audio = player.locator('audio')
    expect(await audio.evaluate((element: HTMLAudioElement) => element.controls)).toBe(false)
    await expect.poll(() => audio.evaluate((element: HTMLAudioElement) => Number.isFinite(element.duration) && element.duration > 2)).toBe(true)
    await player.getByRole('button', { name: 'Přehrát nahrávku' }).click()
    await expect.poll(() => audio.evaluate((element: HTMLAudioElement) => !element.paused)).toBe(true)
    await player.getByRole('button', { name: 'Pozastavit nahrávku' }).click()
    await expect.poll(() => audio.evaluate((element: HTMLAudioElement) => element.paused)).toBe(true)
    await player.getByRole('slider', { name: 'Místo v nahrávce' }).fill('1.8')
    await expect.poll(() => audio.evaluate((element: HTMLAudioElement) => element.currentTime)).toBeCloseTo(1.8, 0)
    // A sound catch has no photo of its own.
    await expect(page.getByTestId('bird-photo')).toHaveCount(0)
  })

  test('opens the saved photo full size and closes it again (a photo catch)', async ({ page }) => {
    await openList(page, '?species=parus-major')
    await cards(page).filter({ hasNot: page.locator('.bd-bcard__badge') }).first().getByRole('link').click()
    await page.getByTestId('bird-photo').click()
    const viewer = page.getByRole('dialog', { name: 'Fotka na celou obrazovku' })
    await expect(viewer).toBeVisible()
    await expect.poll(() => viewer.getByRole('img').evaluate((element: HTMLImageElement) => element.naturalWidth)).toBe(480)
    await page.keyboard.press('Escape')
    await expect(viewer).toHaveCount(0)
  })

  test('steps to the next and the previous bird of the list it was opened from', async ({ page }) => {
    await openList(page, '?sort=newest')
    const ids = (await cards(page).evaluateAll((items) => items.map((item) => item.getAttribute('data-catch-id')))) as string[]
    await cards(page).first().getByRole('link').click()
    await expect(page.getByTestId('bird-main')).toHaveAttribute('data-catch-id', ids[0])
    await expect(page.getByText(`1 z ${DEMO_CATCHES}`)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Předchozí pták' })).toBeDisabled()
    await page.getByTestId('bird-next').click()
    await expect(page.getByTestId('bird-main')).toHaveAttribute('data-catch-id', ids[1])
    await expect(page).toHaveURL(/\?sort=newest$/)
    await page.getByTestId('bird-prev').click()
    await expect(page.getByTestId('bird-main')).toHaveAttribute('data-catch-id', ids[0])
    // Back goes to the list as it was left.
    await page.getByTestId('bird-back').click()
    await expect(page).toHaveURL(/#\/birds\?sort=newest$/)
  })

  test('saves a note on the bird', async ({ page }) => {
    await openList(page, '?species=grus-grus')
    await cards(page).first().getByRole('link').click()
    await page.getByTestId('bird-note').fill('U rybníka.')
    await page.getByTestId('bird-note-save').click()
    await expect(page.getByText('Poznámka je uložená.')).toBeVisible()
    await page.reload()
    await expect(page.getByTestId('bird-note')).toHaveValue('U rybníka.')
  })

  test('deletes a bird after asking, keeps it when the answer is no, and the species turns "not caught" with the last one', async ({ page }) => {
    await openList(page, '?species=parus-major')
    const ids = (await cards(page).evaluateAll((items) => items.map((item) => item.getAttribute('data-catch-id')))) as string[]
    await cards(page).first().getByRole('link').click()
    await page.getByTestId('bird-delete').click()
    const dialog = page.getByRole('alertdialog', { name: 'Smazat tohohle ptáka?' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Ponechat' })).toBeFocused()
    await dialog.getByRole('button', { name: 'Ponechat' }).click()
    await expect(dialog).toHaveCount(0)
    await expect(page.getByTestId('bird-main')).toHaveAttribute('data-catch-id', ids[0])

    await page.getByTestId('bird-delete').click()
    await dialog.getByRole('button', { name: 'Smazat' }).click()
    await expect(page).toHaveURL(/#\/birds\?species=parus-major$/)
    await expect(page.getByText('Pták je smazaný.')).toBeVisible()
    await expect(cards(page)).toHaveCount(2)
    await expect(cards(page).locator(`xpath=self::*[@data-catch-id="${ids[0]}"]`)).toHaveCount(0)

    for (const remaining of [2, 1]) {
      await cards(page).first().getByRole('link').click()
      await page.getByTestId('bird-delete').click()
      await dialog.getByRole('button', { name: 'Smazat' }).click()
      if (remaining > 1) await expect(cards(page)).toHaveCount(remaining - 1)
    }
    await expect(page.getByText('Nic takového nemám')).toBeVisible()
    await page.goto('/#/species/parus-major')
    await expect(page.getByText('Tohohle ptáka ještě nemáš')).toBeVisible()
    await expect(page.getByTestId('species-birds')).toHaveCount(0)
  })
})
