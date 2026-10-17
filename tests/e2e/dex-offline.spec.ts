import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { createServer, type Server } from 'node:https'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { seedDemo } from './dex-helpers'
import { skipWelcome } from './shell-helpers'

// The service worker rule for Wikimedia pictures, run for real. This machine cannot reach Wikimedia, so a small HTTPS
// server on this machine plays upload.wikimedia.org, en.wikipedia.org and commons.wikimedia.org (the browser is told to send
// those three names to it, and to trust its throw-away certificate). Then: the picture is shown, the service worker keeps
// it in the cache birddex-photos-v1 as a readable response, and after the "network" is gone and the app is reloaded, the
// bird still shows its photo with its credit.

const appPort = Number(process.env.E2E_PORT ?? 4173)
const fakePort = appPort + 200
const HOSTS = ['upload.wikimedia.org', 'en.wikipedia.org', 'commons.wikimedia.org']

test.use({
  serviceWorkers: 'allow',
  ignoreHTTPSErrors: true,
  viewport: { width: 390, height: 844 },
  launchOptions: {
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: [
      '--autoplay-policy=no-user-gesture-required',
      // Chromium would send https requests to a proxy from the environment (as it does on the cloud machine) by name,
      // and the name mapping below would never be used.
      '--no-proxy-server',
      // The service worker makes its own requests, and the "ignoreHTTPSErrors" of the test context does not reach them.
      '--ignore-certificate-errors',
      `--host-resolver-rules=${HOSTS.map((host) => `MAP ${host} 127.0.0.1:${fakePort}`).join(', ')}`,
    ],
  },
})

let server: Server | undefined
let folder = ''
let tls: { key: Buffer; cert: Buffer } | undefined
let asked: string[] = []
/** Whether the pretend upload server lets a page read its pictures (the CORS header). Wikimedia does. */
let corsOpen = true

const picture = (name: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="330" height="220" viewBox="0 0 330 220"><rect width="330" height="220" fill="#7aa86a"/><circle cx="200" cy="95" r="46" fill="#222"/><text x="12" y="206" font-size="18" fill="#fff">${name}</text></svg>`

function handle(request: IncomingMessage, response: ServerResponse) {
  const host = request.headers.host?.split(':')[0] ?? ''
  const url = request.url ?? ''
  asked.push(`${host}${url}`)
  const cors = { 'access-control-allow-origin': '*' }
  if (host === 'en.wikipedia.org' && url.includes('/page/summary/')) {
    const title = decodeURIComponent(url.split('/summary/')[1]).replace(/_/g, ' ')
    const file = `${title.replace(/[^A-Za-z0-9]+/g, '_')}.jpg`
    response.writeHead(200, { ...cors, 'content-type': 'application/json' })
    response.end(JSON.stringify({ type: 'standard', title, thumbnail: { source: `https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/${file}/330px-${file}`, width: 330, height: 220 } }))
  } else if (host === 'commons.wikimedia.org') {
    response.writeHead(200, { ...cors, 'content-type': 'application/json' })
    response.end(
      JSON.stringify({
        query: { pages: [{ imageinfo: [{ extmetadata: { Artist: { value: '<a href="//commons.wikimedia.org/wiki/User:Jan">Jan Novák</a>' }, LicenseShortName: { value: 'CC BY-SA 4.0' }, License: { value: 'cc-by-sa-4.0' } } }] }] },
      }),
    )
  } else if (host === 'upload.wikimedia.org') {
    response.writeHead(200, { ...(corsOpen ? cors : {}), 'content-type': 'image/svg+xml', 'cache-control': 'public, max-age=86400' })
    response.end(picture(decodeURIComponent(url.split('/').slice(-1)[0])))
  } else {
    response.writeHead(404, cors)
    response.end('not found')
  }
}

async function startServer() {
  if (!tls) throw new Error('The certificate is not made')
  server = createServer(tls, handle)
  await new Promise<void>((resolve, reject) => {
    server?.once('error', reject)
    server?.listen(fakePort, '127.0.0.1', resolve)
  })
}

async function stopServer() {
  const running = server
  server = undefined
  if (!running) return
  running.closeAllConnections()
  await new Promise<void>((resolve) => running.close(() => resolve()))
}

test.beforeAll(() => {
  folder = mkdtempSync(join(tmpdir(), 'birddex-tls-'))
  const key = join(folder, 'key.pem')
  const cert = join(folder, 'cert.pem')
  execFileSync(
    'openssl',
    ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '2', '-subj', '/CN=upload.wikimedia.org', '-addext', `subjectAltName=${HOSTS.map((host) => `DNS:${host}`).join(',')}`],
    { stdio: 'ignore' },
  )
  tls = { key: readFileSync(key), cert: readFileSync(cert) }
})

test.beforeEach(async () => {
  asked = []
  corsOpen = true
  await startServer()
})

test.afterEach(async () => {
  await stopServer()
})

test.afterAll(() => {
  if (folder) rmSync(folder, { recursive: true, force: true })
})

test('the service worker keeps a Wikimedia picture, and the bird shows it again with no network at all', async ({ page }) => {
  await skipWelcome(page)
  await page.goto('/#/dev/demo')
  // The service worker takes charge of the page a moment after the first visit.
  await page.waitForFunction(() => navigator.serviceWorker?.controller !== null && navigator.serviceWorker?.controller !== undefined, undefined, { timeout: 30_000 })
  await seedDemo(page)

  await page.goto('/#/species/bubo-bubo')
  const credit = page.getByTestId('photo-credit')
  await expect(credit).toContainText('Foto: Jan Novák')
  const photo = page.getByTestId('species-photo').locator('img')
  await expect.poll(() => photo.evaluate((element: HTMLImageElement) => element.naturalWidth), { timeout: 15_000 }).toBeGreaterThan(0)
  const wide = asked.filter((entry) => entry.startsWith('upload.wikimedia.org') && entry.includes('/500px-'))
  expect(wide).toHaveLength(1)

  // The picture is in the cache of the photos, as a normal answer (not an opaque one, which would count for megabytes of quota).
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const cache = await caches.open('birddex-photos-v1')
          for (const request of await cache.keys()) {
            const answer = await cache.match(request)
            if (/^https:\/\/upload\.wikimedia\.org\/.*\/500px-Eurasian_eagle_owl\.jpg$/.test(request.url)) return `${answer?.type} ${answer?.status}`
          }
          return 'not cached'
        }),
      { timeout: 15_000 },
    )
    .toBe('cors 200')

  // No network any more: the fake servers are shut down.
  await stopServer()
  const before = asked.length

  await page.reload()
  await expect(page.getByTestId('species-name')).toHaveText('Výr velký')
  await expect(page.getByTestId('photo-credit')).toContainText('Foto: Jan Novák')
  const again = page.getByTestId('species-photo').locator('img')
  await expect.poll(() => again.evaluate((element: HTMLImageElement) => element.naturalWidth), { timeout: 15_000 }).toBeGreaterThan(0)
  expect(asked.length).toBe(before)
  await expect(page.getByTestId('catch-item')).toHaveCount(1)
})

test('a picture still shows when the server does not let a page read it (no CORS): the plain request is the last try', async ({ page }) => {
  corsOpen = false
  await skipWelcome(page)
  await page.goto('/#/dev/demo')
  await page.waitForFunction(() => navigator.serviceWorker?.controller !== null && navigator.serviceWorker?.controller !== undefined, undefined, { timeout: 30_000 })
  await seedDemo(page)

  await page.goto('/#/species/bubo-bubo')
  await expect(page.getByTestId('photo-credit')).toContainText('Foto: Jan Novák')
  const photo = page.getByTestId('species-photo').locator('img')
  // The tries that need CORS fail, so the picture ends up loaded the plain way, with no crossorigin on the element.
  await expect.poll(() => photo.evaluate((element: HTMLImageElement) => element.naturalWidth), { timeout: 20_000 }).toBeGreaterThan(0)
  await expect(photo).not.toHaveAttribute('crossorigin', /.*/)
  expect(asked.filter((entry) => entry.startsWith('upload.wikimedia.org')).length).toBeGreaterThanOrEqual(2)
})
