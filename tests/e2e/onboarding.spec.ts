import { expect, test } from '@playwright/test'
import { collectErrors, WELCOMED_KEY } from './shell-helpers'

const SIZES = [
  { width: 390, height: 844 },
  { width: 360, height: 800 },
]

test('first run: every address leads to the welcome screen, which steps through and sets the flag', async ({ page }) => {
  const errors = collectErrors(page)
  await page.goto('/#/settings')
  await expect(page).toHaveURL(/#\/welcome$/)
  const step = page.getByTestId('onboarding-step')
  await expect(step).toHaveAttribute('data-index', '1')
  await expect(page.getByTestId('onboarding-idea')).toBeVisible()

  await page.getByTestId('onboarding-next').click()
  await expect(page.getByTestId('onboarding-device')).toBeVisible()
  await expect(page.getByTestId('onboarding-device')).toContainText('90 MB')
  await page.getByTestId('onboarding-next').click()
  await expect(page.getByTestId('onboarding-permissions')).toBeVisible()
  for (const kind of ['microphone', 'camera', 'location']) await expect(page.getByTestId(`permission-${kind}`)).toBeVisible()
  await page.getByTestId('onboarding-back').click()
  await expect(step).toHaveAttribute('data-index', '2')
  await page.getByTestId('onboarding-next').click()
  await page.getByTestId('onboarding-next').click()
  await expect(page.getByTestId('onboarding-install')).toBeVisible()
  await expect(page.getByTestId('onboarding-finish')).toBeVisible()

  await page.getByTestId('onboarding-finish').click()
  await expect(page).toHaveURL(/#\/$/)
  expect(await page.evaluate((key) => window.localStorage.getItem(key), WELCOMED_KEY)).toBeTruthy()
  await page.goto('/#/settings')
  await expect(page).toHaveURL(/#\/settings$/)
  expect(errors).toEqual([])
})

test('skipping also finishes the welcome', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveURL(/#\/welcome$/)
  await page.getByTestId('onboarding-skip').click()
  await expect(page).toHaveURL(/#\/$/)
  expect(await page.evaluate((key) => window.localStorage.getItem(key), WELCOMED_KEY)).toBeTruthy()
})

test('the install step shows the iPhone instructions on iOS Safari', async ({ browser }) => {
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
    viewport: SIZES[0],
  })
  const page = await context.newPage()
  await page.goto('http://localhost:' + (process.env.E2E_PORT ?? '4173') + '/#/welcome')
  for (let i = 0; i < 3; i++) await page.getByTestId('onboarding-next').click()
  await expect(page.getByTestId('onboarding-install')).toContainText('Přidat na plochu')
  await context.close()
})

for (const size of SIZES) {
  test(`welcome screenshots at ${size.width}x${size.height}`, async ({ page }) => {
    await page.setViewportSize(size)
    await page.goto('/')
    for (let i = 1; i <= 4; i++) {
      await expect(page.getByTestId('onboarding-step')).toHaveAttribute('data-index', String(i))
      await page.screenshot({ path: `test-shots/onboarding-${i}-${size.width}.png` })
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
      expect(overflow).toBe(false)
      if (i < 4) await page.getByTestId('onboarding-next').click()
    }
  })
}
