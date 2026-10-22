import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { addRealCatch, addRealPhotoCatch, cardIds, mockWikimedia, seedDemo, type WikimediaMock } from './dex-helpers'
import { collectErrors, skipWelcome } from './shell-helpers'

// The Dex screens in a real browser, filled with the hidden demo data: progress, filters, search, sorting, the address that
// remembers the list, the bird screen with its catches (recording player, photo, delete), and the reference photos from a
// pretend Wikipedia. Screenshots of the phone sizes go to test-results/dex-shots-<port>/ so they can be looked at.

// The service worker would hide the requests to Wikimedia from page.route, so these tests run without it.
test.use({ serviceWorkers: 'block', viewport: { width: 390, height: 844 } })

const port = process.env.E2E_PORT ?? '4173'
const SHOTS = `test-results/dex-shots-${port}`
const species = JSON.parse(readFileSync('public/data/species.json', 'utf8')) as { id: string; czechName: string | null; inCzechia: boolean; wikiTitle: string | null }[]
const CZECH_TOTAL = species.filter((entry) => entry.inCzechia).length
const EUROPE_TOTAL = species.length
// The demo catches 24 birds, 22 of them Czech (the Northern Gannet and the Greater Flamingo are not).
const DEMO_BIRDS = 24
const DEMO_CZECH_BIRDS = 22

const longName = species.find((entry) => entry.czechName === 'Bramborníček černohlavý')?.id ?? 'saxicola-rubicola'

const screen = (page: Page) => page.getByTestId('screen')
const chip = (page: Page, name: string) => page.getByRole('button', { name, exact: true })
const progress = (page: Page) => page.getByTestId('dex-progress')
const count = (page: Page) => page.getByTestId('dex-count')
const title = (page: Page) => page.getByTestId('species-name')

test.beforeEach(async ({ page }) => {
  await skipWelcome(page)
})

async function openDex(page: Page, search = '') {
  await page.goto(`/#/${search}`)
  await expect(page.getByTestId('species-grid').or(page.getByText('Nic se nenašlo')).or(page.getByText('Zatím nemáš nic chyceno'))).toBeVisible()
}

async function openBird(page: Page, id: string, search = '') {
  await page.goto(`/#/species/${id}${search}`)
  await expect(title(page)).toBeVisible()
}

/** Scrolls the green screen to a place and waits until it stays there (the shell restores scroll places for a moment after a change of screen). */
async function scrollScreen(page: Page, top: number) {
  await expect
    .poll(async () => screen(page).evaluate((element, y) => (element.scrollTo(0, y), Math.round(element.scrollTop)), top), { timeout: 5000 })
    .toBe(top === 0 ? 0 : await screen(page).evaluate((element, y) => Math.min(y, element.scrollHeight - element.clientHeight), top))
  await page.waitForTimeout(350)
}

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => {
    const lcd = document.querySelector('[data-testid="screen"]') as HTMLElement
    return { page: document.documentElement.scrollWidth - window.innerWidth, lcd: lcd.scrollWidth - lcd.clientWidth }
  })
  expect(overflow.page).toBeLessThanOrEqual(0)
  expect(overflow.lcd).toBeLessThanOrEqual(0)
}

/** Every control that can be tapped is at least 44 px high (and wide when it holds only an icon). */
async function tapTargetsAreBigEnough(page: Page) {
  const small = await page.evaluate(() => {
    const lcd = document.querySelector('[data-testid="screen"]') as HTMLElement
    const lcdBox = lcd.getBoundingClientRect()
    const found: string[] = []
    for (const element of lcd.querySelectorAll<HTMLElement>('button, a[href], select, input, [role="slider"]')) {
      const box = element.getBoundingClientRect()
      if (box.width === 0 || box.height === 0) continue
      // Only what is on the screen now counts (the rest of the list may be skipped by the browser).
      if (box.bottom < lcdBox.top || box.top > lcdBox.bottom) continue
      const need = 43.5
      if (box.height < need || (element.tagName === 'BUTTON' && element.textContent?.trim() === '' && box.width < need)) {
        found.push(`${element.tagName.toLowerCase()}.${element.className} ${Math.round(box.width)}x${Math.round(box.height)}`)
      }
    }
    return found
  })
  expect(small).toEqual([])
}

// ---------- The hidden demo page ----------

test.describe('the demo page', () => {
  test('fills the Dex with 30 catches, runs twice without doubling, and removes only the demo ones', async ({ page }) => {
    const errors = collectErrors(page)
    await mockWikimedia(page)
    await page.goto('/#/dev/demo')
    await expect(page.getByTestId('demo-count')).toContainText('0')
    await expect(page.getByTestId('demo-remove')).toBeDisabled()

    await page.getByTestId('demo-add').click()
    await expect(page.getByTestId('demo-count')).toContainText('30', { timeout: 60_000 })
    await expect(page.getByTestId('demo-outcome')).toContainText('30')
    await page.getByTestId('demo-add').click()
    await expect(page.getByTestId('demo-outcome')).toContainText('30')
    await expect(page.getByTestId('demo-count')).toContainText('30')

    await addRealCatch(page, 'parus-major')
    await page.getByTestId('demo-remove').click()
    const dialog = page.getByRole('alertdialog', { name: 'Smazat ukázkové úlovky?' })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'Smazat' }).click()
    await expect(page.getByTestId('demo-count')).toContainText('0')
    await expect(page.getByTestId('demo-outcome')).toContainText('Ukázkové úlovky jsou pryč')

    // The person's own catch is still there, the demo ones are gone.
    await openBird(page, 'parus-major')
    await expect(page.getByTestId('catch-item')).toHaveCount(1)
    await openBird(page, 'turdus-merula')
    await expect(page.getByText('Tohohle ptáka ještě nemáš')).toBeVisible()
    expect(errors).toEqual([])
  })

  test('opens with seven quick taps on the progress ring, and is not in the navigation', async ({ page }) => {
    await mockWikimedia(page)
    await openDex(page)
    await expect(page.getByRole('navigation', { name: 'Hlavní nabídka' }).getByRole('link')).toHaveText(['Dex', 'Skenovat', 'Nastavení'])
    const ring = page.getByRole('progressbar', { name: 'Postup sbírkou' })
    for (let tap = 0; tap < 6; tap += 1) await ring.click({ delay: 10 })
    await expect(page).toHaveURL(/#\/$/)
    await ring.click()
    await expect(page).toHaveURL(/#\/dev\/demo$/)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Ukázková data')
  })
})

// ---------- The Dex ----------

test.describe('the Dex list', () => {
  test.beforeEach(async ({ page }) => {
    await mockWikimedia(page)
    await seedDemo(page)
  })

  test('shows the progress of the active region and the Czech birds first', async ({ page }) => {
    const errors = collectErrors(page)
    await openDex(page)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Ptačí Dex')
    await expect(progress(page)).toHaveText(`Chyceno ${DEMO_CZECH_BIRDS} z ${CZECH_TOTAL}`)
    await expect(page.getByRole('progressbar', { name: 'Postup sbírkou' })).toHaveAttribute('aria-valuenow', String(Math.round((DEMO_CZECH_BIRDS / CZECH_TOTAL) * 100)))
    await expect(count(page)).toHaveText(`${CZECH_TOTAL} ptáků`)
    await expect(page.getByTestId('species-card')).toHaveCount(CZECH_TOTAL)
    await expect(chip(page, 'Česko')).toHaveAttribute('aria-pressed', 'true')
    await expect(chip(page, 'Vše')).toHaveAttribute('aria-pressed', 'true')
    // The cards are in Dex order and the first ones are not caught: a silhouette in a dashed card.
    const first = page.getByTestId('species-card').first()
    await expect(first).toHaveAttribute('data-caught', 'false')
    await expect(first.locator('.bd-sil')).toBeVisible()
    // A caught bird has the badge, and its name is its Czech name.
    const tit = page.locator('[data-species-id="parus-major"]')
    await expect(tit).toHaveAttribute('data-caught', 'true')
    await expect(tit.locator('.bd-dexcard__badge')).toContainText('3×')
    await expect(tit).toContainText('Sýkora koňadra')
    await expect(tit).toContainText('#274')
    expect(errors).toEqual([])
  })

  test('filters by region and by caught or not caught, and keeps the filters in the address', async ({ page }) => {
    await openDex(page)
    await chip(page, 'Evropa').click()
    await expect(page).toHaveURL(/#\/\?region=europe$/)
    await expect(progress(page)).toHaveText(`Chyceno ${DEMO_BIRDS} z ${EUROPE_TOTAL}`)
    await expect(page.getByTestId('species-card')).toHaveCount(EUROPE_TOTAL)

    await chip(page, 'Chycené').click()
    await expect(page).toHaveURL(/#\/\?region=europe&status=caught$/)
    await expect(page.getByTestId('species-card')).toHaveCount(DEMO_BIRDS)
    await expect(count(page)).toHaveText(`${DEMO_BIRDS} ptáků`)
    expect((await cardIds(page)).every((id) => id !== '')).toBe(true)
    await expect(page.locator('[data-testid="species-card"][data-caught="false"]')).toHaveCount(0)

    await chip(page, 'Zatím ne').click()
    await expect(page).toHaveURL(/status=missing/)
    await expect(page.getByTestId('species-card')).toHaveCount(EUROPE_TOTAL - DEMO_BIRDS)
    await expect(page.locator('[data-testid="species-card"][data-caught="true"]')).toHaveCount(0)

    await chip(page, 'Česko').click()
    await expect(page).toHaveURL(/#\/\?status=missing$/)
    await expect(page.getByTestId('species-card')).toHaveCount(CZECH_TOTAL - DEMO_CZECH_BIRDS)
    await chip(page, 'Vše').click()
    await expect(page).toHaveURL(/#\/$/)
    await expect(page.getByTestId('species-card')).toHaveCount(CZECH_TOTAL)
  })

  test('searches Czech, scientific and English names without caring about accents, and writes the search into the address', async ({ page }) => {
    await openDex(page, '?region=europe')
    const box = page.getByRole('searchbox', { name: 'Hledat v Dexu' })

    await box.fill('sykora kon')
    await expect(page.getByTestId('species-card')).toHaveCount(1)
    await expect(page.getByTestId('species-card')).toHaveAttribute('data-species-id', 'parus-major')
    await expect(page).toHaveURL(/q=sykora\+kon$/)
    await expect(count(page)).toHaveText('1 pták')

    await box.fill('SÝKORA')
    expect(await cardIds(page)).toContain('parus-major')
    expect((await cardIds(page)).length).toBeGreaterThan(3)
    // The best matches come first: every name that starts with the word, before names that only contain it.
    const starts = await page.getByTestId('species-card').evaluateAll((items) => items.map((item) => (item.querySelector('.bd-dexcard__name')?.textContent ?? '').toLowerCase().startsWith('sýkora')))
    expect(starts.slice(0, 4)).toEqual([true, true, true, true])

    await box.fill('great tit')
    expect(await cardIds(page)).toContain('parus-major')
    await box.fill('parus')
    expect(await cardIds(page)).toContain('parus-major')
    await box.fill('ledňáček')
    expect(await cardIds(page)).toContain('alcedo-atthis')

    await box.fill('zzzzzz')
    await expect(page.getByText('Nic se nenašlo')).toBeVisible()
    await expect(count(page)).toHaveText('0 ptáků')
    await page.getByRole('button', { name: 'Zrušit filtry' }).click()
    await expect(page.getByTestId('species-card')).toHaveCount(EUROPE_TOTAL)
    await expect(box).toHaveValue('')
    await expect(page).toHaveURL(/#\/\?region=europe$/)

    await box.fill('kos')
    await page.getByRole('button', { name: 'Vymazat' }).click()
    await expect(box).toHaveValue('')
    await expect(page.getByTestId('species-card')).toHaveCount(EUROPE_TOTAL)
  })

  test('sorts by number, name (Czech alphabet) and rarity', async ({ page }) => {
    await openDex(page, '?region=europe')
    const sort = page.getByRole('combobox', { name: 'Řazení' })
    const names = async () => page.getByTestId('species-card').evaluateAll((items) => items.map((item) => item.querySelector('.bd-dexcard__name')?.textContent ?? ''))

    // The list follows the menu a moment later (the menu answers first), so each check waits for it.
    const collator = new Intl.Collator('cs')
    await sort.selectOption('name')
    await expect(page).toHaveURL(/sort=name/)
    await expect.poll(async () => (await names()).every((name, index, all) => index === 0 || collator.compare(all[index - 1], name) <= 0)).toBe(true)
    expect((await names()).length).toBe(EUROPE_TOTAL)

    const rank: Record<string, number> = { common: 0, uncommon: 1, rare: 2, epic: 3, legendary: 4 }
    const rarities = async () => (await page.getByTestId('species-card').evaluateAll((items) => items.map((item) => item.getAttribute('data-rarity') ?? ''))).map((rarity) => rank[rarity])
    await sort.selectOption('rarity')
    await expect(page).toHaveURL(/sort=rarity/)
    await expect.poll(async () => (await rarities()).every((value, index, all) => index === 0 || all[index - 1] <= value)).toBe(true)
    expect((await rarities())[0]).toBe(0)
    expect((await rarities()).at(-1)).toBe(4)

    await sort.selectOption('number')
    await expect(page).not.toHaveURL(/sort=/)
  })

  test('keeps every tap when the chips are pressed faster than the screen can follow (a slow phone)', async ({ page }) => {
    await openDex(page)
    // All the taps happen in one go, before the address of the first one has been shown by the router.
    await page.evaluate(() => {
      const press = (name: string) => Array.from(document.querySelectorAll('button')).find((button) => button.textContent?.trim() === name)?.click()
      press('Evropa')
      press('Chycené')
      press('Zatím ne')
      const select = document.querySelector<HTMLSelectElement>('select')
      if (select) {
        select.value = 'name'
        select.dispatchEvent(new Event('change', { bubbles: true }))
      }
    })
    await expect(page).toHaveURL(/#\/\?region=europe&status=missing&sort=name$/)
    await expect(chip(page, 'Evropa')).toHaveAttribute('aria-pressed', 'true')
    await expect(chip(page, 'Zatím ne')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByTestId('species-card')).toHaveCount(EUROPE_TOTAL - DEMO_BIRDS)
    // And it also works when a search is still waiting to be written.
    await page.getByRole('searchbox').fill('kos')
    await chip(page, 'Vše').click()
    await expect(page).toHaveURL(/#\/\?region=europe&sort=name&q=kos$/)
  })

  test('follows the address when it is changed from outside, also to the one the router last saw', async ({ page }) => {
    await openDex(page)
    await chip(page, 'Evropa').click()
    await chip(page, 'Chycené').click()
    await expect(page.getByTestId('species-card')).toHaveCount(DEMO_BIRDS)
    // The same address as at the start: for the router nothing changed, for the person the whole list did.
    await page.goto('/#/')
    await expect(page.getByTestId('species-card')).toHaveCount(CZECH_TOTAL)
    await expect(chip(page, 'Česko')).toHaveAttribute('aria-pressed', 'true')
    await expect(chip(page, 'Vše')).toHaveAttribute('aria-pressed', 'true')
    await page.goBack()
    await expect(page.getByTestId('species-card')).toHaveCount(DEMO_BIRDS)
    await expect(chip(page, 'Evropa')).toHaveAttribute('aria-pressed', 'true')
  })

  test('comes back to the same list, filters and place after opening a bird', async ({ page }) => {
    await openDex(page)
    await chip(page, 'Evropa').click()
    await chip(page, 'Zatím ne').click()
    await page.getByRole('combobox', { name: 'Řazení' }).selectOption('name')
    await expect(page).toHaveURL(/#\/\?region=europe&status=missing&sort=name$/)
    await screen(page).evaluate((element) => element.scrollTo(0, 2400))
    await page.waitForTimeout(300)
    const before = await screen(page).evaluate((element) => element.scrollTop)
    expect(before).toBeGreaterThan(1500)

    // Open the first card that is on the screen now.
    const links = page.locator('.bd-dexcard__link')
    const index = await links.evaluateAll((items) => {
      const lcd = document.querySelector('[data-testid="screen"]') as HTMLElement
      const top = lcd.getBoundingClientRect().top
      return items.findIndex((item) => item.getBoundingClientRect().top > top + 20)
    })
    expect(index).toBeGreaterThan(10)
    const id = await page.getByTestId('species-card').nth(index).getAttribute('data-species-id')
    await links.nth(index).click()
    await expect(page).toHaveURL(new RegExp(`#/species/${id}\\?region=europe&status=missing&sort=name$`))
    await expect(title(page)).toBeVisible()

    await page.goBack()
    await expect(page).toHaveURL(/#\/\?region=europe&status=missing&sort=name$/)
    await expect(chip(page, 'Evropa')).toHaveAttribute('aria-pressed', 'true')
    await expect(chip(page, 'Zatím ne')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByRole('combobox', { name: 'Řazení' })).toHaveValue('name')
    await expect.poll(() => screen(page).evaluate((element) => element.scrollTop)).toBeGreaterThan(before - 60)
    await expect.poll(() => screen(page).evaluate((element) => element.scrollTop)).toBeLessThan(before + 60)
  })

  test('restores the list from the address after a reload', async ({ page }) => {
    await openDex(page, '?region=europe&status=caught&q=sykora%20kon')
    await expect(page.getByRole('searchbox')).toHaveValue('sykora kon')
    await expect(page.getByTestId('species-card')).toHaveAttribute('data-species-id', 'parus-major')
    await page.reload()
    await expect(page.getByRole('searchbox')).toHaveValue('sykora kon')
    await expect(chip(page, 'Evropa')).toHaveAttribute('aria-pressed', 'true')
    await expect(chip(page, 'Chycené')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByTestId('species-card')).toHaveAttribute('data-species-id', 'parus-major')
  })

  test('keeps hundreds of cards smooth: the browser skips the ones far away, and every card has the same height', async ({ page }) => {
    await openDex(page, '?region=europe')
    await expect(page.getByTestId('species-card')).toHaveCount(EUROPE_TOTAL)
    const facts = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll<HTMLElement>('[data-testid="species-card"]'))
      const heights = new Set(cards.slice(0, 40).map((card) => Math.round(card.getBoundingClientRect().height)))
      return {
        contentVisibility: getComputedStyle(cards[0]).contentVisibility,
        heights: [...heights],
        columns: getComputedStyle(document.querySelector('[data-testid="species-grid"]') as HTMLElement).gridTemplateColumns.split(' ').length,
        nodes: document.querySelectorAll('[data-testid="species-grid"] *').length,
      }
    })
    expect(facts.contentVisibility).toBe('auto')
    expect(facts.heights).toHaveLength(1)
    expect(facts.columns).toBe(2)
    expect(facts.nodes).toBeLessThan(EUROPE_TOTAL * 24)
    // Scrolling to the very end does not break anything and leaves the last card where it should be.
    await screen(page).evaluate((element) => element.scrollTo(0, element.scrollHeight))
    await page.waitForTimeout(400)
    const last = page.getByTestId('species-card').last()
    await expect(last).toBeInViewport()
  })

  test('copes with 700 birds, which is more than the Dex holds today, and still skips the cards far away', async ({ page }) => {
    // The list of birds is served with 271 more made-up birds, so there are 700 of them.
    const original = JSON.parse(readFileSync('public/data/species.json', 'utf8')) as Record<string, unknown>[]
    const more = original.slice(0, 271).map((bird, index) => ({
      ...bird,
      id: `${String(bird.id)}-kopie`,
      dexNumber: original.length + index + 1,
      scientificName: `${String(bird.scientificName)} kopie`,
      czechName: bird.czechName === null ? null : `${String(bird.czechName)} druhý`,
    }))
    await page.route('**/data/species.json', (route) => route.fulfill({ json: [...original, ...more] }))
    // The app has the real list in memory from the demo page; starting it again makes it ask for the list.
    await page.reload()
    const session = await page.context().newCDPSession(page)
    await session.send('Emulation.setCPUThrottlingRate', { rate: 4 })

    await openDex(page, '?region=europe')
    await expect(page.getByTestId('species-card')).toHaveCount(700, { timeout: 20_000 })
    await expect(count(page)).toHaveText('700 ptáků')
    const skipped = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll<HTMLElement>('[data-testid="species-card"]'))
      return { heights: [...new Set(cards.slice(0, 80).map((card) => Math.round(card.getBoundingClientRect().height)))], total: cards.length }
    })
    expect(skipped.heights).toHaveLength(1)
    // The scroll height is that of 350 rows of 186 px: skipped cards take exactly their room.
    const scrollHeight = await screen(page).evaluate((element) => element.scrollHeight)
    expect(scrollHeight).toBeGreaterThan(350 * 186)
    expect(scrollHeight).toBeLessThan(350 * 186 + 700)
    // It answers a tap on a filter and a search at once, and the last card can be reached.
    await page.getByRole('searchbox').fill('druhý')
    await expect(page.getByTestId('species-card')).toHaveCount(271, { timeout: 20_000 })
    await page.getByRole('searchbox').fill('')
    await expect(page.getByTestId('species-card')).toHaveCount(700, { timeout: 20_000 })
    await scrollScreen(page, 999_999)
    await expect(page.getByTestId('species-card').last()).toBeInViewport()
    await session.send('Emulation.setCPUThrottlingRate', { rate: 1 })
  })

  test('draws the cards fast even when the processor is four times slower (a cheap phone)', async ({ page }) => {
    const session = await page.context().newCDPSession(page)
    await session.send('Emulation.setCPUThrottlingRate', { rate: 4 })
    await openDex(page, '?region=europe')
    const started = Date.now()
    await page.goto('/#/?region=europe&status=caught')
    await expect(page.getByTestId('species-card')).toHaveCount(DEMO_BIRDS)
    await page.goto('/#/?region=europe')
    await expect(page.getByTestId('species-card')).toHaveCount(EUROPE_TOTAL)
    // On this machine the whole round takes about a second; the limit is generous so a busy computer does not fail it.
    expect(Date.now() - started).toBeLessThan(20_000)
    // Swiping through the list: the page keeps answering taps all the way.
    for (const top of [800, 1600, 2400, 3200]) {
      await screen(page).evaluate((element, y) => element.scrollTo(0, y), top)
      await page.waitForTimeout(100)
    }
    await chip(page, 'Česko').click()
    await expect(page.getByTestId('species-card')).toHaveCount(CZECH_TOTAL)
    await session.send('Emulation.setCPUThrottlingRate', { rate: 1 })
  })
})

// ---------- Photos from a camera ----------

test.describe('photos from a phone camera', () => {
  test('are shown in the list as small pictures, the right way up, and at full size on the bird screen', async ({ page }) => {
    await mockWikimedia(page)
    await openDex(page)
    // 640 x 960 as stored, with the camera note "turned a quarter": on the screen it is a landscape picture of 960 x 640.
    const file = readFileSync('tests/fixtures/vision/mallard-exif-rotated.jpg')
    expect(file.length).toBeGreaterThan(100_000)
    await addRealPhotoCatch(page, 'anas-platyrhynchos', file)
    // The row was written behind the app's back, so the app is started again to read it.
    await page.reload()

    await openDex(page, '?region=europe&status=caught')
    const card = page.locator('[data-species-id="anas-platyrhynchos"]')
    await card.scrollIntoViewIfNeeded()
    const thumbnail = card.locator('img')
    await expect(thumbnail).toHaveAttribute('src', /^blob:/)
    await expect.poll(() => thumbnail.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBe(400)
    const height = await thumbnail.evaluate((element: HTMLImageElement) => element.naturalHeight)
    expect(height).toBeGreaterThan(250)
    expect(height).toBeLessThan(285)
    // A fraction of the size of the camera file.
    const bytes = await thumbnail.evaluate(async (element: HTMLImageElement) => (await (await fetch(element.src)).blob()).size)
    expect(bytes).toBeLessThan(file.length / 2)

    // The bird screen shows the whole picture, and the viewer too.
    await card.locator('a').click()
    const own = page.getByTestId('own-photo').locator('img')
    await expect(own).toBeVisible()
    await expect.poll(() => own.evaluate((element: HTMLImageElement) => `${element.naturalWidth}x${element.naturalHeight}`)).toBe('960x640')
    await page.getByTestId('own-photo').click()
    const viewer = page.getByRole('dialog', { name: 'Fotka na celou obrazovku' }).getByRole('img')
    await expect.poll(() => viewer.evaluate((element: HTMLImageElement) => `${element.naturalWidth}x${element.naturalHeight}`)).toBe('960x640')
  })
})

// ---------- The bird screen ----------

test.describe('the bird screen', () => {
  let mock: WikimediaMock
  test.beforeEach(async ({ page }) => {
    mock = await mockWikimedia(page)
    await seedDemo(page)
  })

  test('shows a caught bird with its photo panel, names, family, flags and every catch', async ({ page }) => {
    const errors = collectErrors(page)
    await openBird(page, 'parus-major')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Sýkora koňadra')
    await expect(page.getByText('Parus major')).toBeVisible()
    await expect(page.locator('i', { hasText: 'Parus major' })).toBeVisible()
    await expect(page.getByText('sýkorovití')).toBeVisible()
    await expect(page.getByRole('group', { name: 'Kde žije' })).toContainText('Česko')
    await expect(page.getByRole('group', { name: 'Kde žije' })).toContainText('Evropa')
    await expect(page.getByTestId('species-photo')).toContainText('#274')
    await expect(page.getByTestId('status-caught')).toContainText('Tenhle pták už je tvůj!')
    await expect(page.getByTestId('status-caught')).toContainText('Úlovků: 3')

    const items = page.getByTestId('catch-item')
    await expect(items).toHaveCount(3)
    // Newest first: the sound (a few hours ago), then the photo and the older sound.
    await expect(items.nth(0)).toHaveAttribute('data-method', 'sound')
    await expect(items.nth(1)).toHaveAttribute('data-method', 'photo')
    await expect(items.nth(2)).toHaveAttribute('data-method', 'sound')
    for (const item of await items.all()) {
      await expect(item.locator('time')).toHaveText(/^\d{1,2}\. \d{1,2}\. 2026 \d{1,2}:\d{2}$/)
      await expect(item.getByRole('meter')).toBeVisible()
      await expect(item.getByRole('button', { name: 'Smazat úlovek' })).toBeVisible()
      await expect(item.getByText('UKÁZKA')).toBeVisible()
    }
    // A named place with a map link, rounded coordinates, and a catch without any place.
    await expect(items.first().getByRole('link', { name: 'Otevřít v mapě' })).toHaveAttribute('href', /openstreetmap\.org\/\?mlat=[\d.]+&mlon=[\d.]+/)
    expect(errors).toEqual([])
  })

  test('shows rounded coordinates when a catch has no place name, and nothing when it has no place', async ({ page }) => {
    // The demo has catches with a place name, catches with coordinates only, and catches with no place at all.
    await openBird(page, 'sitta-europaea')
    await expect(page.getByTestId('catch-list')).toContainText(/\d{2},\d{2}° s\. š\., \d{1,2},\d{2}° v\. d\./)
    await expect(page.getByTestId('catch-item').first().getByRole('link', { name: 'Otevřít v mapě' })).toBeVisible()
    await openBird(page, 'grus-grus')
    await expect(page.getByTestId('catch-list')).toContainText('Místo nebylo uloženo')
    await expect(page.getByRole('link', { name: 'Otevřít v mapě' })).toHaveCount(0)
    await openBird(page, 'turdus-merula')
    await expect(page.getByTestId('catch-item')).toHaveCount(2)
  })

  test('has a recording player with its own controls that plays, pauses and seeks', async ({ page }) => {
    await openBird(page, 'parus-major')
    const player = page.getByTestId('audio-player').first()
    await expect(player).toBeVisible()
    const audio = player.locator('audio')
    await expect(audio).toHaveCount(1)
    expect(await audio.evaluate((element: HTMLAudioElement) => element.controls)).toBe(false)
    await expect.poll(() => audio.evaluate((element: HTMLAudioElement) => Number.isFinite(element.duration) && element.duration > 2)).toBe(true)
    await expect(player.locator('.bd-audio__time')).toHaveText('0:00 / 0:02')
    await expect(player.locator('.bd-audio__bar')).toHaveCount(32)

    const button = player.getByRole('button', { name: 'Přehrát nahrávku' })
    await button.click()
    await expect(player.getByRole('button', { name: 'Pozastavit nahrávku' })).toBeVisible()
    await expect.poll(() => audio.evaluate((element: HTMLAudioElement) => !element.paused)).toBe(true)
    await expect.poll(() => audio.evaluate((element: HTMLAudioElement) => element.currentTime)).toBeGreaterThan(0.15)
    await expect.poll(() => player.locator('.bd-audio__bar.is-lit').count()).toBeGreaterThan(0)
    await player.getByRole('button', { name: 'Pozastavit nahrávku' }).click()
    await expect.poll(() => audio.evaluate((element: HTMLAudioElement) => element.paused)).toBe(true)

    // The seek bar moves the playhead and the time.
    await player.getByRole('slider', { name: 'Místo v nahrávce' }).fill('1.8')
    await expect.poll(() => audio.evaluate((element: HTMLAudioElement) => element.currentTime)).toBeCloseTo(1.8, 0)
    await expect(player.locator('.bd-audio__time')).toHaveText('0:01 / 0:02')
  })

  test('plays one recording at a time', async ({ page }) => {
    await openBird(page, 'parus-major')
    const players = page.getByTestId('audio-player')
    await expect(players).toHaveCount(2)
    await players.nth(0).getByTestId('audio-toggle').click()
    await expect.poll(() => players.nth(0).locator('audio').evaluate((element: HTMLAudioElement) => !element.paused)).toBe(true)
    await players.nth(1).getByTestId('audio-toggle').click()
    await expect.poll(() => players.nth(1).locator('audio').evaluate((element: HTMLAudioElement) => !element.paused)).toBe(true)
    await expect.poll(() => players.nth(0).locator('audio').evaluate((element: HTMLAudioElement) => element.paused)).toBe(true)
  })

  test('opens the saved photo full size and closes it again', async ({ page }) => {
    await openBird(page, 'parus-major')
    await page.getByTestId('catch-photo').first().click()
    const viewer = page.getByRole('dialog', { name: 'Fotka na celou obrazovku' })
    await expect(viewer).toBeVisible()
    const image = viewer.getByRole('img')
    await expect(image).toBeVisible()
    await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBe(480)
    const box = await image.boundingBox()
    expect(box?.width ?? 0).toBeGreaterThan(300)
    await page.waitForTimeout(400)
    await page.screenshot({ path: `${SHOTS}/viewer-390.png` })
    await page.keyboard.press('Escape')
    await expect(viewer).toHaveCount(0)

    // The big panel opens the same viewer, and the close button works too.
    await page.getByTestId('own-photo').click()
    await expect(viewer).toBeVisible()
    await viewer.getByRole('button', { name: 'Zavřít fotku' }).click()
    await expect(viewer).toHaveCount(0)
  })

  test('deletes a catch after asking, and keeps it when the answer is no', async ({ page }) => {
    await openBird(page, 'parus-major')
    const items = page.getByTestId('catch-item')
    await expect(items).toHaveCount(3)

    await items.nth(1).getByRole('button', { name: 'Smazat úlovek' }).click()
    const dialog = page.getByRole('alertdialog', { name: 'Smazat tenhle úlovek?' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Ponechat' })).toBeFocused()
    await dialog.getByRole('button', { name: 'Ponechat' }).click()
    await expect(dialog).toHaveCount(0)
    await expect(items).toHaveCount(3)

    await items.nth(1).getByRole('button', { name: 'Smazat úlovek' }).click()
    await dialog.getByRole('button', { name: 'Smazat' }).click()
    await expect(items).toHaveCount(2)
    await expect(page.getByText('Úlovek je smazaný.')).toBeVisible()
    await expect(page.getByTestId('status-caught')).toContainText('Úlovků: 2')
    await expect(page.locator('[data-method="photo"]')).toHaveCount(0)

    // Deleting everything turns the bird back into one that is not caught.
    for (const remaining of [2, 1]) {
      await items.first().getByRole('button', { name: 'Smazat úlovek' }).click()
      await dialog.getByRole('button', { name: 'Smazat' }).click()
      await expect(items).toHaveCount(remaining - 1)
    }
    await expect(page.getByText('Tohohle ptáka ještě nemáš')).toBeVisible()
    await expect(page.getByTestId('catch-list')).toHaveCount(0)
    await page.goto('/#/')
    await expect(progress(page)).toHaveText(`Chyceno ${DEMO_CZECH_BIRDS - 1} z ${CZECH_TOTAL}`)
  })

  test('shows when and where to find a bird, for a Czech bird, a bird that lives only in Europe, and a caught bird', async ({ page }) => {
    const findingOf = (id: string) => species.find((entry) => entry.id === id)
    expect(findingOf('fratercula-arctica')?.inCzechia).toBe(false)

    // A bird of the Czech list: the months strip of the winter guest, marked for this month, and no country list.
    await openBird(page, 'anser-albifrons')
    const finding = page.getByTestId('status-missing').getByTestId('finding-info')
    await expect(finding.getByTestId('finding-season')).toContainText('Od října do března')
    await expect(finding.getByTestId('finding-months').locator('.bd-find__month[data-now="true"]')).toHaveCount(1)
    await expect(finding.getByTestId('finding-shy')).toContainText('zoom')
    await expect(finding.getByTestId('finding-countries')).toHaveCount(0)
    await finding.scrollIntoViewIfNeeded()
    await page.screenshot({ path: `${SHOTS}/finding-czech-390.png` })

    // A bird that is only in Europe says it is not here and names the countries.
    await openBird(page, 'fratercula-arctica')
    const europe = page.getByTestId('status-missing').getByTestId('finding-info')
    await expect(europe.getByText('Kdy v Evropě')).toBeVisible()
    await expect(europe.getByTestId('finding-countries')).toContainText('U nás se nevyskytuje.')
    await expect(europe.getByTestId('finding-countries')).toContainText('Norsko')
    await expect(europe.getByTestId('finding-place')).toHaveText('Na otevřeném moři')
    await europe.scrollIntoViewIfNeeded()
    await page.screenshot({ path: `${SHOTS}/finding-europe-390.png` })

    // A caught bird keeps the same info under the summary.
    await seedDemo(page)
    await openBird(page, 'parus-major')
    const caught = page.getByTestId('status-caught')
    await expect(caught).toContainText('Tenhle pták už je tvůj!')
    // Folded at first, so it does not fill the screen; the heading unfolds it.
    const toggle = caught.getByTestId('finding-toggle')
    await expect(toggle).toContainText('Kde a kdy ho potkáš znovu')
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await expect(caught.getByTestId('finding-season')).toBeHidden()
    await caught.scrollIntoViewIfNeeded()
    await page.screenshot({ path: `${SHOTS}/finding-caught-folded-390.png` })
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await expect(caught.getByTestId('finding-season')).toContainText('Celý rok')
    await expect(caught.getByTestId('finding-place')).toBeVisible()
    await page.screenshot({ path: `${SHOTS}/finding-caught-390.png` })
    await toggle.click()
    await expect(caught.getByTestId('finding-season')).toBeHidden()
  })

  test('shows a bird that is not caught: a silhouette, a tip, the way to scan it, and a peek at the reference photo', async ({ page }) => {
    await openBird(page, 'anser-anser')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Husa velká')
    await expect(page.getByTestId('species-photo')).toHaveAttribute('data-view', 'silhouette')
    await expect(page.getByTestId('species-photo').locator('.bd-sil')).toBeVisible()
    await expect(page.getByTestId('status-missing')).toContainText('Tohohle ptáka ještě nemáš')
    // When and where to find it: the months, the place, the shyness, the time of day and a tip for geese.
    const finding = page.getByTestId('status-missing').getByTestId('finding-info')
    await expect(finding).toContainText('Kdy a kde ho hledat')
    await expect(finding.getByTestId('finding-months')).toBeVisible()
    await expect(finding.getByTestId('finding-months').locator('.bd-find__month')).toHaveCount(12)
    await expect(finding.getByTestId('finding-place')).toHaveText('U vody a na mokřadech')
    await expect(finding.getByTestId('finding-shy')).toContainText('Opatrný')
    await expect(finding.getByTestId('finding-day')).toHaveText('Ráno a k večeru')
    await expect(finding.getByTestId('finding-tip')).toContainText('Husy se pasou')
    await expect(finding.getByTestId('finding-countries')).toHaveCount(0)
    await expect(page.getByTestId('catch-list')).toHaveCount(0)
    // The secret is kept: nothing is looked up until the person asks.
    await page.waitForTimeout(400)
    expect(mock.total()).toBe(0)

    await page.getByTestId('photo-peek').click()
    await expect(page.getByTestId('photo-credit')).toContainText('Foto: Jan Novák')
    await expect(page.getByTestId('species-photo')).toHaveAttribute('data-view', 'reference')
    expect(mock.summaries).toEqual(['Greylag goose'])
    await page.getByTestId('photo-peek').click()
    await expect(page.getByTestId('species-photo')).toHaveAttribute('data-view', 'silhouette')

    await page.getByRole('link', { name: 'Jdu ho hledat' }).click()
    await expect(page).toHaveURL(/#\/scan$/)
  })

  test('goes to the next and previous bird of the list it was opened from, and back to the list', async ({ page }) => {
    await openDex(page, '?region=europe&status=caught')
    const ids = await cardIds(page)
    await page.locator('.bd-dexcard__link').nth(1).click()
    await expect(page).toHaveURL(new RegExp(`#/species/${ids[1]}\\?region=europe&status=caught$`))
    await expect(page.locator('.bd-spnav__position')).toHaveText(`2 z ${DEMO_BIRDS}`)

    await page.getByTestId('species-next').click()
    await expect(page).toHaveURL(new RegExp(`#/species/${ids[2]}\\?region=europe&status=caught$`))
    await page.getByTestId('species-prev').click()
    await page.getByTestId('species-prev').click()
    await expect(page).toHaveURL(new RegExp(`#/species/${ids[0]}\\?region=europe&status=caught$`))
    await expect(page.getByRole('button', { name: 'Předchozí pták' })).toBeDisabled()

    // Moving between birds replaced the history entry, so one step back is the list, with its filters.
    await page.getByTestId('species-back').click()
    await expect(page).toHaveURL(/#\/\?region=europe&status=caught$/)
    await expect(page.getByTestId('species-card')).toHaveCount(DEMO_BIRDS)
  })

  test('opens the Dex with the same filters when the bird address was opened directly', async ({ page }) => {
    await openBird(page, 'anser-anser', '?status=missing')
    await page.getByTestId('species-back').click()
    await expect(page).toHaveURL(/#\/\?status=missing$/)
    await expect(chip(page, 'Zatím ne')).toHaveAttribute('aria-pressed', 'true')
  })

  test('says calmly that a bird is not in the Dex', async ({ page }) => {
    await page.goto('/#/species/not-a-bird')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Tohohle ptáka v Dexu nemám.')
    await page.getByRole('link', { name: 'Zpět do Dexu' }).click()
    await expect(page).toHaveURL(/#\/$/)
  })
})

// ---------- Reference photos ----------

test.describe('reference photos', () => {
  const owl = species.find((entry) => entry.id === 'bubo-bubo')

  test('show on a caught bird with only a recording, with the author, the licence and a link', async ({ page }) => {
    const mock = await mockWikimedia(page)
    const errors = collectErrors(page)
    await seedDemo(page)
    await openBird(page, 'bubo-bubo')
    const credit = page.getByTestId('photo-credit')
    await expect(credit).toContainText('Foto: Jan Novák')
    await expect(credit.getByRole('link')).toHaveText('CC BY-SA 4.0 · Wikimedia Commons')
    await expect(credit.getByRole('link')).toHaveAttribute('href', /^https:\/\/commons\.wikimedia\.org\/wiki\/File:Eurasian_eagle_owl\.jpg$/)
    await expect(credit.getByRole('link')).toHaveAttribute('target', '_blank')
    await expect(credit.getByRole('link')).toHaveAttribute('rel', /noopener/)
    const photo = page.getByTestId('species-photo').locator('img')
    await expect(photo).toBeVisible()
    await expect(photo).toHaveAttribute('crossorigin', 'anonymous')
    await expect(photo).toHaveAttribute('referrerpolicy', 'no-referrer')
    await expect.poll(() => photo.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBeGreaterThan(0)
    // The detail screen asks for the wider picture, the lists for the small one.
    expect(mock.images.some((url) => url.includes('/500px-'))).toBe(true)
    expect(mock.summaries).toContain(owl?.wikiTitle)
    expect(errors).toEqual([])
  })

  test('use the small picture when the wide one is not served', async ({ page }) => {
    await mockWikimedia(page, { noWidePictures: true })
    await seedDemo(page)
    await openBird(page, 'bubo-bubo')
    const photo = page.getByTestId('species-photo').locator('img')
    await expect(photo).toHaveAttribute('src', /\/330px-/, { timeout: 15_000 })
    await expect.poll(() => photo.evaluate((element: HTMLImageElement) => element.naturalWidth), { timeout: 15_000 }).toBeGreaterThan(0)
    await expect(photo).toHaveAttribute('crossorigin', 'anonymous')
  })

  test('are looked up once and remembered on the phone: a reload asks nobody again', async ({ page }) => {
    const mock = await mockWikimedia(page)
    await seedDemo(page)
    await openBird(page, 'bubo-bubo')
    await expect(page.getByTestId('photo-credit')).toBeVisible()
    const asked = { summaries: mock.summaries.length, credits: mock.credits.length }
    expect(asked.summaries).toBeGreaterThan(0)

    await page.reload()
    await expect(page.getByTestId('photo-credit')).toContainText('Foto: Jan Novák')
    await openBird(page, 'strix-aluco')
    await expect(page.getByTestId('photo-credit')).toBeVisible()
    await page.goBack()
    await expect(page.getByTestId('photo-credit')).toContainText('Foto: Jan Novák')
    expect(mock.summaries.filter((title) => title === owl?.wikiTitle)).toHaveLength(1)
    expect(mock.credits.filter((file) => file.startsWith('Eurasian_eagle_owl'))).toHaveLength(1)
  })

  test('fill the cards of caught birds that have no picture of their own, never asking more than four at a time', async ({ page }) => {
    const mock = await mockWikimedia(page, { delayMs: 150 })
    await seedDemo(page)
    await openDex(page, '?region=europe&status=caught')
    // Birds caught by sound borrow the reference photo; birds caught with a picture show their own.
    // Only the cards near the screen load pictures: a card far down the list has none yet, and gets one when it comes near.
    const own = page.locator('[data-testid="species-card"][data-species-id="parus-major"] img')
    await page.waitForTimeout(500)
    await expect(own).toHaveCount(0)
    await page.locator('[data-species-id="parus-major"]').scrollIntoViewIfNeeded()
    await expect(own).toHaveAttribute('src', /^blob:/)
    const borrowed = page.locator('[data-testid="species-card"][data-species-id="bubo-bubo"] img')
    await page.locator('[data-species-id="bubo-bubo"]').scrollIntoViewIfNeeded()
    await expect(borrowed).toBeVisible({ timeout: 15_000 })
    await expect(borrowed).toHaveAttribute('src', /upload\.wikimedia\.org.*\/330px-/)
    await expect(borrowed).toHaveAttribute('crossorigin', 'anonymous')
    await expect.poll(() => borrowed.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBeGreaterThan(0)
    expect(mock.maxInFlight()).toBeLessThanOrEqual(4)
    expect(mock.maxInFlight()).toBeGreaterThan(1)

    // Birds that are not caught never ask anybody and keep their silhouette.
    await openDex(page, '?region=europe&status=missing')
    await page.waitForTimeout(500)
    await expect(page.locator('[data-testid="species-card"][data-caught="false"] img')).toHaveCount(0)
  })

  test('show nothing for a picture with a licence the app may not use, and say so', async ({ page }) => {
    await mockWikimedia(page, { refused: [owl?.wikiTitle ?? '', 'Bubo bubo'] })
    await seedDemo(page)
    await openBird(page, 'bubo-bubo')
    await expect(page.getByText('K tomuhle ptákovi nemám žádnou volnou fotku.')).toBeVisible()
    await expect(page.getByTestId('photo-credit')).toHaveCount(0)
    await expect(page.getByTestId('species-photo')).toHaveAttribute('data-view', 'silhouette')
    await expect(page.getByTestId('species-photo').locator('.bd-sil')).toBeVisible()
  })

  test('show nothing for an article without a picture', async ({ page }) => {
    await mockWikimedia(page, { withoutPicture: [owl?.wikiTitle ?? '', 'Bubo bubo'] })
    await seedDemo(page)
    await openBird(page, 'bubo-bubo')
    await expect(page.getByText('K tomuhle ptákovi nemám žádnou volnou fotku.')).toBeVisible()
  })

  test('fall back to the silhouette without a connection, and say that a connection is needed', async ({ page }) => {
    await mockWikimedia(page, { down: true })
    // Failed requests are logged by the browser itself; this test is about what the screen does.
    await seedDemo(page)
    await openBird(page, 'bubo-bubo')
    await expect(page.getByText('Bez připojení ukázkovou fotku nenačtu.')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByTestId('species-photo').locator('.bd-sil')).toBeVisible()
    // The rest of the screen is fine.
    await expect(page.getByTestId('catch-item')).toHaveCount(1)
    await expect(page.getByTestId('species-name')).toBeVisible()
  })

  test('are credited next to the picture on a bird that is not caught, once the person asks to see it', async ({ page }) => {
    await mockWikimedia(page)
    await openBird(page, 'tichodroma-muraria')
    await page.getByTestId('photo-peek').click()
    await expect(page.getByTestId('photo-credit')).toContainText('Foto: Jan Novák')
    await expect(page.getByTestId('photo-credit').getByRole('link')).toHaveAttribute('href', /commons\.wikimedia\.org\/wiki\/File:Wallcreeper\.jpg$/)
  })

  test('the built service worker keeps Wikimedia pictures: cache first, up to 800, status 0 and 200', async () => {
    const worker = readFileSync(`dist-e2e-${port}/sw.js`, 'utf8')
    expect(worker).toContain('birddex-photos-v1')
    expect(worker).toMatch(/upload\\\.wikimedia\\\.org/)
    expect(worker).toMatch(/maxEntries:\s*800/)
    expect(worker).toMatch(/statuses:\s*\[0,\s*200\]/)
    expect(worker).toMatch(/CacheFirst/)
    // The other rules are still there.
    expect(worker).toContain('birddex-heavy-v1')
    expect(worker).toContain('birddex-model-list')
  })
})

// ---------- Looks ----------

test.describe('the phone sizes', () => {
  for (const [width, height] of [
    [390, 844],
    [360, 800],
  ] as const) {
    test(`look right at ${width}x${height}: no sideways scrolling, big enough buttons, Czech letters; screenshots for a human`, async ({ page }) => {
      await page.setViewportSize({ width, height })
      await mockWikimedia(page)
      const errors = collectErrors(page)
      await seedDemo(page)

      await openDex(page)
      await expect(page.locator('[data-species-id="parus-major"]')).toBeAttached()
      await scrollScreen(page, 0)
      await noHorizontalScroll(page)
      await tapTargetsAreBigEnough(page)
      await page.screenshot({ path: `${SHOTS}/dex-top-${width}.png` })

      await openDex(page, '?region=europe&status=caught')
      await scrollScreen(page, 0)
      await page.waitForTimeout(900)
      await noHorizontalScroll(page)
      await page.screenshot({ path: `${SHOTS}/dex-caught-${width}.png` })
      await scrollScreen(page, 900)
      await page.waitForTimeout(600)
      await page.screenshot({ path: `${SHOTS}/dex-caught-scrolled-${width}.png` })

      await openDex(page, '?q=ch%C5%99%C3%A1stal')
      await scrollScreen(page, 0)
      await page.screenshot({ path: `${SHOTS}/dex-search-${width}.png` })
      await openDex(page, '?q=zzzz')
      await scrollScreen(page, 0)
      await page.screenshot({ path: `${SHOTS}/dex-empty-${width}.png` })

      for (const [name, id] of [
        ['bird-caught', 'parus-major'],
        ['bird-sound-only', 'bubo-bubo'],
        ['bird-missing', 'anser-anser'],
        ['bird-long-name', longName],
      ] as const) {
        await openBird(page, id)
        await page.waitForTimeout(900)
        await noHorizontalScroll(page)
        await tapTargetsAreBigEnough(page)
        await scrollScreen(page, 0)
        await page.screenshot({ path: `${SHOTS}/${name}-${width}.png` })
        await scrollScreen(page, 560)
        await noHorizontalScroll(page)
        await tapTargetsAreBigEnough(page)
        await page.screenshot({ path: `${SHOTS}/${name}-2-${width}.png` })
        await scrollScreen(page, 1200)
        await page.screenshot({ path: `${SHOTS}/${name}-3-${width}.png` })
      }
      await page.goto('/#/dev/demo')
      await expect(page.getByTestId('demo-count')).toBeVisible()
      await page.waitForTimeout(400)
      await page.screenshot({ path: `${SHOTS}/demo-${width}.png` })
      expect(errors).toEqual([])
    })
  }

  test('has a unique, visible heading, a document language of Czech and the Czech letters in the long names', async ({ page }) => {
    await mockWikimedia(page)
    await seedDemo(page)
    await openDex(page, '?region=europe&q=bramborn%C3%AD%C4%8Dek')
    await expect(page.getByTestId('species-card').first()).toContainText('Bramborníček')
    expect(await page.locator('html').getAttribute('lang')).toBe('cs')
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
    await openBird(page, 'phoenicopterus-roseus')
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Plameňák růžový')
  })

  test('is the same screen in a landscape phone, without anything cut off', async ({ page }) => {
    await page.setViewportSize({ width: 844, height: 390 })
    await mockWikimedia(page)
    await seedDemo(page)
    await openDex(page)
    await noHorizontalScroll(page)
    await expect.poll(() => page.getByTestId('species-grid').evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').length)).toBeGreaterThanOrEqual(3)
    await scrollScreen(page, 0)
    await page.screenshot({ path: `${SHOTS}/dex-landscape.png` })
    await openBird(page, 'parus-major')
    await noHorizontalScroll(page)
    await scrollScreen(page, 0)
    await page.screenshot({ path: `${SHOTS}/bird-landscape.png` })
    // The picture is a wide strip, so the name is in sight without scrolling a whole screen.
    const panel = await page.getByTestId('species-photo').boundingBox()
    expect(panel?.height ?? 999).toBeLessThan(260)
  })
})
