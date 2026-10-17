import { test } from '@playwright/test'
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, openApp, ROOT } from './scan-helpers'

// A new version of the app is installed in the background but never reloads the page by itself: a reload in the middle of a
// scan or on the result screen would lose the work. The banner "Je tu nová verze" offers the reload when nothing is in progress.
//
// The test changes the byte content of the built service worker (dist-e2e-<port>/sw.js), asks the browser to look for an
// update, and puts the file back at the end.

const PORT = Number(process.env.E2E_PORT ?? 4173)
const SW_FILE = join(ROOT, `dist-e2e-${PORT}`, 'sw.js')

test.use({ viewport: { width: 390, height: 844 } })

test('a new version waits for a safe moment instead of reloading the page', async ({ page }) => {
  const original = readFileSync(SW_FILE)
  try {
    await openApp(page, '/', { delay: 30 })
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined))
    await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null), { timeout: 20_000 }).toBe(true)
    await page.evaluate(() => {
      ;(window as unknown as { __marker: number }).__marker = 42
    })

    // "Deploy" a new version, and let the browser notice it.
    appendFileSync(SW_FILE, `\n// new version ${Date.now()}\n`)
    await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration()
      await registration?.update()
    })

    // On the Dex the banner appears, and the page stays as it is.
    await expect(page.getByTestId('update-banner')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByTestId('update-banner')).toContainText('Je tu nová verze')
    await page.waitForTimeout(3000)
    expect(await page.evaluate(() => (window as unknown as { __marker?: number }).__marker)).toBe(42)

    // During a scan it stays away, and the page still does not reload.
    await page.evaluate(() => {
      window.location.hash = '#/scan/sound'
    })
    await expect(page.getByRole('heading', { level: 1 }).first()).toHaveText('Poslech')
    await expect(page.getByTestId('update-banner')).toHaveCount(0)
    await page.waitForTimeout(1500)
    expect(await page.evaluate(() => (window as unknown as { __marker?: number }).__marker)).toBe(42)

    // Back in the settings the button takes the new version into use: this time the page reloads.
    await page.evaluate(() => {
      window.location.hash = '#/settings'
    })
    await expect(page.getByTestId('update-banner')).toBeVisible()
    await page.getByTestId('update-banner').getByRole('button', { name: 'Načíst znovu' }).click()
    // The page is gone and a new one starts: asking during the switch fails once or twice, which only means "not yet".
    const marker = () => page.evaluate(() => (window as unknown as { __marker?: number }).__marker ?? 'gone').catch(() => 'switching')
    await expect.poll(marker, { timeout: 20_000 }).toBe('gone')
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible()
  } finally {
    writeFileSync(SW_FILE, original)
  }
})
