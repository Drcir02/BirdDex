import type { Page } from '@playwright/test'

/** The localStorage flag the welcome screen sets (src/app/constants.ts). */
export const WELCOMED_KEY = 'birddex:welcomed'

/**
 * Makes the app behave as if the welcome screen was already seen, for every page load of this test.
 * Without it, every address redirects to /#/welcome on the first visit. Call it before page.goto().
 */
export async function skipWelcome(page: Page): Promise<void> {
  await page.addInitScript((key) => window.localStorage.setItem(key, '1'), WELCOMED_KEY)
}

/** Collects console errors and uncaught exceptions of a page. */
export function collectErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console.error: ${message.text()}`)
  })
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`))
  return errors
}
