import { expect, test } from '@playwright/test'
import { mockWikimedia, seedDemo } from './dex-helpers'
import { collectErrors, skipWelcome } from './shell-helpers'

const SIZES = [
  { width: 390, height: 844 },
  { width: 360, height: 800 },
]

test.beforeEach(async ({ page }) => {
  await skipWelcome(page)
})

test('sensitivity is explained, switchable and remembered after a reload', async ({ page }) => {
  const errors = collectErrors(page)
  await page.goto('/#/settings')
  const info = page.getByTestId('sensitivity-info')
  await expect(info).toHaveAttribute('data-level', 'normal')
  await page.getByRole('radio', { name: 'Přísná' }).click()
  await expect(info).toHaveAttribute('data-level', 'strict')
  await page.reload()
  await expect(page.getByTestId('sensitivity-info')).toHaveAttribute('data-level', 'strict')
  await page.getByRole('radio', { name: 'Snadná' }).click()
  await page.reload()
  await expect(page.getByTestId('sensitivity-info')).toHaveAttribute('data-level', 'easy')
  expect(errors).toEqual([])
})

test('sound effects can be switched and the links work', async ({ page }) => {
  await page.goto('/#/settings')
  await expect(page.getByTestId('sound-section')).toBeVisible()
  await expect(page.getByTestId('app-version')).toContainText('Verze')
  await page.getByTestId('link-about').click()
  await expect(page).toHaveURL(/#\/about$/)
  await page.goBack()
  // The phone test page is for testers: its link appears after seven taps on the version line.
  await expect(page.getByTestId('link-field-check')).toHaveCount(0)
  for (let tap = 0; tap < 7; tap += 1) await page.getByTestId('app-version').click()
  await page.getByTestId('link-field-check').click()
  await expect(page).toHaveURL(/#\/field-check$/)
})

test('the model cache is listed with sizes', async ({ page }) => {
  await page.goto('/#/settings')
  await expect(page.getByTestId('models-list')).toBeVisible({ timeout: 30_000 })
  expect(await page.getByTestId('model-row').count()).toBeGreaterThanOrEqual(3)
  await expect(page.getByTestId('models-summary')).toBeVisible()
  await expect(page.getByTestId('storage-usage')).toBeVisible()
  await expect(page.getByTestId('storage-persistent')).toBeVisible()
})

test('with nothing downloaded every model row says so and there is nothing to delete', async ({ page }) => {
  await page.goto('/#/settings')
  await expect(page.getByTestId('models-list')).toBeVisible({ timeout: 30_000 })
  const states = await page.getByTestId('model-row').evaluateAll((rows) => rows.map((row) => row.getAttribute('data-state')))
  expect(states.every((state) => state === 'missing')).toBe(true)
  await expect(page.getByTestId('models-delete')).toBeDisabled()
})

test('backup round trip: export with demo data, erase everything, restore from the file', async ({ page }, info) => {
  test.setTimeout(240_000)
  const errors = collectErrors(page)
  // The Ptáci list looks up reference photos for the sound catches: a pretend Wikipedia keeps the test off the network.
  await mockWikimedia(page)
  await seedDemo(page)
  await page.goto('/#/birds')
  await expect(page.getByTestId('birds-shown')).toHaveText('30 ptáků')
  await page.goto('/#/settings')

  const download = page.waitForEvent('download')
  await page.getByTestId('backup-export').click()
  const file = await download
  const path = info.outputPath('backup.zip')
  await file.saveAs(path)
  expect(file.suggestedFilename()).toMatch(/\.zip$/)
  await expect(page.getByTestId('backup-message')).toHaveAttribute('data-tone', 'success')
  await expect(page.getByTestId('backup-last')).not.toContainText('ještě')

  await page.getByTestId('erase-start').click()
  await page.getByRole('button', { name: 'Pokračovat' }).click()
  await page.getByRole('button', { name: 'Ano, smazat vše' }).click()
  await expect(page.getByText('Všechna data jsou smazaná. Dex je prázdný.')).toBeVisible({ timeout: 30_000 })

  await page.getByTestId('backup-file').setInputFiles(path)
  await expect(page.getByTestId('backup-message')).toHaveAttribute('data-tone', 'success', { timeout: 60_000 })
  await expect(page.getByTestId('backup-message')).toContainText('30')
  await page.goto('/#/birds')
  await expect(page.getByTestId('birds-shown')).toHaveText('30 ptáků')
  await page.goto('/#/settings')

  // Restoring the same file again adds nothing.
  await page.getByTestId('backup-file').setInputFiles(path)
  await expect(page.getByTestId('backup-message')).toContainText('nic nového', { timeout: 60_000 }).catch(() => undefined)
  await page.goto('/#/birds')
  await expect(page.getByTestId('birds-shown')).toHaveText('30 ptáků')
  expect(errors).toEqual([])
})

test('a broken file is refused with a calm message', async ({ page }) => {
  await page.goto('/#/settings')
  await page.getByTestId('backup-file').setInputFiles({ name: 'x.zip', mimeType: 'application/zip', buffer: Buffer.from('not a zip') })
  await expect(page.getByTestId('backup-message')).toHaveAttribute('data-tone', 'error', { timeout: 30_000 })
})

test('the about page lists the credits and licences', async ({ page }) => {
  await page.goto('/#/about')
  const body = page.locator('main, [data-testid="screen"]').first()
  for (const text of ['BirdNET', 'WingCLIP', 'BioCLIP', 'Wikipedi', 'CC BY-NC-SA 4.0', 'CC BY-NC 4.0']) await expect(body).toContainText(text)
  await expect(page.getByTestId('about-gift')).toBeVisible()
  await expect(page.getByTestId('about-privacy')).toBeVisible()
  await expect(page.getByTestId('dedication')).toHaveCount(0)
})

for (const size of SIZES) {
  test(`settings and about screenshots at ${size.width}x${size.height}`, async ({ page }) => {
    await page.setViewportSize(size)
    await seedDemo(page)
    for (const [route, name] of [['/#/settings', 'settings'], ['/#/about', 'about']] as const) {
      await page.goto(route)
      await page.waitForTimeout(800)
      const screen = page.getByTestId('screen')
      await page.screenshot({ path: `test-shots/${name}-top-${size.width}.png` })
      await screen.evaluate((el) => el.scrollTo(0, el.scrollHeight / 2))
      await page.screenshot({ path: `test-shots/${name}-mid-${size.width}.png` })
      await screen.evaluate((el) => el.scrollTo(0, el.scrollHeight))
      await page.screenshot({ path: `test-shots/${name}-end-${size.width}.png` })
      expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false)
    }
  })
}
