import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { build } from 'vite'

// The core modules (database, backup, model store, location, fakes) have no screen of their own yet, so these tests
// bundle them for the browser and call them inside a real Chromium page. That checks what unit tests cannot:
// real IndexedDB with blobs, real Cache Storage, real streaming downloads and checksums, real geolocation.

type Core = typeof import('./helpers/core-entry')
declare global {
  interface Window {
    BirdDexCore: Core
  }
}

const port = process.env.E2E_PORT ?? '4173'
const bundle = `test-results/core-bundle-${port}/core.js`
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
const haveModels = existsSync('public/models/manifest.json')

test.beforeAll(async () => {
  await build({
    configFile: false,
    logLevel: 'silent',
    // Library builds leave process.env.NODE_ENV alone (React reads it), and a page has no `process`.
    define: { __APP_VERSION__: '"e2e"', __BUILD_TIME__: '"e2e"', 'process.env.NODE_ENV': '"production"' },
    build: {
      outDir: `test-results/core-bundle-${port}`,
      emptyOutDir: true,
      minify: false,
      lib: { entry: 'tests/e2e/helpers/core-entry.ts', formats: ['iife'], name: 'BirdDexCore', fileName: () => 'core.js' },
    },
  })
})

/** Opens a page of the app and puts the core modules next to it. */
async function open(page: Page, path = '/#/field-check') {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(path)
  await page.addScriptTag({ path: bundle })
  const started = await page.waitForFunction(() => window.BirdDexCore !== undefined, undefined, { timeout: 15_000 }).then(
    () => true,
    () => false,
  )
  expect(started, `the core bundle did not start: ${errors.join('; ')}`).toBe(true)
}

test.describe('database and backup in a real browser', () => {
  test('a catch with a photo and one with a clip survive a backup and a restore, byte for byte', async ({ page }) => {
    await open(page)
    const photo = readFileSync('tests/fixtures/photos/House_sparrow_bathing_in_mosaic_fountain_Park_Ridge.jpg')
    const clip = readFileSync('tests/fixtures/audio/birdnet-demo-sample.wav')

    const result = await page.evaluate(
      async ({ photoBase64, clipBase64 }) => {
        const core = window.BirdDexCore
        const bytes = (base64: string) => Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
        const hash = async (blob: Blob) =>
          Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())), (b) => b.toString(16).padStart(2, '0')).join('')

        await core.deleteAllCatches()
        const sparrow = await core.addCatch(
          { speciesId: 'passer-domesticus', method: 'photo', confidence: 0.93, location: { lat: 50.08, lon: 14.43, accuracyM: 12 }, placeName: 'Praha', caughtAt: 1_700_000_000_000 },
          { kind: 'image', blob: new Blob([bytes(photoBase64)], { type: 'image/jpeg' }) },
        )
        const redpoll = await core.addCatch(
          { speciesId: 'acanthis-cabaret', method: 'sound', confidence: 0.94, caughtAt: 1_700_000_100_000 },
          { kind: 'audio', blob: new Blob([bytes(clipBase64)], { type: 'audio/wav' }), durationS: 3 },
        )
        const before = await core.listCatches()

        const backup = await core.exportBackup()
        const header = Array.from(new Uint8Array(await backup.slice(0, 2).arrayBuffer()))
        await core.deleteAllCatches()
        const countAfterWipe = await core.countCatches()
        const report = await core.importBackup(backup)

        const after = await core.listCatches()
        const sparrowMedia = await core.getMedia(sparrow.mediaId as string)
        const redpollMedia = await core.getMedia(redpoll.mediaId as string)
        return {
          before,
          after,
          report,
          header,
          backupType: backup.type,
          countAfterWipe,
          photo: { sha: await hash(sparrowMedia!.blob), mime: sparrowMedia!.mime, kind: sparrowMedia!.kind },
          clip: { sha: await hash(redpollMedia!.blob), mime: redpollMedia!.mime, kind: redpollMedia!.kind, durationS: redpollMedia!.durationS },
        }
      },
      { photoBase64: photo.toString('base64'), clipBase64: clip.toString('base64') },
    )

    expect(result.header).toEqual([0x50, 0x4b]) // "PK": a zip file
    expect(result.backupType).toBe('application/zip')
    expect(result.countAfterWipe).toBe(0)
    expect(result.report).toEqual({ total: 2, added: 2, skipped: 0, mediaAdded: 2, mediaMissing: 0 })
    expect(result.after).toEqual(result.before)
    expect(result.after.map((record) => record.speciesId)).toEqual(['acanthis-cabaret', 'passer-domesticus'])
    expect(result.photo).toEqual({ sha: sha256(photo), mime: 'image/jpeg', kind: 'image' })
    expect(result.clip).toEqual({ sha: sha256(clip), mime: 'audio/wav', kind: 'audio', durationS: 3 })
  })

  test('restoring the same backup twice changes nothing, and a damaged file is refused', async ({ page }) => {
    await open(page)
    const outcome = await page.evaluate(async () => {
      const core = window.BirdDexCore
      await core.deleteAllCatches()
      await core.addCatch({ speciesId: 'parus-major', method: 'sound', confidence: 0.9 }, { kind: 'audio', blob: new Blob([new Uint8Array(1000)], { type: 'audio/wav' }), durationS: 1 })
      const backup = await core.exportBackup()
      const again = await core.importBackup(backup)
      const damaged = await core
        .importBackup(new Blob([new Uint8Array(await backup.arrayBuffer()).slice(0, 300)]))
        .then(() => 'accepted', (error: unknown) => (error as { code?: string }).code)
      const notABackup = await core.importBackup(new Blob(['just some text'])).then(() => 'accepted', (error: unknown) => (error as { code?: string }).code)
      return { again, damaged, notABackup, count: await core.countCatches() }
    })
    expect(outcome.again).toEqual({ total: 1, added: 0, skipped: 1, mediaAdded: 0, mediaMissing: 0 })
    expect(outcome.damaged).toBe('not-a-zip')
    expect(outcome.notABackup).toBe('not-a-zip')
    expect(outcome.count).toBe(1)
  })

  test('live summaries follow the database, also when another tab writes', async ({ page, context }) => {
    await open(page)
    await page.evaluate(async () => {
      const core = window.BirdDexCore
      await core.deleteAllCatches()
      const seen: number[] = []
      const store = core.createLiveStore(() => core.countCatches(), -1)
      store.subscribe(() => seen.push(store.getSnapshot().value))
      ;(window as unknown as { seen: number[] }).seen = seen
    })
    await page.waitForFunction(() => (window as unknown as { seen: number[] }).seen.includes(0))

    // The same page adds a catch.
    await page.evaluate(() => window.BirdDexCore.addCatch({ speciesId: 'parus-major', method: 'sound', confidence: 0.9 }))
    await page.waitForFunction(() => (window as unknown as { seen: number[] }).seen.includes(1))

    // A second tab adds another one.
    const other = await context.newPage()
    await open(other)
    await other.evaluate(() => window.BirdDexCore.addCatch({ speciesId: 'turdus-merula', method: 'sound', confidence: 0.8 }))
    await page.waitForFunction(() => (window as unknown as { seen: number[] }).seen.includes(2), undefined, { timeout: 15_000 })
    await other.close()

    const summary = await page.evaluate(async () => {
      const core = window.BirdDexCore
      return Array.from(core.summarizeCatches(await core.listCatches()).keys()).sort()
    })
    expect(summary).toEqual(['parus-major', 'turdus-merula'])
  })
})

test.describe('React hooks in a real browser', () => {
  test('the Dex hooks draw the summary and the saved picture, and follow new catches (in StrictMode)', async ({ page }) => {
    await open(page)
    const photo = readFileSync('tests/fixtures/photos/House_sparrow_bathing_in_mosaic_fountain_Park_Ridge.jpg')
    await page.evaluate(async () => {
      const core = window.BirdDexCore
      await core.deleteAllCatches()
      const h = core.createElement
      const Tile = ({ id, mediaId }: { id: string; mediaId?: string }) => {
        const media = core.useMediaUrl(mediaId)
        return h('li', { 'data-testid': `tile-${id}` }, media.url && media.kind === 'image' ? h('img', { src: media.url, alt: id }) : media.loading ? 'loading' : 'no picture')
      }
      const Dex = () => {
        const summary = core.useCaughtSummary()
        return h(
          'div',
          null,
          h('p', { 'data-testid': 'count' }, `ready=${summary.ready} species=${summary.speciesCount} catches=${summary.catchCount}`),
          h('ul', null, [...summary.bySpecies.values()].map((entry) => h(Tile, { key: entry.speciesId, id: entry.speciesId, mediaId: entry.mediaId }))),
        )
      }
      const container = document.createElement('div')
      document.body.append(container)
      core.createRoot(container).render(h(core.StrictMode, null, h(Dex)))
    })
    await expect(page.getByTestId('count')).toHaveText('ready=true species=0 catches=0')

    await page.evaluate(async (base64) => {
      const core = window.BirdDexCore
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
      await core.addCatch({ speciesId: 'passer-domesticus', method: 'photo', confidence: 0.9 }, { kind: 'image', blob: new Blob([bytes], { type: 'image/jpeg' }) })
      await core.addCatch({ speciesId: 'turdus-merula', method: 'sound', confidence: 0.8 })
    }, photo.toString('base64'))
    await expect(page.getByTestId('count')).toHaveText('ready=true species=2 catches=2')
    // The saved photo is really drawn: the browser decoded it.
    await expect(page.getByTestId('tile-passer-domesticus').locator('img')).toBeVisible()
    await expect.poll(() => page.getByTestId('tile-passer-domesticus').locator('img').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(100)
    await expect(page.getByTestId('tile-turdus-merula')).toHaveText('no picture')

    await page.evaluate(async () => {
      const core = window.BirdDexCore
      await core.deleteAllCatches()
    })
    await expect(page.getByTestId('count')).toHaveText('ready=true species=0 catches=0')
  })

  test('the settings change on every open tab, and survive a reload', async ({ page, context }) => {
    await open(page)
    const read = (target: Page) => target.evaluate(() => window.BirdDexCore.getSettings())
    await page.evaluate(() => window.BirdDexCore.resetSettings())
    expect(await read(page)).toEqual({ sensitivity: 'normal', soundEffects: true })

    // A second tab that shows the settings (that is what keeps it listening for changes made elsewhere).
    const other = await context.newPage()
    await open(other)
    await other.evaluate(() => {
      window.BirdDexCore.subscribeSettings(() => undefined)
    })
    expect(await read(other)).toEqual({ sensitivity: 'normal', soundEffects: true })

    await page.evaluate(() => window.BirdDexCore.updateSettings({ sensitivity: 'strict', soundEffects: false }))
    await expect.poll(() => read(other)).toEqual({ sensitivity: 'strict', soundEffects: false })
    await other.close()

    await page.reload()
    await page.addScriptTag({ path: bundle })
    expect(await read(page)).toEqual({ sensitivity: 'strict', soundEffects: false })
    await page.evaluate(() => window.BirdDexCore.resetSettings())
  })

  test('the pending identification lives in memory and a reload forgets it', async ({ page }) => {
    await open(page)
    const id = await page.evaluate(() => {
      const core = window.BirdDexCore
      core.setPending({ method: 'photo', candidates: [{ speciesId: 'parus-major', confidence: 0.9 }], createdAt: Date.now() })
      return core.getPendingCatchId()
    })
    expect(id).toBeTruthy()
    await page.reload()
    await page.addScriptTag({ path: bundle })
    expect(await page.evaluate(() => window.BirdDexCore.getPending())).toBeUndefined()
  })
})

test.describe('location in a real browser', () => {
  test('returns the position of the (pretend) phone and remembers it', async ({ page }) => {
    await open(page)
    const outcome = await page.evaluate(async () => {
      const core = window.BirdDexCore
      core.resetLocationForTests()
      let asked = 0
      const original = navigator.geolocation.getCurrentPosition.bind(navigator.geolocation)
      navigator.geolocation.getCurrentPosition = (...args: Parameters<typeof original>) => {
        asked++
        original(...args)
      }
      const first = await core.getCurrentLocation({ timeoutMs: 8000 })
      const second = await core.getCurrentLocation({ timeoutMs: 8000 })
      return { first, second, asked, cached: core.getCachedLocation() }
    })
    expect(outcome.first?.lat).toBeCloseTo(50.08, 4)
    expect(outcome.first?.lon).toBeCloseTo(14.43, 4)
    expect(outcome.second).toEqual(outcome.first)
    expect(outcome.cached).toEqual(outcome.first)
    expect(outcome.asked).toBe(1)
  })
})

test.describe('fake engines in a real browser', () => {
  test('the sound fake saves a clip the browser can play, and the photo fake answers', async ({ page }) => {
    await open(page)
    const outcome = await page.evaluate(async () => {
      const core = window.BirdDexCore
      const engines = core.createFakeEngines({ delayMs: 5 })
      const progress: string[] = []
      await engines.sound.prepare((p) => progress.push(p.stage))
      const updates: { analysedSeconds: number; hearingBird: boolean }[] = []
      const session = await engines.sound.start({ onUpdate: (update) => updates.push(update) })
      while (updates.length < 6) await new Promise((resolve) => setTimeout(resolve, 10))
      const result = await session.stop()

      const context = new AudioContext()
      const decoded = await context.decodeAudioData(await result.clip!.arrayBuffer())
      await context.close()

      const photo = await engines.photo.identify(document.createElement('canvas'))
      return {
        progress,
        updates: updates.length,
        hearing: updates.at(-1)?.hearingBird,
        candidates: result.candidates,
        clip: { type: result.clip!.type, seconds: decoded.duration, rate: decoded.sampleRate, channels: decoded.numberOfChannels },
        photo,
        verdicts: core.evaluateCandidates(result.candidates, 'sound', 'normal').map((verdict) => verdict.allowed),
      }
    })
    expect(outcome.progress[0]).toBe('downloading')
    expect(outcome.progress.at(-1)).toBe('ready')
    expect(outcome.hearing).toBe(true)
    expect(outcome.candidates[0]).toEqual({ speciesId: 'parus-major', confidence: 0.91 })
    expect(outcome.verdicts).toEqual([true, false, false])
    expect(outcome.clip.type).toBe('audio/wav')
    expect(outcome.clip.seconds).toBeCloseTo(2, 1)
    expect(outcome.clip.channels).toBe(1)
    expect(outcome.photo.candidates[0].speciesId).toBe('parus-major')
  })

  test('the live camera fake locks on to the fake camera and takes a real JPEG snapshot of it', async ({ page }) => {
    await open(page)
    const outcome = await page.evaluate(async () => {
      const core = window.BirdDexCore
      const stream = await navigator.mediaDevices.getUserMedia({ video: true })
      const video = document.createElement('video')
      video.muted = true
      video.playsInline = true
      video.srcObject = stream
      await video.play()
      while (video.videoWidth === 0) await new Promise((resolve) => setTimeout(resolve, 20))

      const scanner = core.createFakeEngines({ delayMs: 5 }).live
      const updates: { lockedSpeciesId?: string }[] = []
      const session = await scanner.start(video, { onUpdate: (update) => updates.push(update) })
      while (!updates.some((update) => update.lockedSpeciesId)) await new Promise((resolve) => setTimeout(resolve, 10))
      const snapshot = await session.snapshot()
      session.stop()
      stream.getTracks().forEach((track) => track.stop())
      const bitmap = await createImageBitmap(snapshot)
      return { locked: updates.find((u) => u.lockedSpeciesId)?.lockedSpeciesId, type: snapshot.type, size: snapshot.size, width: bitmap.width, height: bitmap.height }
    })
    expect(outcome.locked).toBe('parus-major')
    expect(outcome.type).toBe('image/jpeg')
    // A copy of the camera picture (640 wide), not the 64x48 stand-in.
    expect(outcome.width).toBeGreaterThan(100)
    expect(outcome.height).toBeGreaterThan(50)
    expect(outcome.size).toBeGreaterThan(2000)
  })
})

test.describe('choosing the fake engines in a real browser', () => {
  test('getEngines() follows the address: the fakes, the story and the speed', async ({ page }) => {
    // The choice sits before the # (as a user types it) and the app's own route after it.
    await open(page, '/?engines=fake&fake=unclear&fakeDelay=0#/field-check')
    const outcome = await page.evaluate(async () => {
      const core = window.BirdDexCore
      const engines = core.getEngines()
      const result = await engines.photo.identify(document.createElement('canvas'))
      return {
        mode: core.getEngineMode(),
        same: engines === core.getEngines(),
        top: result.candidates[0],
        verdict: core.evaluateCandidates(result.candidates, 'photo', 'normal')[0],
      }
    })
    expect(outcome.mode).toBe('fake')
    expect(outcome.same).toBe(true)
    expect(outcome.top).toEqual({ speciesId: 'turdus-merula', confidence: 0.62 })
    expect(outcome.verdict).toMatchObject({ allowed: false, reason: 'unclear-margin' })
  })

  test('the choice can also come from localStorage, and the address beats it', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('birddex:engines', 'fake'))
    await open(page)
    expect(await page.evaluate(() => window.BirdDexCore.getEngineMode())).toBe('fake')
    await open(page, '/?engines=real#/field-check')
    expect(await page.evaluate(() => window.BirdDexCore.getEngineMode())).toBe('real')
  })
})

test.describe('model store with the real model files', () => {
  test.skip(!haveModels, 'needs the models: run node scripts/fetch-models.mjs')
  test.setTimeout(300_000)

  test('downloads, checks and keeps every model file, then works offline, then frees the space', async ({ page, context }) => {
    const manifest = JSON.parse(readFileSync('public/models/manifest.json', 'utf8')) as { files: { id: string; bytes: number; sha256: string; file: string }[] }
    const totalBytes = manifest.files.reduce((sum, file) => sum + file.bytes, 0)
    await open(page)
    // Let the service worker take control first: it keeps its own copy of everything under models/, and deleteCached must clear that too.
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, { timeout: 30_000 }).catch(async () => {
      await page.reload()
      await page.addScriptTag({ path: bundle })
    })

    const download = await page.evaluate(async () => {
      const core = window.BirdDexCore
      await core.deleteCached()
      const before = await core.getModelStatus()
      const progress: { loadedBytes: number; totalBytes: number; stage: string; modelId: string }[] = []
      const started = performance.now()
      await core.ensureModels(Object.values(core.MODEL_FILE_IDS), { modelId: 'everything', onProgress: (p) => progress.push(p) })
      const seconds = (performance.now() - started) / 1000
      const after = await core.getModelStatus()
      const cache = await caches.open('birddex-models-v1')
      const stored = (await cache.keys()).map((request) => new URL(request.url).pathname.split('/').pop())
      return { before: before.state, after: after.state, readyBytes: after.readyBytes, persistent: after.persistent, first: progress[0], last: progress.at(-1), steps: progress.length, seconds, stored }
    })
    console.log(`downloaded ${Math.round(totalBytes / 1e6)} MB in ${download.seconds.toFixed(1)} s (${download.steps} progress steps)`)
    expect(download.before).toBe('missing')
    expect(download.after).toBe('ready')
    expect(download.persistent).toBe(true)
    expect(download.readyBytes).toBe(totalBytes)
    expect(download.first).toEqual({ modelId: 'everything', stage: 'downloading', loadedBytes: 0, totalBytes })
    expect(download.last).toEqual({ modelId: 'everything', stage: 'downloading', loadedBytes: totalBytes, totalBytes })
    expect(download.steps).toBeGreaterThan(20)
    expect(download.stored.sort()).toEqual([...manifest.files.map((file) => file.file), 'manifest.json'].sort())

    // After a reload the files come from the phone, not from the network. Work on without a connection to prove it.
    const modelRequests: string[] = []
    page.on('request', (request) => {
      if (/\/models\/(?!manifest)/.test(request.url())) modelRequests.push(request.url())
    })
    await context.setOffline(true)
    await page.reload()
    await page.addScriptTag({ path: bundle })
    const text = manifest.files.find((file) => file.id === 'wingclip-text')!
    const offline = await page.evaluate(async () => {
      const core = window.BirdDexCore
      const bytes = await core.getModelBytes(core.MODEL_FILE_IDS.wingclipText)
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource)), (b) => b.toString(16).padStart(2, '0')).join('')
      return { length: bytes.length, hash, state: (await core.getModelStatus()).state, cached: await core.areModelsCached(Object.values(core.MODEL_FILE_IDS)) }
    })
    await context.setOffline(false)
    expect(offline).toEqual({ length: text.bytes, hash: text.sha256, state: 'ready', cached: true })
    expect(modelRequests).toEqual([])

    // Deleting frees the space, here and in the service worker's copy.
    const deleted = await page.evaluate(async () => {
      const core = window.BirdDexCore
      await core.deleteCached()
      const status = await core.getModelStatus()
      const names = await caches.keys()
      const worker = names.includes('birddex-heavy-v1') ? (await (await caches.open('birddex-heavy-v1')).keys()).map((request) => new URL(request.url).pathname) : []
      return { state: status.state, ownCache: names.includes('birddex-models-v1'), workerModelFiles: worker.filter((path) => /\/models\/(?!manifest)/.test(path)) }
    })
    expect(deleted).toEqual({ state: 'missing', ownCache: false, workerModelFiles: [] })
  })
})

test.describe('a failed model download in a real browser', () => {
  // Playwright cannot intercept requests that a service worker handles, so keep the worker out.
  test.use({ serviceWorkers: 'block' })
  test.skip(!haveModels, 'needs the models: run node scripts/fetch-models.mjs')

  test('is reported as a ModelDownloadError the screens can handle', async ({ page }) => {
    await open(page)
    // The server "loses" the file: every request for it ends in an error page.
    await page.route('**/models/text_classifier_int8.bin*', (route) => route.fulfill({ status: 404, body: 'gone' }))
    const outcome = await page.evaluate(async () => {
      const core = window.BirdDexCore
      await core.deleteCached()
      try {
        await core.getModelBytes(core.MODEL_FILE_IDS.wingclipText)
        return { name: 'no error' }
      } catch (error) {
        const e = error as { name: string; reason?: string; status?: number; fileId?: string }
        return { name: e.name, reason: e.reason, status: e.status, fileId: e.fileId, state: (await core.getModelStatus()).files.find((f) => f.id === e.fileId)?.state }
      }
    })
    expect(outcome).toEqual({ name: 'ModelDownloadError', reason: 'http', status: 404, fileId: 'wingclip-text', state: 'failed' })
  })

  test('resumes a download that ended early, asking only for the rest', async ({ page }) => {
    const file = readFileSync('public/models/text_classifier_int8.bin')
    const cut = 3_000_000
    const ranges: (string | undefined)[] = []
    await open(page)
    // The first answer stops after 3 MB (as when the connection drops); a request for the rest gets the rest.
    await page.route('**/models/text_classifier_int8.bin*', (route) => {
      const range = route.request().headers()['range']
      ranges.push(range)
      if (!range) return route.fulfill({ status: 200, body: file.subarray(0, cut), contentType: 'application/octet-stream' })
      const start = Number(/bytes=(\d+)-/.exec(range)?.[1])
      return route.fulfill({
        status: 206,
        body: file.subarray(start),
        headers: { 'Content-Range': `bytes ${start}-${file.length - 1}/${file.length}`, 'Content-Type': 'application/octet-stream' },
      })
    })
    const outcome = await page.evaluate(async () => {
      const core = window.BirdDexCore
      await core.deleteCached()
      const steps: number[] = []
      const bytes = await core.getModelBytes(core.MODEL_FILE_IDS.wingclipText, (loaded) => steps.push(loaded))
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource)), (b) => b.toString(16).padStart(2, '0')).join('')
      return { hash, length: bytes.length, steps }
    })
    expect(outcome.hash).toBe(sha256(file))
    expect(outcome.length).toBe(file.length)
    expect(ranges).toEqual([undefined, `bytes=${cut}-`])
    // The progress bar never goes backwards when the download resumes.
    for (let i = 1; i < outcome.steps.length; i++) expect(outcome.steps[i]).toBeGreaterThanOrEqual(outcome.steps[i - 1])
    expect(outcome.steps.at(-1)).toBe(file.length)
  })
})

test.describe('the Field check with the real models', () => {
  test.skip(!haveModels, 'needs the models: run node scripts/fetch-models.mjs')
  test.setTimeout(420_000)

  test('times BirdNET with LiteRT.js and WingCLIP (with its weights file) with ONNX Runtime Web on the CPU path', async ({ page }) => {
    await page.goto('/#/field-check')
    await page.getByTestId('models-start').click()
    await expect(page.getByTestId('status-models')).toHaveText('pass', { timeout: 380_000 })
    const card = page.getByTestId('card-models')
    await expect(card).toContainText('BirdNET V2.4 (LiteRT)')
    await expect(card).toContainText('WingCLIP (ONNX Runtime)')
    await expect(card).toContainText('LiteRT.js / wasm: ready')
    await expect(card).toContainText('ONNX Runtime Web / wasm: ready')
    await expect(card).toContainText('6522 values') // BirdNET: one score per sound class
    await expect(card).toContainText('768 values') // WingCLIP: one embedding
    await expect(card).not.toContainText('NaN')
    console.log(await card.innerText())
  })
})
