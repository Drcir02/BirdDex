import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { build } from 'vite'
import { skipWelcome } from './shell-helpers'

// The Dex data (public/data/species.json and src/data) in a real browser: the built site serves the file with the
// Czech letters intact, the loader keeps a copy in Cache Storage that works with no network, and Chromium's own
// Czech sorting and the accent-free search give the answers the Dex screens depend on.

type Data = typeof import('./helpers/data-entry')
declare global {
  interface Window {
    BirdDexData: Data
  }
}

const port = process.env.E2E_PORT ?? '4173'
const bundle = `test-results/data-bundle-${port}/data.js`
const expected = JSON.parse(readFileSync('public/data/species.json', 'utf8')) as { id: string; czechName: string | null; dexNumber: number }[]

test.beforeAll(async () => {
  await build({
    configFile: false,
    logLevel: 'silent',
    define: { 'process.env.NODE_ENV': '"production"' },
    build: {
      outDir: `test-results/data-bundle-${port}`,
      emptyOutDir: true,
      minify: false,
      lib: { entry: 'tests/e2e/helpers/data-entry.ts', formats: ['iife'], name: 'BirdDexData', fileName: () => 'data.js' },
    },
  })
})

/** Opens a page of the app and puts the data modules next to it. */
async function open(page: Page) {
  await skipWelcome(page)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/#/field-check')
  await page.addScriptTag({ path: bundle })
  const started = await page.waitForFunction(() => window.BirdDexData !== undefined, undefined, { timeout: 15_000 }).then(
    () => true,
    () => false,
  )
  expect(started, `the data bundle did not start: ${errors.join('; ')}`).toBe(true)
}

test('the built site serves the species file as JSON with the Czech letters intact', async ({ request }) => {
  const response = await request.get('/data/species.json')
  expect(response.status()).toBe(200)
  expect(response.headers()['content-type']).toContain('json')
  const list = (await response.json()) as typeof expected
  expect(list.length).toBe(expected.length)
  expect(list.length).toBeGreaterThanOrEqual(400)
  const tit = list.find((species) => species.id === 'parus-major')
  expect(tit?.czechName).toBe('Sýkora koňadra')
  expect(list.map((species) => species.dexNumber)).toEqual(list.map((_, index) => index + 1))
})

test('loadSpecies fetches the file once, and the Dex then opens with no network', async ({ page, context }) => {
  await open(page)
  const first = await page.evaluate(async () => {
    const data = window.BirdDexData
    await caches.delete(data.SPECIES_CACHE_NAME)
    const [a, b] = await Promise.all([data.loadSpecies(), data.loadSpecies()])
    const cached = await (await caches.open(data.SPECIES_CACHE_NAME)).keys()
    return { count: a.length, same: a === b, cachedUrls: cached.map((request) => request.url), first: a[0].id }
  })
  expect(first.count).toBe(expected.length)
  expect(first.same).toBe(true)
  expect(first.first).toBe(expected[0].id)
  expect(first.cachedUrls).toHaveLength(1)
  expect(first.cachedUrls[0]).toMatch(/\/data\/species\.json$/)

  await context.setOffline(true)
  const offline = await page.evaluate(async () => {
    const list = await window.BirdDexData.fetchSpeciesList()
    return { count: list.length, tit: list.find((species) => species.id === 'parus-major')?.czechName }
  })
  await context.setOffline(false)
  expect(offline).toEqual({ count: expected.length, tit: 'Sýkora koňadra' })
})

test('with no network and no copy the loader fails with a clear reason', async ({ page, context }) => {
  await open(page)
  await page.evaluate((name) => caches.delete(name), 'birddex-data-v1')
  await context.setOffline(true)
  const outcome = await page.evaluate(async () => {
    try {
      await window.BirdDexData.fetchSpeciesList()
      return 'loaded'
    } catch (error) {
      return (error as { reason?: string }).reason ?? 'other'
    }
  })
  await context.setOffline(false)
  expect(outcome).toBe('network')
})

test('Chromium sorts Czech names in Czech order and the search ignores accents', async ({ page }) => {
  await open(page)
  const result = await page.evaluate(async () => {
    const data = window.BirdDexData
    const list = await data.loadSpecies()
    const sorted = data.sortSpecies(list, 'name').map(data.displayName)
    const firstWith = (prefix: string) => sorted.findIndex((name) => name.startsWith(prefix))
    return {
      cBeforeCaron: firstWith('Cvrčilka') < firstWith('Čáp'),
      hBeforeCh: sorted.findIndex((name) => name.startsWith('Hrdlička')) < firstWith('Chřástal'),
      chBeforeI: firstWith('Chřástal') < firstWith('Ibis') || firstWith('Ibis') === -1,
      first: sorted[0],
      withAccents: data.searchSpecies(list, 'Sýkora koňadra')[0]?.id,
      without: data.searchSpecies(list, 'sykora konadra')[0]?.id,
      upper: data.searchSpecies(list, 'KOŇADRA')[0]?.id,
      english: data.searchSpecies(list, 'great tit')[0]?.id,
      family: data.familyNameCs(list.find((species) => species.id === 'parus-major')?.family ?? null),
    }
  })
  expect(result.cBeforeCaron).toBe(true)
  expect(result.hBeforeCh).toBe(true)
  expect(result.chBeforeI).toBe(true)
  expect(result.first).toMatch(/^A/)
  expect(result.withAccents).toBe('parus-major')
  expect(result.without).toBe('parus-major')
  expect(result.upper).toBe('parus-major')
  expect(result.english).toBe('parus-major')
  expect(result.family).toBe('sýkorovití')
})
