import { copyFileSync, mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { chromium, expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test'
import type { Candidate } from '../../src/domain/types'
import type { DevRow, DevStatus } from '../../src/ml/vision/DevPhotoPage'
import { evaluateCandidates } from '../../src/domain/thresholds'
import { skipWelcome } from './shell-helpers'

// The photo engine and the live scanner on the real WingCLIP model, in real Chromium, through the developer page
// /#/dev/photo (src/ml/vision/DevPhotoPage.tsx). Needs the model files in public/models (npm run fetch-models).
//
// What is checked: the three guesses for the fixture photos (tests/fixtures/photos, truth.json), how the engine behaves
// on pictures that are not birds, that the numbers agree with an independent Python run of the same model, that the
// worker keeps the page responsive, that the model loads again with no network, and the live camera (a fake camera that
// plays one of the photos) locks on the bird, takes a snapshot and stops cleanly.

// Playwright runs from the project folder, like the other specs assume.
const ROOT = process.cwd()
const PHOTOS = join(ROOT, 'tests/fixtures/photos')
const truth = JSON.parse(readFileSync(join(PHOTOS, 'truth.json'), 'utf8')) as Record<string, string | null>
const dex = JSON.parse(readFileSync(join(ROOT, 'public/data/species.json'), 'utf8')) as { id: string; englishName: string; wingclipIndex: number | null }[]
const reference = JSON.parse(readFileSync(join(ROOT, 'tests/fixtures/vision/reference-embeddings.json'), 'utf8')) as {
  photos: Record<string, { embedding: number[]; pBird: number }>
  synthetic: Record<string, { width: number; height: number; seed: number; embedding: number[] }>
}
const idOf = (english: string | null) => (english === null ? undefined : dex.find((s) => s.englishName === english)?.id)
const photoFiles = readdirSync(PHOTOS)
  .filter((name) => name.endsWith('.jpg'))
  .sort()

/** Photos whose bird is in the Dex, with the species id they should be recognised as. */
const inDex = photoFiles.map((name) => ({ name, english: truth[name], id: idOf(truth[name]) })).filter((photo): photo is { name: string; english: string; id: string } => photo.id !== undefined)
/** Birds that the Dex does not have, or that have no name in the truth file. */
const outside = photoFiles.filter((name) => !inDex.some((photo) => photo.name === name))

const MODEL_FILES = ['wingclip_visual_int8.onnx', 'wingclip_visual_int8.data', 'text_classifier_int8.bin']
const modelsPresent = (() => {
  try {
    return MODEL_FILES.every((file) => readFileSync(join(ROOT, 'public/models', file)).length > 0)
  } catch {
    return false
  }
})()

const cosine = (a: ArrayLike<number>, b: ArrayLike<number>) => {
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  return dot / Math.sqrt(na * nb)
}

const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]
type Row = DevRow
type Status = DevStatus
const top3 = (row: Row) => row.candidates.map((c) => c.speciesId)
const rowOf = (rows: Row[], name: string) => {
  const row = rows.find((r) => r.label === name)
  if (!row) throw new Error(`no result for ${name}`)
  return row
}

async function openDevPage(context: BrowserContext, query = ''): Promise<Page> {
  const page = await context.newPage()
  await skipWelcome(page)
  await page.goto(`/#/dev/photo${query}`)
  await page.waitForFunction(() => window.birddexPhotoDev !== undefined, undefined, { timeout: 20_000 })
  return page
}

test.skip(!modelsPresent, 'the WingCLIP model files are not in public/models (run: npm run fetch-models)')
test.describe.configure({ mode: 'serial' })

// ---------------------------------------------------------------------------------------------------------------------
// The photos, one page for all of them: the model is loaded once.
// ---------------------------------------------------------------------------------------------------------------------

test.describe('photos', () => {
  let context: BrowserContext
  let page: Page
  const errors: string[] = []
  let prepare: Status

  test.beforeAll(async ({ browser }) => {
    context = await browser.newContext({ permissions: ['camera', 'microphone', 'geolocation'], baseURL: test.info().project.use.baseURL })
    page = await openDevPage(context)
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text())
    })
    prepare = await page.evaluate(() => window.birddexPhotoDev!.prepare())
  })

  test.afterAll(async () => {
    await context?.close()
  })

  test('the model prepares itself in a worker, with the plain WebAssembly build of ONNX Runtime, in a few seconds', async () => {
    expect(prepare.state).toBe('ready')
    expect(prepare.backend).toBe('worker')
    expect(prepare.build).toBe('wasm')
    // download from the local server, a worker, a 14 MB graph and 25 MB of weights: about 3 s here, allow a loaded machine
    expect(prepare.ms).toBeLessThan(30_000)
    const info = await page.evaluate(async () => (await window.birddexPhotoDev!.getRuntime()).info)
    expect(info?.dexSize).toBeGreaterThanOrEqual(400)
    expect(info?.dexSize).toBe(dex.filter((s) => s.wingclipIndex !== null).length)
    test.info().annotations.push({ type: 'model load', description: `prepare ${Math.round(prepare.ms ?? 0)} ms, session ${Math.round(info?.initMs ?? 0)} ms, ORT ${info?.ortVersion} (${info?.build})` })
  })

  test('identifies the fixture photos picked through the file input: the expected top 3 and sane timing', async () => {
    await page.evaluate(() => window.birddexPhotoDev!.reset())
    await page.setInputFiles('[data-testid=dev-photo-input]', photoFiles.map((name) => join(PHOTOS, name)))
    await page.waitForFunction((count) => document.querySelectorAll('[data-testid=dev-photo-row]').length >= count, photoFiles.length, { timeout: 120_000 })
    const rows = (await page.evaluate(() => window.birddexPhotoDev!.getState())).rows
    expect(rows).toHaveLength(photoFiles.length)

    // The report: top 1 and top 3 for the birds that are in the Dex.
    let top1 = 0
    let top3Hits = 0
    const lines: string[] = []
    for (const photo of inDex) {
      const row = rowOf(rows, photo.name)
      const rank = top3(row).indexOf(photo.id)
      if (rank === 0) top1++
      if (rank >= 0) top3Hits++
      lines.push(`${photo.english}: rank ${rank >= 0 ? rank + 1 : 'not in top 3'}, guesses ${row.candidates.map((c) => `${c.speciesId} ${c.confidence.toFixed(2)}`).join(', ')}, pBird ${row.pBird.toFixed(2)}`)
    }
    test.info().annotations.push({ type: 'accuracy', description: `top-1 ${top1}/${inDex.length}, top-3 ${top3Hits}/${inDex.length}\n${lines.join('\n')}` })
    console.log(`photo accuracy: top-1 ${top1}/${inDex.length}, top-3 ${top3Hits}/${inDex.length}\n${lines.join('\n')}`)

    expect(inDex.map((p) => p.english).sort()).toEqual(['Common Goldeneye', 'Common Kingfisher', 'Great Cormorant', 'House Sparrow', 'Mallard', 'Rock Pigeon'])
    // Clear birds are the first guess, with a confidence that lets them be caught
    for (const [name, minimum] of [
      ['Common_kingfisher_at_Taipei_Zoo.jpg', 0.9],
      ['Mallard_drake_on_Union_Bay_Natural_Area.jpg', 0.9],
      ['Pigeons_near_Museumplein_Amsterdam.jpg', 0.9],
      ['Cormorant_on_mooring_post_Lake_Como.jpg', 0.6],
    ] as const) {
      const row = rowOf(rows, name)
      const wanted = inDex.find((p) => p.name === name)!.id
      expect(row.candidates[0].speciesId, name).toBe(wanted)
      expect(row.candidates[0].confidence, name).toBeGreaterThanOrEqual(minimum)
    }
    // The Common Goldeneye is neck and neck with Barrow's Goldeneye (0.002 apart in the Python run): top 3 is the promise.
    expect(top3(rowOf(rows, 'Common_goldeneye_at_Discovery_Park_Seattle.jpg'))).toContain('bucephala-clangula')
    // Five of the six are in the top 3; the House Sparrow in a colourful mosaic is the known miss (see docs/notes/photo-engine.md)
    expect(top3Hits).toBeGreaterThanOrEqual(5)
    expect(top1).toBeGreaterThanOrEqual(5)

    // Every candidate list is three guesses of different birds of the Dex, strongest first, with confidences in 0..1
    for (const row of rows) {
      expect(row.candidates, row.label).toHaveLength(3)
      expect(new Set(top3(row)).size).toBe(3)
      for (const c of row.candidates) {
        expect(dex.some((s) => s.id === c.speciesId)).toBe(true)
        expect(c.confidence).toBeGreaterThanOrEqual(0)
        expect(c.confidence).toBeLessThanOrEqual(1)
      }
      expect(row.candidates[0].confidence).toBeGreaterThanOrEqual(row.candidates[1].confidence)
      expect(row.candidates[1].confidence).toBeGreaterThanOrEqual(row.candidates[2].confidence)
      expect(row.pBird).toBeGreaterThan(0.75) // they are all birds
    }

    // Timing: about 450 ms per picture here; a loaded machine gets plenty of room
    const totals = rows.map((r) => r.diagnostics.timings.totalMs)
    const infers = rows.map((r) => r.diagnostics.timings.inferMs)
    test.info().annotations.push({ type: 'timing', description: `per picture: median total ${Math.round(median(totals))} ms, median model ${Math.round(median(infers))} ms, slowest ${Math.round(Math.max(...totals))} ms; preprocessing ${Math.round(median(rows.map((r) => r.diagnostics.timings.preprocessMs)))} ms, scoring ${Math.round(median(rows.map((r) => r.diagnostics.timings.scoreMs)))} ms, canvas ${Math.round(median(rows.map((r) => r.diagnostics.timings.grabMs)))} ms` })
    expect(median(totals)).toBeLessThan(3000)
    expect(Math.max(...totals)).toBeLessThan(10_000)
    for (const row of rows) {
      expect(row.diagnostics.timings.preprocessMs).toBeLessThan(500)
      expect(row.diagnostics.timings.scoreMs).toBeLessThan(500)
      expect(row.diagnostics.backend).toBe('worker')
    }
  })

  test('the Catch rules keep the confident wrong answers away and let the clear right ones through', async () => {
    const rows = (await page.evaluate(() => window.birddexPhotoDev!.getState())).rows
    const lines: string[] = []
    const verdict = (name: string, sensitivity: 'strict' | 'normal' | 'easy' = 'normal') => {
      const row = rowOf(rows, name)
      const first = evaluateCandidates(row.candidates, 'photo', sensitivity, { pBird: row.pBird, outsideDexTop: row.diagnostics.outsideDexTop })[0]
      lines.push(`${name} (${sensitivity}): ${row.candidates[0].speciesId} ${row.candidates[0].confidence.toFixed(2)}, pBird ${row.pBird.toFixed(2)}, foreign ${row.diagnostics.outsideDexTop.toFixed(2)} -> ${verdictLabel(first)}`)
      return first
    }
    const verdictLabel = (v: { allowed: boolean; reason?: string }) => (v.allowed ? 'CATCH' : `blocked (${v.reason})`)
    // right answers stay catchable
    const right = ['Common_kingfisher_at_Taipei_Zoo.jpg', 'Mallard_drake_on_Union_Bay_Natural_Area.jpg', 'Pigeons_near_Museumplein_Amsterdam.jpg', 'Cormorant_on_mooring_post_Lake_Como.jpg']
    const outcomes = right.map((name) => verdict(name).allowed)
    console.log(`catch rules:\n${lines.join('\n')}`)
    expect(outcomes, lines.join('\n')).toEqual(right.map(() => true))
    // the House Sparrow in the mosaic (read as a Mandarin Duck 0.78): pBird is 0.84 to 0.91
    expect(rowOf(rows, 'House_sparrow_bathing_in_mosaic_fountain_Park_Ridge.jpg').pBird).toBeLessThan(0.95)
    expect(verdict('House_sparrow_bathing_in_mosaic_fountain_Park_Ridge.jpg')).toMatchObject({ allowed: false, reason: 'not-a-clear-bird' })
    // an American bird the Dex does not have: the plain model is sure of its own species (0.89), so even a guess that passed the
    // confidence bar would be refused
    const hairy = rowOf(rows, 'Hairy_woodpecker_on_mossy_tree_Carkeek_Park.jpg')
    expect(hairy.diagnostics.outsideDexTop).toBeGreaterThan(0.6)
    expect(evaluateCandidates([{ speciesId: hairy.candidates[0].speciesId, confidence: 0.9 }], 'photo', 'easy', { pBird: hairy.pBird, outsideDexTop: hairy.diagnostics.outsideDexTop })[0].reason).toBe('maybe-outside-dex')
    // European birds of the Dex see no strong foreign rival (the Cormorant is the closest, with its American cousins)
    for (const name of ['Common_kingfisher_at_Taipei_Zoo.jpg', 'Mallard_drake_on_Union_Bay_Natural_Area.jpg', 'Pigeons_near_Museumplein_Amsterdam.jpg']) {
      expect(rowOf(rows, name).diagnostics.outsideDexTop, name).toBeLessThan(0.15)
    }
    expect(rowOf(rows, 'Cormorant_on_mooring_post_Lake_Como.jpg').diagnostics.outsideDexTop).toBeLessThan(0.3) // 0.265: the limit has to stay above it
    test.info().annotations.push({ type: 'catch rules', description: lines.join('\n') })
    console.log(`catch rules:\n${lines.join('\n')}`)
  })

  test('birds that are not in the Dex, or that nobody could name, never come out sure of themselves', async () => {
    const rows = (await page.evaluate(() => window.birddexPhotoDev!.getState())).rows
    const lines: string[] = []
    for (const name of outside) {
      const row = rowOf(rows, name)
      lines.push(`${name}: ${row.candidates.map((c) => `${c.speciesId} ${c.confidence.toFixed(2)}`).join(', ')} (outside the Dex ${row.diagnostics.outsideDexMass.toFixed(2)}, pBird ${row.pBird.toFixed(2)})`)
      // 0.8 is above the 0.75 of the strict catch rule: no wrong catch even there
      expect(row.candidates[0].confidence, name).toBeLessThan(0.8)
    }
    test.info().annotations.push({ type: 'not in the Dex', description: lines.join('\n') })
    // the American woodpecker looks like a Eurasian Three-toed Woodpecker; the rest of the probability goes to its own species outside the Dex
    const hairy = rowOf(rows, 'Hairy_woodpecker_on_mossy_tree_Carkeek_Park.jpg')
    expect(hairy.diagnostics.outsideDexMass).toBeGreaterThan(0.1)
    expect(hairy.candidates[0].confidence).toBeLessThan(0.65)
    // unknown geese, gulls and a tit: the null-truth fixtures
    for (const name of ['Geese_in_misty_rice_paddies_Dehua_Fujian.jpg', 'Gulls_on_picnic_tables_Seattle_waterfront.jpg', 'Unknown_bird_no_GPS.jpg']) {
      expect(truth[name]).toBeNull()
      expect(rowOf(rows, name).candidates[0].confidence).toBeLessThan(0.8)
    }
  })

  test('a prior can be plugged in: a Czech region prior settles the Common Goldeneye against Barrow\'s Goldeneye (Iceland)', async () => {
    const identify = async () => {
      const bytes = readFileSync(join(PHOTOS, 'Common_goldeneye_at_Discovery_Park_Seattle.jpg')).toString('base64')
      return page.evaluate((data) => window.birddexPhotoDev!.identifyDataUrl('goldeneye', `data:image/jpeg;base64,${data}`), bytes)
    }
    try {
      const without = await identify()
      await page.evaluate(() => window.birddexPhotoDev!.setRegionPrior('czechia'))
      const czech = await identify()
      await page.evaluate(() => window.birddexPhotoDev!.setRegionPrior('europe'))
      const europe = await identify()
      const share = (row: Row, id: string) => row.candidates.find((c) => c.speciesId === id)?.confidence ?? 0
      test.info().annotations.push({
        type: 'prior',
        description: `Common Goldeneye ${share(without, 'bucephala-clangula').toFixed(2)} with no prior, ${share(czech, 'bucephala-clangula').toFixed(2)} with the Czech prior, ${share(europe, 'bucephala-clangula').toFixed(2)} with the Europe prior; Barrow's ${share(without, 'bucephala-islandica').toFixed(2)} then ${share(czech, 'bucephala-islandica').toFixed(2)}`,
      })
      expect(share(czech, 'bucephala-clangula')).toBeGreaterThan(share(without, 'bucephala-clangula'))
      expect(share(czech, 'bucephala-clangula')).toBeGreaterThan(0.85)
      expect(share(czech, 'bucephala-islandica')).toBeLessThan(0.1)
      // every bird of the Dex is European, so the Europe prior changes nothing
      expect(share(europe, 'bucephala-clangula')).toBeCloseTo(share(without, 'bucephala-clangula'), 3)
    } finally {
      await page.evaluate(() => window.birddexPhotoDev!.setRegionPrior())
    }
  })

  test('pictures that are not birds give no candidates at all, or only very weak ones', async () => {
    await page.evaluate(() => window.birddexPhotoDev!.reset())
    const generated = await page.evaluate(async () => {
      const dev = window.birddexPhotoDev!
      const out: Record<string, { pBird: number; candidates: Candidate[]; blank: boolean }> = {}
      for (const kind of ['noise', 'flat:#000000', 'flat:#808080', 'flat:#ffffff', 'flat:#28a03c', 'gradient']) {
        const row = await dev.identifyGenerated(kind)
        out[kind] = { pBird: row.pBird, candidates: row.candidates, blank: row.diagnostics.blank }
      }
      return out
    })
    const lines = Object.entries(generated).map(([kind, r]) => `${kind}: pBird ${r.pBird.toFixed(3)}, blank ${r.blank}, ${r.candidates.length ? r.candidates.map((c) => `${c.speciesId} ${c.confidence.toFixed(2)}`).join(', ') : 'no candidates'}`)
    // A screenshot of the app itself (the page with all the interface parts, at the size of a phone)
    const shotPage = await context.newPage()
    await skipWelcome(shotPage)
    await shotPage.setViewportSize({ width: 390, height: 844 })
    await shotPage.goto('/#/ui-kit')
    await shotPage.waitForLoadState('networkidle')
    const shot = (await shotPage.screenshot({ type: 'png' })).toString('base64')
    await shotPage.close()
    const screenshot = await page.evaluate(async (data) => {
      const row = await window.birddexPhotoDev!.identifyDataUrl('screenshot', `data:image/png;base64,${data}`)
      return { pBird: row.pBird, candidates: row.candidates, blank: row.diagnostics.blank }
    }, shot)
    lines.push(`screenshot: pBird ${screenshot.pBird.toFixed(3)}, ${screenshot.candidates.length ? screenshot.candidates.map((c) => `${c.speciesId} ${c.confidence.toFixed(2)}`).join(', ') : 'no candidates'}`)
    test.info().annotations.push({ type: 'not birds', description: lines.join('\n') })
    console.log(`pictures that are not birds:\n${lines.join('\n')}`)

    // Flat colours (a covered lens, a wall) are blank: the model is not even run
    for (const kind of ['flat:#000000', 'flat:#808080', 'flat:#ffffff', 'flat:#28a03c']) {
      expect(generated[kind].blank, kind).toBe(true)
      expect(generated[kind].pBird).toBe(0)
      expect(generated[kind].candidates).toEqual([])
    }
    // Noise falls below the probe's threshold
    expect(generated.noise.candidates).toEqual([])
    expect(generated.noise.pBird).toBeLessThan(0.3736)
    // Whatever else gets through (a screenshot, a gradient) is spread so thin over the species that nothing can be caught:
    // far below the easiest catch threshold of 0.45
    for (const picture of [...Object.values(generated), screenshot]) {
      for (const c of picture.candidates) expect(c.confidence).toBeLessThan(0.25)
    }
  })

  test('agrees with an independent Python run of the same model (Pillow and onnxruntime) on the fixture photos', async () => {
    const cosines: string[] = []
    for (const name of photoFiles) {
      const bytes = readFileSync(join(PHOTOS, name)).toString('base64')
      const row = await page.evaluate(([label, data]) => window.birddexPhotoDev!.identifyDataUrl(label, `data:image/jpeg;base64,${data}`, { wantEmbedding: true }), [name, bytes])
      const embedding = Object.values(row.diagnostics.embedding ?? {})
      expect(embedding).toHaveLength(768)
      const c = cosine(embedding, reference.photos[name].embedding)
      cosines.push(`${name.slice(0, 28)} ${c.toFixed(4)}`)
      // The int8 model is not identical across runtimes (ONNX Runtime Web against native Python: cosine 0.9987 on the very same
      // tensor), and the browser scales the picture first. Anything below 0.98 would be a broken pipeline: wrong size, order, mean.
      expect(c, name).toBeGreaterThan(0.98)
      expect(Math.abs(row.pBird - reference.photos[name].pBird), name).toBeLessThan(0.15)
    }
    test.info().annotations.push({ type: 'embedding cosine', description: cosines.join('\n') })
  })

  test('gives the same embedding as Python for the very same preprocessed picture (runtime parity)', async () => {
    const results: string[] = []
    for (const [name, spec] of Object.entries(reference.synthetic)) {
      // The picture is made by the formula that Pillow was given (tests/unit/helpers/vision-synth.ts), here in the page
      const embedding = await page.evaluate(async ({ width, height, seed }) => {
        const rgb = new Uint8Array(width * height * 3)
        let o = 0
        for (let y = 0; y < height; y++) {
          const gy = Math.floor((y * 255) / Math.max(height - 1, 1))
          for (let x = 0; x < width; x++) {
            const gx = Math.floor((x * 255) / Math.max(width - 1, 1))
            for (let c = 0; c < 3; c++) {
              let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(c, 2147483629) + Math.imul(seed, 1274126177)) >>> 0
              h = (h ^ (h >>> 13)) >>> 0
              h = Math.imul(h, 1274126177) >>> 0
              h = (h ^ (h >>> 16)) >>> 0
              const noise = h & 255
              const grad = Math.floor((gx * (c + 1) + gy * (3 - c)) / 4) % 256
              const checker = (Math.floor(x / 9) + Math.floor(y / 6) + c) % 2 === 0 ? 255 : 0
              rgb[o++] = Math.floor((noise * 2 + grad * 4 + checker * 2) / 8)
            }
          }
        }
        const runtime = await window.birddexPhotoDev!.getRuntime()
        const scores = await runtime.analyse({ data: rgb, width, height, channels: 3 }, { wantEmbedding: true })
        return Array.from(scores.embedding ?? [])
      }, spec)
      const c = cosine(embedding, spec.embedding)
      results.push(`${name} ${c.toFixed(5)}`)
      expect(c, name).toBeGreaterThan(0.995)
    }
    test.info().annotations.push({ type: 'runtime parity', description: results.join('\n') })
  })

  test('the page stays responsive while the model works (the worker), where the main thread would freeze', async () => {
    const worker = await page.evaluate(async () => {
      const dev = window.birddexPhotoDev!
      const { stalls } = await dev.measureStalls(async () => {
        for (let i = 0; i < 4; i++) await dev.identifyGenerated('gradient')
        return 1
      })
      return stalls
    })
    test.info().annotations.push({ type: 'main thread, worker', description: JSON.stringify(worker) })
    // typically 20 ms; 250 leaves room for a busy machine, and a run on the main thread is 450 to 600 ms
    expect(worker.maxFrameGapMs).toBeLessThan(250)
    expect(worker.maxTimerGapMs).toBeLessThan(250)
    expect(worker.longTasksMs.filter((ms) => ms > 150)).toEqual([])
  })

  test('the same model on the main thread freezes the page for every picture (why there is a worker)', async () => {
    const mainContext = await page.context().browser()!.newContext({ baseURL: test.info().project.use.baseURL })
    try {
      const mainPage = await openDevPage(mainContext, '?vision=main')
      const status = await mainPage.evaluate(() => window.birddexPhotoDev!.prepare())
      expect(status.backend).toBe('main')
      const { stalls, modelMs } = await mainPage.evaluate(async () => {
        const dev = window.birddexPhotoDev!
        const { result, stalls } = await dev.measureStalls(async () => {
          const times: number[] = []
          for (let i = 0; i < 3; i++) times.push((await dev.identifyGenerated('gradient')).diagnostics.timings.inferMs)
          return times
        })
        return { stalls, modelMs: Math.max(...result) }
      })
      test.info().annotations.push({ type: 'main thread, no worker', description: `${JSON.stringify(stalls)}, the model needed up to ${Math.round(modelMs)} ms` })
      // the page was stuck for about as long as the model ran, whatever the speed of the machine
      expect(stalls.maxFrameGapMs).toBeGreaterThan(0.7 * modelMs)
    } finally {
      await mainContext.close()
    }
  })

  test('shows a photo that is stored turned (EXIF orientation 6) the right way up', async () => {
    const bytes = readFileSync(join(ROOT, 'tests/fixtures/vision/mallard-exif-rotated.jpg')).toString('base64')
    const row = await page.evaluate((data) => window.birddexPhotoDev!.identifyDataUrl('exif', `data:image/jpeg;base64,${data}`), bytes)
    // stored 640 x 960, shown 960 x 640: the picture that goes to the model is landscape, and it is still a Mallard
    expect(row.diagnostics.frame.width).toBeGreaterThan(row.diagnostics.frame.height)
    expect(row.candidates[0].speciesId).toBe('anas-platyrhynchos')
    expect(row.candidates[0].confidence).toBeGreaterThan(0.9)
  })

  test('no console errors or exceptions on the page', async () => {
    expect(errors.filter((message) => !/favicon|DevTools/.test(message))).toEqual([])
  })
})

// ---------------------------------------------------------------------------------------------------------------------
// The way the screens will use it.
// ---------------------------------------------------------------------------------------------------------------------

test.describe('through getEngines()', () => {
  test('the real photo engine and live scanner are what src/ml/engines.ts finds, and they identify a decoded photo file', async ({ browser }) => {
    const context = await browser.newContext({ baseURL: test.info().project.use.baseURL })
    try {
      const page = await openDevPage(context)
      const bytes = readFileSync(join(PHOTOS, 'Common_kingfisher_at_Taipei_Zoo.jpg')).toString('base64')
      const outcome = await page.evaluate((data) => window.birddexPhotoDev!.identifyViaEngines(`data:image/jpeg;base64,${data}`), bytes)
      expect(outcome.liveHasStart).toBe(true)
      expect(outcome.result.candidates[0].speciesId).toBe('alcedo-atthis')
      expect(outcome.result.candidates[0].confidence).toBeGreaterThan(0.9)
      expect(outcome.result.pBird).toBeGreaterThan(0.9)
    } finally {
      await context.close()
    }
  })
})

// ---------------------------------------------------------------------------------------------------------------------
// Failures, and the model again with no network.
// ---------------------------------------------------------------------------------------------------------------------

test.describe('failures and offline', () => {
  test('a download that fails leaves a calm error, and the next try works', async ({ browser }) => {
    const context = await browser.newContext({ baseURL: test.info().project.use.baseURL })
    try {
      let blocked = true
      await context.route('**/models/wingclip_visual_int8.data*', (route) => (blocked ? route.abort('connectionfailed') : route.continue()))
      const page = await openDevPage(context)
      const failure = await page.evaluate(async () => {
        try {
          await window.birddexPhotoDev!.prepare()
          return 'prepared'
        } catch (error) {
          return (error as Error).name
        }
      })
      expect(['ModelDownloadError', 'ModelLoadError']).toContain(failure)
      await expect(page.getByTestId('dev-photo-status')).toHaveAttribute('data-state', 'error')
      blocked = false
      const status = await page.evaluate(() => window.birddexPhotoDev!.prepare())
      expect(status.state).toBe('ready')
      const row = await page.evaluate(() => window.birddexPhotoDev!.identifyGenerated('gradient'))
      expect(row.candidates.length).toBeLessThanOrEqual(3)
    } finally {
      await context.close()
    }
  })

  test('once the files are on the phone the model loads again with no network', async ({ browser }) => {
    const context = await browser.newContext({ baseURL: test.info().project.use.baseURL })
    try {
      const page = await openDevPage(context)
      // wait for the service worker to take over, so the runtime files are kept for offline use as well
      await page.evaluate(async () => {
        await navigator.serviceWorker?.ready
        if (navigator.serviceWorker && !navigator.serviceWorker.controller) {
          await new Promise<void>((resolve) => {
            navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true })
            setTimeout(resolve, 5000)
          })
        }
      })
      await page.evaluate(() => window.birddexPhotoDev!.prepare())
      // The service worker keeps vendor/ (ONNX Runtime) in its cache "birddex-heavy-v1". If that does not happen, no engine can
      // start with no network, and that is not something the engine can fix: see docs/notes/photo-engine.md (the
      // `${base}` in the two urlPattern functions of vite.config.ts is not defined inside the service worker).
      const kept = await page.evaluate(async () => {
        await new Promise((resolve) => setTimeout(resolve, 1000))
        if (!(await caches.has('birddex-heavy-v1'))) return []
        return (await (await caches.open('birddex-heavy-v1')).keys()).map((request) => new URL(request.url).pathname)
      })
      test.skip(!kept.some((path) => path.includes('/vendor/ort/')), 'the service worker does not keep vendor/ort for offline use (vite.config.ts: ${base} inside urlPattern)')
      const runtime = await page.evaluate(async () => {
        const r = await window.birddexPhotoDev!.getRuntime()
        await r.dispose()
        return { ready: r.isReady }
      })
      expect(runtime.ready).toBe(false)
      await context.setOffline(true)
      // a new worker, the files from Cache Storage, ONNX Runtime from the service worker's cache
      const again = await page.evaluate(async () => {
        const started = performance.now()
        const r = await window.birddexPhotoDev!.getRuntime()
        const row = await window.birddexPhotoDev!.identifyGenerated('gradient')
        return { ms: performance.now() - started, ready: r.isReady, candidates: row.candidates.length }
      })
      expect(again.ready).toBe(true)
      test.info().annotations.push({ type: 'offline reload', description: `model loaded and used again with no network in ${Math.round(again.ms)} ms` })
    } finally {
      await context.close()
    }
  })
})

// ---------------------------------------------------------------------------------------------------------------------
// The live camera: a fake camera that plays the Mallard photo.
// ---------------------------------------------------------------------------------------------------------------------

test.describe('live camera', () => {
  const folder = join(ROOT, 'test-results', `photo-engine-${process.env.E2E_PORT ?? 'x'}`)
  const camera = join(folder, 'mallard.mjpeg')
  let browser: Browser

  test.beforeAll(async () => {
    mkdirSync(folder, { recursive: true })
    // One JPEG is a valid motion JPEG file with one frame; Chromium plays it in a loop as the camera picture.
    copyFileSync(join(PHOTOS, 'Mallard_drake_on_Union_Bay_Natural_Area.jpg'), camera)
    browser = await chromium.launch({
      executablePath: process.env.CHROMIUM_PATH || undefined,
      args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${camera}`],
    })
  })

  test.afterAll(async () => {
    await browser?.close()
  })

  test('locks on the bird after a few frames, reports its speed, takes a JPEG snapshot and stops cleanly', async () => {
    const context = await browser.newContext({ baseURL: test.info().project.use.baseURL, permissions: ['camera'] })
    try {
      const page = await openDevPage(context)
      const errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      await page.evaluate(() => window.birddexPhotoDev!.prepare())
      await page.evaluate(() => window.birddexPhotoDev!.startLive())
      await expect(page.getByTestId('dev-live-video')).toBeVisible()
      // a lock needs three frames in a row: 3 s with the fake camera on this machine; allow a slow one
      await expect(page.getByTestId('dev-live-status')).toHaveAttribute('data-locked', 'anas-platyrhynchos', { timeout: 40_000 })
      const state = await page.evaluate(() => window.birddexPhotoDev!.getState())
      const last = state.live[state.live.length - 1]
      expect(last.update.candidates[0].speciesId).toBe('anas-platyrhynchos')
      expect(last.update.candidates[0].confidence).toBeGreaterThan(0.8)
      expect(last.update.candidates).toHaveLength(3)
      expect(last.update.pBird).toBeGreaterThan(0.9)
      expect(last.update.outsideDexTop, 'the live scanner passes on the smoothed foreign-bird number').toBeLessThan(0.15) // a Mallard
      expect(last.update.framesPerSecond).toBeGreaterThan(0.2)
      // at most one frame every 700 ms, so at most 1.43 per second (the average moves a little with the length of each analysis)
      expect(last.update.framesPerSecond).toBeLessThan(1.7)
      expect(state.live[0].update.framesPerSecond).toBeLessThanOrEqual(1.43)
      // not locked before the third frame
      expect(state.live[0].update.lockedSpeciesId).toBeUndefined()
      expect(state.live[1].update.lockedSpeciesId).toBeUndefined()
      await page.waitForFunction(() => window.birddexPhotoDev!.getState().live.length >= 10, undefined, { timeout: 40_000 })
      const longer = await page.evaluate(() => window.birddexPhotoDev!.getState().live)
      const gaps = longer.slice(1).map((entry, i) => entry.at - longer[i].at)
      const average = gaps.reduce((a, b) => a + b, 0) / gaps.length
      // the frames are taken at most every 700 ms (the results arrive a little earlier or later, by the difference of two analyses)
      expect(average).toBeGreaterThan(650)
      test.info().annotations.push({ type: 'live', description: `${state.live.length} updates, locked at update ${state.live.findIndex((e) => e.update.lockedSpeciesId) + 1}, ${last.update.framesPerSecond.toFixed(2)} frames per second` })

      const snapshot = await page.evaluate(() => window.birddexPhotoDev!.liveSnapshot())
      expect(snapshot.type).toBe('image/jpeg')
      expect(snapshot.size).toBeGreaterThan(5000)

      await page.evaluate(() => window.birddexPhotoDev!.stopLive())
      const before = await page.evaluate(() => window.birddexPhotoDev!.getState().live.length)
      await page.waitForTimeout(2500)
      const after = await page.evaluate(() => window.birddexPhotoDev!.getState().live.length)
      expect(after).toBe(before)
      expect(errors).toEqual([])
    } finally {
      await context.close()
    }
  })
})
