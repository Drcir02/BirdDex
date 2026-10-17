import { expect, test, type Page } from '@playwright/test'
import { WELCOMED_KEY, collectErrors, skipWelcome } from './shell-helpers'

// Every screen of the route table (BRIEF section 4), reached by address.
const SCREENS = [
  '/',
  '/species/parus-major',
  '/scan',
  '/scan/sound',
  '/scan/photo',
  '/scan/live',
  '/result',
  '/settings',
  '/about',
  '/welcome',
  '/ui-kit',
  '/there-is-nothing-here',
]

const nav = (page: Page) => page.getByRole('navigation', { name: 'Hlavní nabídka' })
const heading = (page: Page) => page.getByRole('heading', { level: 1 }).first()
const openScreen = async (page: Page, path: string) => {
  await page.goto(`/#${path}`)
  await expect(heading(page)).toBeVisible()
}

test.describe('first run', () => {
  test('sends a new visitor to the welcome screen, from any address', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveURL(/#\/welcome$/)
    await expect(heading(page)).toBeVisible()
    await expect(page.getByTestId('device')).toBeVisible()

    await page.goto('/#/scan')
    await expect(page).toHaveURL(/#\/welcome$/)
  })

  test('hides the navigation on the welcome screen', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveURL(/#\/welcome$/)
    await expect(nav(page)).toHaveCount(0)
  })

  test('opens the Dex once the welcome flag is set, and keeps it', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveURL(/#\/welcome$/)
    await page.evaluate((key) => window.localStorage.setItem(key, '1'), WELCOMED_KEY)
    await page.goto('/#/')
    await expect(page).toHaveURL(/#\/$/)
    await expect(nav(page)).toBeVisible()
    await page.reload()
    await expect(page).toHaveURL(/#\/$/)
  })

  test('lets the field check and the component kit open without the welcome screen', async ({ page }) => {
    await page.goto('/#/field-check')
    await expect(page).toHaveURL(/#\/field-check$/)
    await page.goto('/#/ui-kit')
    await expect(page).toHaveURL(/#\/ui-kit$/)
  })
})

test.describe('the device shell', () => {
  test.beforeEach(async ({ page }) => {
    await skipWelcome(page)
  })

  test('goes straight to the Dex for a returning visitor', async ({ page }) => {
    await page.goto('/')
    await expect(page).not.toHaveURL(/welcome/)
    await expect(page.getByTestId('nav-dex')).toHaveAttribute('aria-current', 'page')
    await expect(page).toHaveTitle('Dex · BirdDex')
  })

  test('reaches every section through the bottom navigation', async ({ page }) => {
    await page.goto('/')
    await expect(heading(page)).toBeVisible()
    const links = nav(page).getByRole('link')
    await expect(links).toHaveText(['Dex', 'Skenovat', 'Nastavení'])

    await page.getByTestId('nav-scan').click()
    await expect(page).toHaveURL(/#\/scan$/)
    await expect(page.getByTestId('nav-scan')).toHaveAttribute('aria-current', 'page')
    await expect(page.getByTestId('nav-dex')).not.toHaveAttribute('aria-current', 'page')
    await expect(heading(page)).toBeVisible()
    await expect(page).toHaveTitle('Skenovat · BirdDex')

    await page.getByTestId('nav-settings').click()
    await expect(page).toHaveURL(/#\/settings$/)
    await expect(page.getByTestId('nav-settings')).toHaveAttribute('aria-current', 'page')
    await expect(heading(page)).toBeVisible()
    await expect(page).toHaveTitle('Nastavení · BirdDex')

    await page.getByTestId('nav-dex').click()
    await expect(page).toHaveURL(/#\/$/)
    await expect(page.getByTestId('nav-dex')).toHaveAttribute('aria-current', 'page')
    await expect(heading(page)).toBeVisible()
  })

  test('keeps the right button lit on the screens under a section', async ({ page }) => {
    for (const [path, id] of [
      ['/species/parus-major', 'nav-dex'],
      ['/scan/sound', 'nav-scan'],
      ['/scan/photo', 'nav-scan'],
      ['/scan/live', 'nav-scan'],
      ['/about', 'nav-settings'],
    ] as const) {
      await openScreen(page, path)
      await expect(page.getByTestId(id), path).toHaveAttribute('aria-current', 'page')
    }
  })

  test('shows a screen with a title for every route, inside the shell', async ({ page }) => {
    for (const path of SCREENS) {
      await openScreen(page, path)
      await expect(heading(page), path).not.toBeEmpty()
      await expect(page.getByTestId('device'), path).toBeVisible()
      await expect(page.getByTestId('screen'), path).toBeVisible()
    }
  })

  test('shows a friendly page with a way back for an unknown address', async ({ page }) => {
    await openScreen(page, '/there-is-nothing-here')
    await expect(heading(page)).toHaveText('Tady nic není')
    await page.getByRole('link', { name: 'Zpět do Dexu' }).click()
    await expect(page).toHaveURL(/#\/$/)
  })

  test('keeps the field check page reachable, outside the shell and with its own look', async ({ page }) => {
    await page.goto('/#/field-check')
    await expect(page.getByRole('heading', { name: 'Field check' })).toBeVisible()
    await expect(page.getByTestId('device')).toHaveCount(0)
    await expect(page.locator('.fc-root')).toBeVisible()
  })

  test('keeps the old field check styles out of the device (and the device out of the field check)', async ({ page }) => {
    // Visit the field check first, so its stylesheet is loaded when the device shows up.
    await page.goto('/#/field-check')
    await expect(page.getByRole('heading', { name: 'Field check' })).toBeVisible()
    const checkButton = await page.locator('.fc-root button').first().evaluate((element) => getComputedStyle(element).backgroundColor)
    await page.evaluate(() => {
      window.location.hash = '#/ui-kit'
    })
    await expect(heading(page)).toBeVisible()
    const chip = page.locator('.bd-chip').first()
    await expect(chip).toBeVisible()
    expect(await chip.evaluate((element) => getComputedStyle(element).borderRadius)).toBe('6px')
    const deviceButton = await page.locator('.bd-btn--secondary').first().evaluate((element) => getComputedStyle(element).backgroundColor)
    expect(deviceButton).not.toBe(checkButton)
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(26, 12, 15)')
  })

  test('has no horizontal scroll at 360 px on any screen', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 })
    for (const path of [...SCREENS, '/field-check']) {
      await page.goto(`/#${path}`)
      await expect(page.locator('h1').first(), path).toBeVisible()
      const overflow = await page.evaluate(() => {
        const screenArea = document.querySelector('.bd-lcd')
        return {
          page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          body: document.body.scrollWidth - document.body.clientWidth,
          screen: screenArea ? screenArea.scrollWidth - screenArea.clientWidth : 0,
        }
      })
      expect(overflow, path).toEqual({ page: 0, body: 0, screen: 0 })
    }
  })

  test('copes with a very narrow phone (320 px) and a small landscape phone', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 })
    await openScreen(page, '/ui-kit')
    expect(await page.evaluate(() => document.querySelector('.bd-lcd')!.scrollWidth - document.querySelector('.bd-lcd')!.clientWidth)).toBe(0)

    await page.setViewportSize({ width: 844, height: 390 })
    for (const path of ['/', '/scan', '/ui-kit']) {
      await openScreen(page, path)
      await expect(nav(page)).toBeVisible()
      const box = await page.getByTestId('screen').boundingBox()
      expect(box?.height ?? 0, path).toBeGreaterThan(250)
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), path).toBe(0)
    }
  })

  test('has no console errors while walking through every screen', async ({ page }) => {
    const errors = collectErrors(page)
    for (const path of [...SCREENS, '/field-check']) await openScreen(page, path)
    await page.goto('/#/ui-kit')
    await page.getByRole('button', { name: 'Otevřít dialog' }).click()
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Chyba', exact: true }).first().click()
    expect(errors).toEqual([])
  })

  test('makes every button, link and toggle in the navigation and the kit at least 44 px', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 })
    await openScreen(page, '/ui-kit')
    const { measured, small } = await page.evaluate(() => {
      const found: string[] = []
      const controls = document.querySelectorAll<HTMLElement>(
        '.bd-nav a, .bd-btn, .bd-iconbtn, button.bd-chip, .bd-pageheader a, .bd-seg__item, .bd-switch, .bd-search__input',
      )
      controls.forEach((element) => {
        const rect = element.getBoundingClientRect()
        if (rect.width < 43.5 || rect.height < 43.5) found.push(`${element.className} "${element.textContent?.trim() ?? ''}" ${Math.round(rect.width)}x${Math.round(rect.height)}`)
      })
      return { measured: controls.length, small: found }
    })
    expect(measured).toBeGreaterThan(25)
    expect(small).toEqual([])
  })

  test('lights follow the status a screen declares', async ({ page }) => {
    await openScreen(page, '/ui-kit')
    const device = page.getByTestId('device')
    await expect(device).toHaveAttribute('data-status', 'idle')
    await expect(page.getByTestId('leds')).toHaveText('Stav přístroje: Připraveno')
    for (const [label, status] of [
      ['Poslouchám', 'listening'],
      ['Přemýšlím', 'busy'],
      ['Povedlo se', 'success'],
    ] as const) {
      await page.getByRole('button', { name: label, exact: true }).last().click()
      await expect(device).toHaveAttribute('data-status', status)
      await expect(page.getByTestId('leds')).toContainText(label)
    }
    await page.getByRole('button', { name: 'Vypnout' }).click()
    await expect(device).toHaveAttribute('data-status', 'idle')
  })

  test('leaving a screen puts the lights back to idle', async ({ page }) => {
    await openScreen(page, '/ui-kit')
    await page.getByRole('button', { name: 'Poslouchám', exact: true }).click()
    await expect(page.getByTestId('device')).toHaveAttribute('data-status', 'listening')
    await page.getByTestId('nav-scan').click()
    await expect(page.getByTestId('device')).toHaveAttribute('data-status', 'idle')
  })

  test('stops the light animations when the person asked for less motion', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await openScreen(page, '/ui-kit')
    await page.getByRole('button', { name: 'Poslouchám', exact: true }).click()
    await expect(page.getByTestId('device')).toHaveAttribute('data-status', 'listening')
    const duration = await page.locator('.bd-led--red').evaluate((element) => getComputedStyle(element).animationDuration)
    expect(parseFloat(duration)).toBeLessThan(0.01)
    // The red light is still lit, so the status can be read without any motion.
    const glow = await page.locator('.bd-led--red').evaluate((element) => getComputedStyle(element).boxShadow)
    expect(glow).not.toBe('none')
  })

  test('traps focus in the dialog, closes it with Escape and returns focus', async ({ page }) => {
    await openScreen(page, '/ui-kit')
    const opener = page.getByRole('button', { name: 'Otevřít dialog' })
    await opener.click()
    const dialog = page.getByRole('alertdialog', { name: /Chytit/ })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Potvrdit' })).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(dialog.getByRole('button', { name: 'Zrušit' })).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(dialog.getByRole('button', { name: 'Potvrdit' })).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(opener).toBeFocused()
  })

  test('shows a toast and removes it by itself', async ({ page }) => {
    await openScreen(page, '/ui-kit')
    await page.getByRole('button', { name: 'Zpráva', exact: true }).click()
    const toast = page.getByText('Tohle je obyčejná zpráva.')
    await expect(toast).toBeVisible()
    await expect(toast).toBeHidden({ timeout: 10_000 })
  })

  test('returns to the same place in a long screen when going back', async ({ page }) => {
    await openScreen(page, '/ui-kit')
    await page.getByTestId('screen').evaluate((element) => {
      element.scrollTop = 900
    })
    await expect.poll(() => page.getByTestId('screen').evaluate((element) => element.scrollTop)).toBeGreaterThan(800)
    await page.getByTestId('nav-scan').click()
    await expect(page).toHaveURL(/#\/scan$/)
    await expect.poll(() => page.getByTestId('screen').evaluate((element) => element.scrollTop)).toBe(0)
    await page.goBack()
    await expect(page).toHaveURL(/#\/ui-kit$/)
    await expect.poll(() => page.getByTestId('screen').evaluate((element) => element.scrollTop)).toBeGreaterThan(800)
  })

  test('loads the pixel fonts with every Czech letter', async ({ page }) => {
    await openScreen(page, '/ui-kit')
    await page.evaluate(() => document.fonts.ready)
    const loaded = await page.evaluate(() => {
      const letters = 'ěščřžýáíéúůďťňó ĚŠČŘŽÝÁÍÉÚŮĎŤŇÓ'
      return {
        display: document.fonts.check('16px "Press Start 2P"', letters),
        lcd: document.fonts.check('22px VT323', letters),
      }
    })
    expect(loaded).toEqual({ display: true, lcd: true })
    await expect(page.getByText('Příliš žluťoučký kůň úpěl ďábelské ódy.').first()).toBeVisible()
  })

  test('paints the browser bar in the red of the device', async ({ page }) => {
    await openScreen(page, '/')
    const { meta, token } = await page.evaluate(() => ({
      meta: document.querySelector('meta[name="theme-color"]')?.getAttribute('content'),
      token: getComputedStyle(document.documentElement).getPropertyValue('--shell-bar').trim(),
    }))
    expect(meta).toBe(token)
  })
})

test.describe('when a screen cannot be downloaded', () => {
  // Playwright cannot intercept requests that a service worker handles, so keep the worker out of this test.
  test.use({ serviceWorkers: 'block' })

  test('shows a calm message, keeps the device around it and heals when the person moves on', async ({ page }) => {
    await skipWelcome(page)
    await page.route('**/assets/ScanPage-*.js', (route) => route.abort())
    await page.goto('/#/')
    await expect(heading(page)).toBeVisible()

    await page.getByTestId('nav-scan').click()
    const alert = page.getByRole('alert')
    await expect(alert).toContainText('Ale ne, něco se pokazilo')
    await expect(alert).toContainText('Nepodařilo se načíst část aplikace')
    await expect(alert.getByRole('button', { name: 'Načíst znovu' })).toBeVisible()
    await expect(page.getByTestId('device')).toBeVisible()
    await expect(nav(page)).toBeVisible()

    await page.getByTestId('nav-settings').click()
    await expect(page.getByRole('alert')).toHaveCount(0)
    await expect(heading(page)).toBeVisible()
  })
})
