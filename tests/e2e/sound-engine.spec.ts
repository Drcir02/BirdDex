import { existsSync, readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { expect, test as base, type Page } from '@playwright/test'

// The sound engine on the real BirdNET model, in real Chromium, through the developer page /#/dev/sound.
//
//   1. Parity: LiteRT.js in the browser must give the scores Python (ai-edge-litert) gives for the same audio. The
//      numbers to compare with come from scripts/make-audio-golden.py (tests/fixtures/audio/golden*.json).
//   2. The live scan: a fake microphone plays a WAV file; the engine must find the right bird, move the level meter
//      and hand back a proper clip.
//
// How to run (the tests start their own Chromium with the fake microphone file they need, so FAKE_AUDIO_FILE is not
// needed; setting it does no harm):
//   CHROMIUM_PATH=/opt/pw-browsers/chromium E2E_PORT=4184 npx playwright test tests/e2e/sound-engine.spec.ts
// One part only:   ... -g "parity"      ... -g "demo recording"      ... -g "soundscape"
//
// They need the model files in public/models (npm run fetch-models; the FP32 file for the comparison needs --with-fp32).

const AUDIO = 'tests/fixtures/audio'
const DEMO = `${process.cwd()}/${AUDIO}/birdnet-demo-sample.wav`
const SOUNDSCAPE = `${process.cwd()}/${AUDIO}/soundscape-24s.wav`
const haveModels = existsSync('public/models/manifest.json') && existsSync('public/models/birdnet-v2.4-fp16.tflite') && existsSync('public/models/birdnet-v2.4-geo-fp16.tflite')
const haveFp32 = existsSync('public/models/birdnet-v2.4-fp32.tflite')

interface Entry {
  index: number
  label: string
  score: number
}
interface Golden {
  files: Record<string, { seconds: number; windows: Array<{ startS: number; fp16: Entry[]; fp32: Entry[] }> }>
  geo: {
    threshold: number
    places: Array<{
      name: string
      lat: number
      lon: number
      week: number
      countAboveThreshold: number
      dexCountAboveThreshold: number
      watch: Record<string, number>
      top: Entry[]
    }>
  }
}
const golden = JSON.parse(readFileSync(`${AUDIO}/golden.json`, 'utf8')) as Golden
const labelLines = readFileSync('data/birdnet-v2.4/labels_en.txt', 'utf8').split('\n')

base.skip(!haveModels, 'The model files are not in public/models (run npm run fetch-models)')

const test = base

// ---------- Helpers ----------

/**
 * A test with its own Chromium whose microphone plays a WAV file in a loop (Chromium's fake audio device). Set the file
 * with `liveTest.use({ fakeAudioFile })`. This is separate from the browser in playwright.config.ts, which only plays a
 * file when FAKE_AUDIO_FILE is set for the whole run.
 */
const liveTest = base.extend<{ fakeAudioFile: string; blockServiceWorker: boolean }>({
  fakeAudioFile: ['', { option: true }],
  // The app's service worker would answer requests that page.route() is meant to block; some tests need it out of the way.
  blockServiceWorker: [false, { option: true }],
  page: async ({ playwright, fakeAudioFile, blockServiceWorker, baseURL }, use) => {
    const browser = await playwright.chromium.launch({
      executablePath: process.env.CHROMIUM_PATH || undefined,
      args: [
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
        '--autoplay-policy=no-user-gesture-required',
        `--use-file-for-fake-audio-capture=${fakeAudioFile}`,
      ],
    })
    const context = await browser.newContext({
      baseURL,
      permissions: ['microphone', 'geolocation'],
      geolocation: { latitude: 50.08, longitude: 14.43 },
      serviceWorkers: blockServiceWorker ? 'block' : 'allow',
    })
    const page = await context.newPage()
    await use(page)
    await context.close()
    await browser.close()
  },
})

/** Opens the developer page, serves the recordings to it and collects errors. */
async function openHarness(page: Page): Promise<string[]> {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console.error: ${message.text()}`)
  })
  await page.route('**/__fixtures__/*', async (route) => {
    const name = basename(new URL(route.request().url()).pathname)
    if (!['birdnet-demo-sample.wav', 'soundscape-24s.wav'].includes(name)) return route.fulfill({ status: 404 })
    return route.fulfill({ path: `${AUDIO}/${name}`, contentType: 'audio/wav' })
  })
  // Count how often the microphone and the audio context are released.
  await page.addInitScript(() => {
    const counters = { trackStops: 0, contextCloses: 0 }
    ;(window as unknown as { __released: typeof counters }).__released = counters
    const stop = MediaStreamTrack.prototype.stop
    MediaStreamTrack.prototype.stop = function () {
      counters.trackStops++
      return stop.call(this)
    }
    const close = AudioContext.prototype.close
    AudioContext.prototype.close = function () {
      counters.contextCloses++
      return close.call(this)
    }
  })
  await page.goto('/#/dev/sound')
  await page.waitForFunction(() => window.birddexSoundDev !== undefined)
  return errors
}

type Dev = Window['birddexSoundDev']
/** What the page API returns, as the types of the engine module describe it. */
type Snapshot = ReturnType<Dev['snapshot']>

const snapshot = (page: Page): Promise<Snapshot> => page.evaluate(() => window.birddexSoundDev.snapshot())

function note(name: string, value: string): void {
  test.info().annotations.push({ type: name, description: value })
  console.log(`[sound] ${name}: ${value}`)
}

// ---------- 1. Parity with Python ----------

test.describe('parity: LiteRT.js in Chromium against Python (ai-edge-litert)', () => {
  test('FP16 gives the same scores on the demo recording (all 6522 outputs)', async ({ page }) => {
    const errors = await openHarness(page)
    await page.evaluate(() => window.birddexSoundDev.prepare())
    const window0 = golden.files['birdnet-demo-sample.wav'].windows[0]
    const full = JSON.parse(readFileSync(`${AUDIO}/golden-demo-full.json`, 'utf8')) as { scores: number[] }

    const [result] = await page.evaluate(
      (indices) => window.birddexSoundDev.scoreFixture('/__fixtures__/birdnet-demo-sample.wav', [0], { indices: [indices], full: true }),
      window0.fp16.map((entry) => entry.index),
    )

    // The top 5: same birds, scores within 0.02 (the task's limit).
    window0.fp16.forEach((entry, i) => expect(Math.abs(result.at[i] - entry.score), `${entry.label}`).toBeLessThanOrEqual(0.02))
    expect(result.top5[0].index).toBe(window0.fp16[0].index)
    expect(window0.fp16[0].label).toContain('Lesser Redpoll')

    // Everything: the golden file keeps 5 decimals, so differences below 1e-5 are rounding.
    let maxDiff = 0
    result.full!.forEach((value, i) => (maxDiff = Math.max(maxDiff, Math.abs(value - full.scores[i]))))
    note('demo FP16 max difference over all 6522 outputs', maxDiff.toExponential(2))
    note('demo top-5 max difference', Math.max(...window0.fp16.map((entry, i) => Math.abs(result.at[i] - entry.score))).toExponential(2))
    expect(maxDiff).toBeLessThanOrEqual(0.02)
    expect(errors).toEqual([])
  })

  test('FP16 gives the same top 5 on every 3 second window of the soundscape (22 windows, one per second)', async ({ page }) => {
    const errors = await openHarness(page)
    await page.evaluate(() => window.birddexSoundDev.prepare())
    const windows = golden.files['soundscape-24s.wav'].windows
    const results = await page.evaluate(
      ({ starts, indices }) => window.birddexSoundDev.scoreFixture('/__fixtures__/soundscape-24s.wav', starts, { indices }),
      { starts: windows.map((w) => w.startS), indices: windows.map((w) => w.fp16.map((e) => e.index)) },
    )

    let maxDiff = 0
    let leaders = 0
    windows.forEach((expected, w) => {
      expected.fp16.forEach((entry, i) => {
        const diff = Math.abs(results[w].at[i] - entry.score)
        maxDiff = Math.max(maxDiff, diff)
        expect(diff, `window ${expected.startS} s, ${entry.label}`).toBeLessThanOrEqual(0.02)
      })
      // The strongest bird is the same whenever Python has a clear leader (more than 0.05 ahead of the second).
      if (expected.fp16[0].score - expected.fp16[1].score > 0.05) {
        expect(results[w].top5[0].index, `leader of window ${expected.startS} s`).toBe(expected.fp16[0].index)
        leaders++
      }
    })
    note('soundscape FP16 max difference over the golden top-5 scores of 22 windows', maxDiff.toExponential(2))
    note('soundscape windows with a clear leader that matched', `${leaders} of ${windows.length}`)
    expect(leaders).toBeGreaterThan(10)
    expect(errors).toEqual([])
  })

  test('the FP32 model in the browser matches Python FP32, and FP16 stays close to FP32', async ({ page }) => {
    test.skip(!haveFp32, 'public/models/birdnet-v2.4-fp32.tflite is missing (npm run fetch-models -- --with-fp32)')
    const errors = await openHarness(page)
    await page.evaluate(() => window.birddexSoundDev.prepare())
    const files: Array<[string, number[]]> = [
      ['birdnet-demo-sample.wav', [0]],
      ['soundscape-24s.wav', [0, 3, 5, 9, 12, 18]],
    ]
    let jsFp32VsPy32 = 0
    let jsFp16VsPy32 = 0
    for (const [file, starts] of files) {
      const expected = starts.map((s) => golden.files[file].windows.find((w) => w.startS === s)!)
      const indices = expected.map((w) => w.fp32.map((e) => e.index))
      const fp32 = await page.evaluate(([f, s, i]) => window.birddexSoundDev.scoreFixture(`/__fixtures__/${f as string}`, s as number[], { model: 'fp32', indices: i as number[][] }), [file, starts, indices])
      const fp16 = await page.evaluate(([f, s, i]) => window.birddexSoundDev.scoreFixture(`/__fixtures__/${f as string}`, s as number[], { model: 'fp16', indices: i as number[][] }), [file, starts, indices])
      expected.forEach((w, n) =>
        w.fp32.forEach((entry, i) => {
          jsFp32VsPy32 = Math.max(jsFp32VsPy32, Math.abs(fp32[n].at[i] - entry.score))
          jsFp16VsPy32 = Math.max(jsFp16VsPy32, Math.abs(fp16[n].at[i] - entry.score))
        }),
      )
    }
    note('FP32 in Chromium against FP32 in Python, max difference of golden top-5 scores', jsFp32VsPy32.toExponential(2))
    note('FP16 in Chromium against FP32 in Python, max difference of golden top-5 scores', jsFp16VsPy32.toExponential(2))
    expect(jsFp32VsPy32).toBeLessThanOrEqual(0.02)
    expect(jsFp16VsPy32).toBeLessThanOrEqual(0.02) // the app ships FP16: it is as good as FP32 for our purpose
    await page.evaluate(() => window.birddexSoundDev.reset())
    expect(errors).toEqual([])
  })

  test('the location model gives the same answers as Python, and the week is BirdNET\'s 1 to 48', async ({ page }) => {
    const errors = await openHarness(page)
    const fullGeo = JSON.parse(readFileSync(`${AUDIO}/golden-geo-full.json`, 'utf8')) as { scores: number[] }
    let maxDiff = 0
    for (const place of golden.geo.places) {
      // Mid-month dates that fall into the golden week: week = 4 * (month - 1) + (1 to 4).
      const month = Math.floor((place.week - 1) / 4)
      const date = new Date(2026, month, [3, 10, 17, 25][(place.week - 1) % 4], 12).toISOString()
      const got = await page.evaluate(([lat, lon, d]) => window.birddexSoundDev.geoCheck(lat as number, lon as number, d as string), [place.lat, place.lon, date] as const)
      expect(got.week, place.name).toBe(place.week)
      place.top.forEach((entry) => {
        const diff = Math.abs(got.scores[entry.index] - entry.score)
        maxDiff = Math.max(maxDiff, diff)
        expect(diff, `${place.name}, ${entry.label}`).toBeLessThanOrEqual(0.01)
      })
      expect(Math.abs(got.aboveThreshold - place.countAboveThreshold), `${place.name}: birds above 0.03`).toBeLessThanOrEqual(2)
      if (place === golden.geo.places[0]) {
        let full = 0
        got.scores.forEach((value, i) => (full = Math.max(full, Math.abs(value - fullGeo.scores[i]))))
        note('location model, Prague week 20, max difference over all 6522 outputs', full.toExponential(2))
        expect(full).toBeLessThanOrEqual(0.01)
      }
    }
    note('location model max difference over the top 10 of six places', maxDiff.toExponential(2))
    expect(errors).toEqual([])
  })

  test('the same place and week are computed once (the answer is cached)', async ({ page }) => {
    const errors = await openHarness(page)
    const first = await page.evaluate(() => window.birddexSoundDev.geoCheck(50.08, 14.43, '2026-05-14T12:00:00'))
    const second = await page.evaluate(() => window.birddexSoundDev.geoCheck(50.1, 14.4, '2026-05-10T12:00:00')) // same 0.1 degree cell, same week
    expect(second.cachedAfter).toBe(first.cachedAfter)
    expect(second.ms).toBeLessThan(first.ms / 2)
    note('location model first call / cached call', `${Math.round(first.ms)} ms / ${second.ms.toFixed(1)} ms`)
    expect(errors).toEqual([])
  })
})


// ---------- 2. The live scan ----------

const dexIds = new Set((JSON.parse(readFileSync('public/data/species.json', 'utf8')) as Array<{ id: string }>).map((species) => species.id))

/** Taps Prepare and waits until the models are ready. */
async function prepared(page: Page): Promise<void> {
  await page.getByTestId('dev-prepare').click()
  await expect(page.getByTestId('dev-status')).toContainText('models: ready', { timeout: 60_000 })
}

/** Taps Start and waits until `done` is true for the newest snapshot, or the time is up. Returns the seconds it took. */
async function listenUntil(page: Page, done: (snap: Snapshot) => boolean, seconds: number): Promise<number> {
  const began = Date.now()
  await page.getByTestId('dev-start').click()
  await expect(page.getByTestId('dev-stop')).toBeEnabled()
  await expect
    .poll(async () => done(await snapshot(page)), { timeout: seconds * 1000, intervals: [200], message: 'the engine did not report what we waited for in time' })
    .toBe(true)
  return (Date.now() - began) / 1000
}

/** Taps Stop, waits for the result to appear and returns it. */
async function stopAndRead(page: Page): Promise<NonNullable<Snapshot['result']>> {
  await page.getByTestId('dev-stop').click()
  await expect(page.getByTestId('dev-result')).toBeVisible({ timeout: 15_000 })
  return (await snapshot(page)).result!
}

/** The clip's own header, read from the browser, so we do not trust our own decoder to check our own encoder. */
async function clipHeader(page: Page): Promise<{ tag: string; wave: string; format: number; channels: number; rate: number; bits: number; dataBytes: number; fileBytes: number }> {
  return page.evaluate(async () => {
    const url = window.birddexSoundDev.snapshot().result!.clipUrl!
    const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer())
    const view = new DataView(bytes.buffer)
    const text = (at: number) => String.fromCharCode(...bytes.subarray(at, at + 4))
    return {
      tag: text(0),
      wave: text(8),
      format: view.getUint16(20, true),
      channels: view.getUint16(22, true),
      rate: view.getUint32(24, true),
      bits: view.getUint16(34, true),
      dataBytes: view.getUint32(40, true),
      fileBytes: bytes.length,
    }
  })
}

// ---------- The clip against the looped recording ----------

interface LoopMatch {
  /** Where the stretch starts in the clip (in samples). */
  from: number
  /** Sample `i` of the clip is sample `(i + shift) % cycle` of the recording. */
  shift: number
  correlation: number
}

const LOOP_PROBE = 4096

/**
 * Finds loud stretches of a clip in a recording that was played over and over (Chromium's fake microphone), one stretch of
 * about 85 ms for each eighth of the clip. A stretch that does not match anywhere is reported in `failed` (by eighth).
 * Chromium's fake device does not pass samples through bit for bit (correlation is about 0.996, not 1), so this is a
 * search for the best correlation, with every 8th sample for a first guess and every sample to settle it.
 */
function matchClipToLoop(clip: Int16Array, source: Int16Array): { matches: LoopMatch[]; failed: number[] } {
  const cycle = source.length
  const repeated = new Int16Array(cycle + clip.length + LOOP_PROBE)
  for (let i = 0; i < repeated.length; i++) repeated[i] = source[i % cycle]

  const correlationOf = (from: number, shift: number, step: number) => {
    let xy = 0
    let xx = 0
    let yy = 0
    for (let i = from; i < from + LOOP_PROBE; i += step) {
      const x = clip[i]
      const y = repeated[shift + i]
      xy += x * y
      xx += x * x
      yy += y * y
    }
    return xy / Math.sqrt(xx * yy || 1)
  }
  /** The best of `count` shifts, from `first` on and wrapping around the end of the recording. */
  const search = (from: number, first: number, count: number, step: number) => {
    let best = { shift: first, correlation: -2 }
    for (let n = 0; n < count; n++) {
      const shift = (first + n) % cycle
      const correlation = correlationOf(from, shift, step)
      if (correlation > best.correlation) best = { shift, correlation }
    }
    return best
  }
  const wrap = (shift: number) => (shift + cycle) % cycle
  /** Anywhere in the recording at first; later only close to where the last stretch was (the clip is in order). */
  const locate = (from: number, near?: number): LoopMatch => {
    const coarse = near === undefined ? search(from, 0, cycle, 8) : search(from, wrap(near - 3000), 6001, 4)
    return { from, ...search(from, wrap(coarse.shift - 16), 33, 1) }
  }

  const sections = 8
  const matches: LoopMatch[] = []
  const failed: number[] = []
  for (let section = 0; section < sections; section++) {
    const low = Math.floor((clip.length * section) / sections)
    const high = Math.floor((clip.length * (section + 1)) / sections) - LOOP_PROBE
    const chunks: Array<{ from: number; rms: number }> = []
    for (let from = low; from <= high; from += 1024) {
      let energy = 0
      for (let i = from; i < from + LOOP_PROBE; i++) energy += clip[i] * clip[i]
      chunks.push({ from, rms: Math.sqrt(energy / LOOP_PROBE) / 32768 })
    }
    chunks.sort((a, b) => b.rms - a.rms)
    // The loudest few chunks that do not overlap: one that falls on a restart of the recording does not match, the next does.
    const tries: number[] = []
    for (const chunk of chunks) {
      if (chunk.rms < 0.02 || tries.length >= 3) break
      if (tries.every((other) => Math.abs(other - chunk.from) >= LOOP_PROBE)) tries.push(chunk.from)
    }
    if (tries.length === 0) continue // nothing but quiet in this part of the clip
    const found = tries.map((from) => locate(from, matches[matches.length - 1]?.shift)).find((match) => match.correlation > 0.98)
    if (found) matches.push(found)
    else failed.push(section)
  }
  return { matches, failed }
}

/** The 16-bit samples of a WAV file (44 byte header, as encodeWav writes it and the fixtures have it). */
const samplesOfWav = (file: Buffer) => new Int16Array(file.buffer.slice(file.byteOffset + 44, file.byteOffset + file.length))


const released = (page: Page) => page.evaluate(() => (window as unknown as { __released: { trackStops: number; contextCloses: number } }).__released)

liveTest.describe('live scan with the Lesser Redpoll recording as the microphone', () => {
  liveTest.use({ fakeAudioFile: DEMO })

  liveTest('names the Lesser Redpoll with at least 0.6 within 10 seconds, moves the meter and returns a WAV clip', async ({ page }) => {
    const errors = await openHarness(page)
    await prepared(page)

    const seconds = await listenUntil(
      page,
      (snap) => {
        const top = snap.last?.candidates[0]
        return top?.speciesId === 'acanthis-cabaret' && top.confidence >= 0.6
      },
      10,
    )
    note('time until the Lesser Redpoll is the top candidate with 0.6 or more', `${seconds.toFixed(1)} s after the tap`)

    // Let it listen a little more, as a person would, so the level meter has something to show.
    await page.waitForTimeout(2500)
    const live = await snapshot(page)
    const top = live.last!.candidates[0]
    note('top candidate while listening', `${top.speciesId} ${top.confidence.toFixed(3)}`)
    expect(live.last!.hearingBird).toBe(true)
    expect(live.last!.candidates.length).toBeLessThanOrEqual(3)
    for (const candidate of live.last!.candidates) expect(dexIds.has(candidate.speciesId), `${candidate.speciesId} is in the Dex`).toBe(true)

    // The level meter moved: not stuck at zero and not a flat line.
    const levels = live.levels
    note('level meter', `${levels.length} updates, min ${Math.min(...levels).toFixed(3)}, max ${Math.max(...levels).toFixed(3)}`)
    expect(levels.length).toBeGreaterThan(20)
    expect(Math.max(...levels)).toBeGreaterThan(0.05)
    expect(Math.max(...levels) - Math.min(...levels)).toBeGreaterThan(0.02)
    for (const level of levels) {
      expect(level).toBeGreaterThanOrEqual(0)
      expect(level).toBeLessThanOrEqual(1)
    }
    expect(live.capture?.sampleRate).toBe(48000)
    expect(live.model?.mode).toBe('worker') // BirdNET runs in a worker unless the browser cannot do that

    // The microphone is still on until stop().
    expect((await released(page)).trackStops).toBe(0)
    await page.getByTestId('dev-stop').click()
    await expect(page.getByTestId('dev-result')).toBeVisible({ timeout: 15_000 })
    const done = await snapshot(page)
    const result = done.result!

    expect(result.candidates[0].speciesId).toBe('acanthis-cabaret')
    expect(result.candidates[0].confidence).toBeGreaterThanOrEqual(0.6)
    note('result after stop', result.candidates.map((c) => `${c.speciesId} ${c.confidence.toFixed(3)}`).join(', '))

    // The clip: 16-bit mono 48 kHz WAV of the strongest moment, up to 6 seconds (4.5 before the end of the best window, 1.5 after).
    const header = await clipHeader(page)
    expect(header).toMatchObject({ tag: 'RIFF', wave: 'WAVE', format: 1, channels: 1, rate: 48000, bits: 16 })
    expect(header.dataBytes).toBe(header.fileBytes - 44)
    expect(result.clipBytes).toBe(header.fileBytes)
    expect(result.clipSeconds).toBeGreaterThanOrEqual(3)
    expect(result.clipSeconds).toBeLessThanOrEqual(6.01)
    expect(header.dataBytes / 2 / 48000).toBeCloseTo(result.clipSeconds!, 3)
    expect(result.clipRms!).toBeGreaterThan(0.003) // there is sound in it, not silence
    note('clip', `${result.clipSeconds!.toFixed(2)} s, ${header.fileBytes} bytes, RMS ${result.clipRms!.toFixed(4)}`)

    // The clip is the microphone's own sound. Chromium's fake microphone plays the demo recording over and over, so every
    // loud stretch of the clip must be found in that recording, and from one stretch to the next the position in the
    // recording must advance exactly as fast as the clip does. If the chain (worklet, ring buffer, cut, WAV) lost, doubled
    // or reordered even one block of sound, the position would jump. It may jump only where the recording starts over,
    // because Chromium's fake device adds a short pause there (207 samples, 4 ms, when this was written). Where in the clip
    // that restart falls differs from run to run. The exact cut is checked in sound-pipeline.test.ts.
    const clipBytes = Buffer.from(
      await page.evaluate(async () => {
        const bytes = new Uint8Array(await (await fetch(window.birddexSoundDev.snapshot().result!.clipUrl!)).arrayBuffer())
        let binary = ''
        for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
        return btoa(binary)
      }),
      'base64',
    )
    const source = samplesOfWav(readFileSync(DEMO))
    const cycle = source.length
    const { matches, failed } = matchClipToLoop(samplesOfWav(clipBytes), source)
    expect(failed, 'parts of the clip with sound that is nowhere in the recording').toEqual([])
    expect(matches.length).toBeGreaterThanOrEqual(5)
    const correlations = matches.map((match) => match.correlation)
    expect(Math.min(...correlations)).toBeGreaterThan(0.98)
    const jumps: string[] = []
    let worstWithin = 0
    for (let k = 1; k < matches.length; k++) {
      const a = matches[k - 1]
      const b = matches[k]
      let jump = (b.shift - a.shift) % cycle
      if (jump > cycle / 2) jump -= cycle
      if (jump < -cycle / 2) jump += cycle
      const restarts = Math.floor((((a.shift + a.from) % cycle) + (b.from - a.from)) / cycle) // times the recording ended between the two
      const where = `between clip samples ${a.from} and ${b.from} (shift ${a.shift} to ${b.shift}, ${restarts} restart(s))`
      if (restarts === 0) {
        expect(Math.abs(jump), `the recording must advance with the clip ${where}`).toBeLessThanOrEqual(2)
        worstWithin = Math.max(worstWithin, Math.abs(jump))
      } else {
        expect(Math.abs(jump), `only a short pause may follow a restart ${where}`).toBeLessThanOrEqual(2400 * restarts)
        jumps.push(`${jump}`)
      }
    }
    note(
      'clip against the looped recording',
      `${matches.length} stretches of ${Math.round((LOOP_PROBE / 48000) * 1000)} ms matched (correlation ${Math.min(...correlations).toFixed(4)} to ${Math.max(...correlations).toFixed(4)}); ` +
        `the position in the recording advanced with the clip to within ${worstWithin} samples; ` +
        (jumps.length ? `at the restart of the recording it moved by ${jumps.join(', ')} samples (a pause added by Chromium's fake device)` : 'no restart of the recording in this clip'),
    )

    // Everything is released: the microphone tracks are stopped and the audio context is closed.
    const after = await released(page)
    expect(after.trackStops).toBeGreaterThanOrEqual(1)
    expect(after.contextCloses).toBeGreaterThanOrEqual(1)
    expect(errors).toEqual([])
  })

  liveTest('is the engine that getEngines() gives the screens (loaded on first use, real, not the fake)', async ({ page }) => {
    const errors = await openHarness(page)
    const outcome = await page.evaluate(() => window.birddexSoundDev.throughGetEngines(7))
    note('through getEngines()', `${outcome.result.map((c) => `${c.speciesId} ${c.confidence.toFixed(2)}`).join(', ')}; engine keys: ${outcome.keys.join(', ')}`)
    expect(outcome.result[0].speciesId).toBe('acanthis-cabaret')
    expect(outcome.result[0].confidence).toBeGreaterThanOrEqual(0.6)
    expect(outcome.hearingBird).toBe(true)
    expect(outcome.clipBytes).toBeGreaterThan(100_000)
    expect(errors).toEqual([])
  })

  liveTest('still works when the browser will not give a 48 kHz audio context: everything is converted from 44.1 kHz', async ({ page }) => {
    await page.addInitScript(() => {
      const Original = window.AudioContext
      // A browser that ignores the rate we ask for and runs at 44.1 kHz.
      window.AudioContext = class extends Original {
        constructor(options?: AudioContextOptions) {
          super({ ...options, sampleRate: 44100 })
        }
      }
    })
    const errors = await openHarness(page)
    await prepared(page)
    await listenUntil(page, (snap) => snap.last?.candidates[0]?.speciesId === 'acanthis-cabaret' && snap.last.candidates[0].confidence >= 0.6, 12)
    const live = await snapshot(page)
    expect((live.capture as { sampleRate: number }).sampleRate).toBe(44100) // what the browser really gave
    note('44.1 kHz microphone: top candidate', `${live.last!.candidates[0].speciesId} ${live.last!.candidates[0].confidence.toFixed(3)}`)
    const result = await stopAndRead(page)
    expect(result.candidates[0].speciesId).toBe('acanthis-cabaret')
    expect(result.candidates[0].confidence).toBeGreaterThan(0.8) // as good as with a real 48 kHz context
    // The clip is 48 kHz whatever the microphone ran at, and its length matches its content.
    const header = await clipHeader(page)
    expect(header).toMatchObject({ format: 1, channels: 1, rate: 48000, bits: 16 })
    expect(header.dataBytes / 2 / 48000).toBeCloseTo(result.clipSeconds!, 3)
    expect(result.clipSeconds).toBeGreaterThanOrEqual(3)
    expect(result.clipSeconds).toBeLessThanOrEqual(6.01)
    expect(errors).toEqual([])
  })

  liveTest('the location prior weighs the Lesser Redpoll down in Prague (not expected there) but keeps it', async ({ page }) => {
    const errors = await openHarness(page)
    await prepared(page)
    const hear = (snap: Snapshot) => (snap.last?.candidates[0]?.confidence ?? 0) > 0.5 && snap.windows.length >= 3

    await listenUntil(page, hear, 12)
    const without = (await stopAndRead(page)).candidates[0]

    // Prague in May: BirdNET's location model gives the Lesser Redpoll 0.001, far under its 0.03 list threshold.
    await page.evaluate(() => window.birddexSoundDev.configure({ location: { lat: 50.08, lon: 14.43 }, date: '2026-05-14T12:00:00' }))
    await listenUntil(page, hear, 12)
    const withPrague = (await stopAndRead(page)).candidates[0]

    note('Lesser Redpoll confidence without a place / in Prague in May', `${without.confidence.toFixed(3)} / ${withPrague.confidence.toFixed(3)}`)
    expect(without.speciesId).toBe('acanthis-cabaret')
    expect(withPrague.speciesId).toBe('acanthis-cabaret') // still found: a clear recording is not thrown away
    expect(withPrague.confidence / without.confidence).toBeGreaterThan(0.7)
    expect(withPrague.confidence / without.confidence).toBeLessThan(0.9) // weighed down by about 0.8
    expect(errors).toEqual([])
  })

  liveTest('a quick stop after 4 seconds still gives an answer (the last window is analysed on stop)', async ({ page }) => {
    const errors = await openHarness(page)
    await prepared(page)
    await page.getByTestId('dev-start').click()
    await expect(page.getByTestId('dev-stop')).toBeEnabled()
    await page.waitForTimeout(4300) // 3 seconds for the first window, then one more second and a bit
    await page.getByTestId('dev-stop').click()
    await expect(page.getByTestId('dev-result')).toBeVisible({ timeout: 15_000 })
    const result = (await snapshot(page)).result!
    note('quick stop at 4.3 s', result.candidates.map((c) => `${c.speciesId} ${c.confidence.toFixed(2)}`).join(', ') || 'nothing')
    expect(result.candidates[0]?.speciesId).toBe('acanthis-cabaret')
    expect(errors).toEqual([])
  })

  liveTest('stopping before 3 seconds gives no guess and releases the microphone', async ({ page }) => {
    const errors = await openHarness(page)
    await prepared(page)
    await page.getByTestId('dev-start').click()
    await expect(page.getByTestId('dev-stop')).toBeEnabled()
    await page.waitForTimeout(1500)
    await page.getByTestId('dev-stop').click()
    await expect(page.getByTestId('dev-result')).toBeVisible({ timeout: 15_000 })
    const result = (await snapshot(page)).result!
    expect(result.candidates).toEqual([])
    expect((await released(page)).trackStops).toBeGreaterThanOrEqual(1)
    expect(errors).toEqual([])
  })
})

liveTest.describe('BirdNET in a worker, and on the page when the worker cannot be used', () => {
  liveTest.use({ fakeAudioFile: DEMO })

  liveTest('runs in a worker by default, and the page is not blocked while it listens', async ({ page }) => {
    const errors = await openHarness(page)
    await prepared(page)
    expect((await snapshot(page)).model).toEqual({ mode: 'worker' })
    await page.evaluate(() => window.birddexSoundDev.watchLongTasks())
    await listenUntil(page, (snap) => snap.windows.length >= 8, 16)
    const longTasks = await page.evaluate(() => window.birddexSoundDev.longTasks())
    const result = await stopAndRead(page)
    note('page tasks of 50 ms or more during 8 windows with the model in a worker', `${longTasks.length}, longest ${Math.max(0, ...longTasks.map((t) => t.duration)).toFixed(0)} ms`)
    expect(result.candidates[0].speciesId).toBe('acanthis-cabaret')
    // The page only copies audio and draws the meter; BirdNET's 70 to 300 ms per window run in the worker. (On a busy machine a
    // stray task can happen, so this allows a few; with BirdNET on the page every window is one: 11 of 11, up to 344 ms.)
    expect(longTasks.length).toBeLessThanOrEqual(4)
    for (const task of longTasks) expect(task.duration).toBeLessThan(300)
    // LiteRT.js did not start on the page at all: only the worker has it.
    expect((await page.evaluate(() => window.birddexSoundDev.memory())).pageWasmBytes).toBe(0)
    expect(errors).toEqual([])
  })

  liveTest('gives the same scores in the worker as Python gives (the worker changes nothing but where it runs)', async ({ page }) => {
    const errors = await openHarness(page)
    const window0 = golden.files['birdnet-demo-sample.wav'].windows[0]
    const [result] = await page.evaluate(
      (indices) => window.birddexSoundDev.scoreFixture('/__fixtures__/birdnet-demo-sample.wav', [0], { indices: [indices], via: 'worker' }),
      window0.fp16.map((entry) => entry.index),
    )
    expect(result.mode).toBe('worker')
    window0.fp16.forEach((entry, i) => expect(Math.abs(result.at[i] - entry.score), entry.label).toBeLessThanOrEqual(0.02))
    const soundscape = golden.files['soundscape-24s.wav'].windows.filter((w) => w.startS % 4 === 0)
    const more = await page.evaluate(
      ({ starts, indices }) => window.birddexSoundDev.scoreFixture('/__fixtures__/soundscape-24s.wav', starts, { indices, via: 'worker' }),
      { starts: soundscape.map((w) => w.startS), indices: soundscape.map((w) => w.fp16.map((e) => e.index)) },
    )
    let maxDiff = 0
    soundscape.forEach((w, n) =>
      w.fp16.forEach((entry, i) => {
        maxDiff = Math.max(maxDiff, Math.abs(more[n].at[i] - entry.score))
        expect(more[n].mode).toBe('worker')
      }),
    )
    note('worker: max difference to Python over the golden top-5 scores of 6 windows', maxDiff.toExponential(2))
    expect(maxDiff).toBeLessThanOrEqual(0.02)
    expect(errors).toEqual([])
  })

  liveTest('runs the location model in the worker too: same answers as Python, and the page never starts LiteRT.js', async ({ page }) => {
    const errors = await openHarness(page)
    let maxDiff = 0
    for (const place of golden.geo.places.slice(0, 4)) {
      const month = Math.floor((place.week - 1) / 4)
      const date = new Date(2026, month, [3, 10, 17, 25][(place.week - 1) % 4], 12).toISOString()
      const got = await page.evaluate(([lat, lon, d]) => window.birddexSoundDev.geoCheck(lat as number, lon as number, d as string, 'worker'), [place.lat, place.lon, date] as const)
      expect(got.mode).toBe('worker')
      expect(got.week).toBe(place.week)
      place.top.forEach((entry) => {
        maxDiff = Math.max(maxDiff, Math.abs(got.scores[entry.index] - entry.score))
        expect(Math.abs(got.scores[entry.index] - entry.score), `${place.name}, ${entry.label}`).toBeLessThanOrEqual(0.01)
      })
    }
    note('location model in the worker: max difference over the top 10 of four places', maxDiff.toExponential(2))
    expect((await page.evaluate(() => window.birddexSoundDev.memory())).pageWasmBytes).toBe(0)
    expect(errors).toEqual([])
  })

  liveTest('scans with a place without starting LiteRT.js on the page (the worker computes the location filter)', async ({ page }) => {
    const errors = await openHarness(page)
    await page.evaluate(() => window.birddexSoundDev.configure({ location: { lat: 50.08, lon: 14.43 }, date: '2026-05-14T12:00:00' }))
    await prepared(page)
    await listenUntil(page, (snap) => (snap.last?.candidates[0]?.confidence ?? 0) > 0.6, 12)
    const memory = await page.evaluate(() => window.birddexSoundDev.memory())
    const result = await stopAndRead(page)
    note('with a place, BirdNET in a worker: page WebAssembly memory / page JS heap / the worker\'s WebAssembly memory', `${(memory.pageWasmBytes / 1e6).toFixed(0)} MB / ${((memory.jsHeapUsed ?? 0) / 1e6).toFixed(0)} MB / ${(memory.engineWasmBytes / 1e6).toFixed(0)} MB`)
    expect(result.candidates[0].speciesId).toBe('acanthis-cabaret')
    expect(result.candidates[0].confidence).toBeLessThan(0.9) // weighed down: the Lesser Redpoll is not expected in Prague
    expect(memory.pageWasmBytes).toBe(0)
    expect(errors).toEqual([])
  })

  liveTest('gives the worker\'s memory back after a rest, and loads it again for the next scan', async ({ page }) => {
    const errors = await openHarness(page)
    await page.evaluate(() => window.birddexSoundDev.configure({ idleReleaseSeconds: 3 }))
    await prepared(page)
    expect((await snapshot(page)).modelLoads).toBe(1)
    const loaded = await page.evaluate(() => window.birddexSoundDev.memory())
    expect(loaded.engineWasmBytes).toBeGreaterThan(100e6) // BirdNET in the worker: well over 100 MB of WebAssembly memory
    await expect
      .poll(async () => (await page.evaluate(() => window.birddexSoundDev.memory())).engineWasmBytes, { timeout: 15_000, intervals: [500], message: 'the worker was not shut down after resting' })
      .toBe(0)
    // The next time the scan screen opens it is loaded again, and works.
    await prepared(page)
    expect((await snapshot(page)).modelLoads).toBe(2)
    await listenUntil(page, (snap) => (snap.last?.candidates[0]?.confidence ?? 0) > 0.6, 12)
    expect((await stopAndRead(page)).candidates[0].speciesId).toBe('acanthis-cabaret')
    expect(errors).toEqual([])
  })
})

liveTest.describe('offline', () => {
  liveTest.use({ fakeAudioFile: DEMO })

  liveTest('works with no network once the models are on the phone (worker, WebAssembly files and models all come from the phone)', async ({ page }) => {
    liveTest.setTimeout(240_000)
    const errors = await openHarness(page)
    // The first visit: wait for the service worker to take over the page, then scan once so everything gets stored.
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined))
    await page.reload()
    await page.waitForFunction(() => window.birddexSoundDev !== undefined && navigator.serviceWorker.controller !== null)
    await prepared(page)
    await listenUntil(page, (snap) => (snap.last?.candidates[0]?.confidence ?? 0) > 0.6, 12)
    expect((await stopAndRead(page)).candidates[0].speciesId).toBe('acanthis-cabaret')

    // Now the network goes away. The page is opened again from what the phone has stored.
    await page.context().setOffline(true)
    await page.reload()
    await page.waitForFunction(() => window.birddexSoundDev !== undefined)
    await prepared(page)
    expect((await snapshot(page)).model?.mode).toBe('worker')
    await listenUntil(page, (snap) => (snap.last?.candidates[0]?.confidence ?? 0) > 0.6, 12)
    const result = await stopAndRead(page)
    note('offline scan', result.candidates.map((c) => `${c.speciesId} ${c.confidence.toFixed(2)}`).join(', '))
    expect(result.candidates[0].speciesId).toBe('acanthis-cabaret')
    expect(errors.filter((line) => !/Failed to load resource|ERR_INTERNET_DISCONNECTED/i.test(line))).toEqual([])
  })
})

liveTest.describe('when the worker file cannot be loaded', () => {
  liveTest.use({ fakeAudioFile: DEMO, blockServiceWorker: true })

  liveTest('falls back to the page when the worker file cannot be loaded, and the scan still works', async ({ page }) => {
    await page.route('**/assets/birdnet.worker-*.js', (route) => route.abort())
    const errors = await openHarness(page)
    await prepared(page)
    const model = (await snapshot(page)).model!
    note('worker blocked: where BirdNET runs, and why', `${model.mode}: ${model.workerError}`)
    expect(model.mode).toBe('main')
    expect(model.workerError).toBeTruthy()
    await listenUntil(page, (snap) => (snap.last?.candidates[0]?.confidence ?? 0) > 0.6, 12)
    const result = await stopAndRead(page)
    expect(result.candidates[0].speciesId).toBe('acanthis-cabaret')
    expect((await page.evaluate(() => window.birddexSoundDev.memory())).pageWasmBytes).toBeGreaterThan(0) // LiteRT.js runs on the page now
    // The blocked download of the worker file shows up in the console as a network error; nothing else may.
    expect(errors.filter((line) => !/Failed to load resource|worker/i.test(line))).toEqual([])
  })

})

liveTest.describe('numbers for docs/notes/sound-engine.md (load time, memory, time per window)', () => {
  liveTest.use({ fakeAudioFile: DEMO })

  for (const mode of ['worker', 'page'] as const) {
    liveTest(`measures the model load, the memory and the time per window with BirdNET in ${mode === 'worker' ? 'a worker' : 'the page'}`, async ({ page }) => {
      liveTest.setTimeout(240_000)
      const errors = await openHarness(page)
      await page.evaluate((useWorker) => window.birddexSoundDev.configure({ worker: useWorker }), mode === 'worker')

      // The first visit: the model files come from the server, are checked (SHA-256), stored and compiled.
      const first = await page.evaluate(() => window.birddexSoundDev.prepare())
      const afterPrepare = await page.evaluate(() => window.birddexSoundDev.memory())
      if (mode === 'worker') note(`[${mode}] prepare, first visit (download from the local server + checksum + Cache Storage + compile)`, `${Math.round(first)} ms`)

      // Later visits: the page is opened again; the model files are already on the phone.
      await page.reload()
      await page.waitForFunction(() => window.birddexSoundDev !== undefined)
      await page.evaluate((useWorker) => window.birddexSoundDev.configure({ worker: useWorker }), mode === 'worker')
      const warm = await page.evaluate(() => window.birddexSoundDev.prepare())
      note(`[${mode}] prepare, later visits (files from Cache Storage + start the worker + compile)`, `${Math.round(warm)} ms`)
      expect(warm).toBeLessThan(10_000)

      // A real scan of about 14 seconds, with the browser watching for tasks that block the page for 50 ms or more.
      await page.evaluate(() => window.birddexSoundDev.watchLongTasks())
      await listenUntil(page, (snap) => snap.windows.length >= 11, 22)
      const scan = await snapshot(page)
      const longTasks = await page.evaluate(() => window.birddexSoundDev.longTasks())
      const afterScan = await page.evaluate(() => window.birddexSoundDev.memory())
      const ms = scan.windows.map((w) => w.ms).sort((a, b) => a - b)
      note(`[${mode}] scan: time per window as the page sees it (model + scores + ranking), median / worst`, `${ms[Math.floor(ms.length / 2)].toFixed(0)} / ${ms.at(-1)!.toFixed(0)} ms over ${ms.length} windows`)
      note(`[${mode}] scan: windows skipped because analysis was too slow`, String(scan.windows.reduce((sum, w) => sum + w.skipped, 0)))
      note(`[${mode}] scan: page tasks of 50 ms or more`, `${longTasks.length}, longest ${Math.max(0, ...longTasks.map((t) => t.duration)).toFixed(0)} ms`)
      const mb = (bytes: number | undefined) => `${((bytes ?? 0) / 1e6).toFixed(0)} MB`
      note(`[${mode}] memory after prepare: page JS heap / BirdNET's WebAssembly memory`, `${mb(afterPrepare.jsHeapUsed)} / ${mb(afterPrepare.engineWasmBytes)}`)
      note(`[${mode}] memory after the first scan: page JS heap / BirdNET's WebAssembly memory`, `${mb(afterScan.jsHeapUsed)} / ${mb(afterScan.engineWasmBytes)}`)
      await stopAndRead(page)

      // The model alone, with the engine freed first so that only one copy of the model is in memory: one warm-up run, then 20 timed runs.
      await page.evaluate(() => window.birddexSoundDev.reset())
      const bench = await page.evaluate((via) => window.birddexSoundDev.benchmark('/__fixtures__/birdnet-demo-sample.wav', 20, via), mode === 'worker' ? ('worker' as const) : ('main' as const))
      expect(bench.mode).toBe(mode === 'worker' ? 'worker' : 'main')
      const sorted = [...bench.times].sort((a, b) => a - b)
      note(`[${mode}] model only: first run`, `${Math.round(bench.firstMs)} ms`)
      note(`[${mode}] model only: 20 runs median / best / worst`, `${sorted[Math.floor(sorted.length / 2)].toFixed(0)} / ${sorted[0].toFixed(0)} / ${sorted.at(-1)!.toFixed(0)} ms`)

      expect(scan.windows.length).toBeGreaterThanOrEqual(11)
      expect(scan.model?.mode).toBe(mode === 'worker' ? 'worker' : 'main')
      expect(ms[Math.floor(ms.length / 2)]).toBeLessThan(1000) // a very generous limit; the number itself is what the notes record
      expect(afterScan.engineWasmBytes).toBeLessThan(450e6) // about 350 MB: BirdNET needs that much working memory in LiteRT.js
      expect(errors).toEqual([])
    })
  }
})

liveTest.describe('live scan with the North American soundscape as the microphone', () => {
  liveTest.use({ fakeAudioFile: SOUNDSCAPE })

  liveTest('with all labels allowed (debug) the Black-capped Chickadee shows up early', async ({ page }) => {
    const errors = await openHarness(page)
    await page.evaluate((labels) => window.birddexSoundDev.configure({ allLabels: labels }), labelLines)
    await prepared(page)

    const seconds = await listenUntil(page, (snap) => (snap.last?.candidates ?? []).some((c) => c.speciesId === 'poecile-atricapillus'), 10)
    note('time until the Black-capped Chickadee is a candidate', `${seconds.toFixed(1)} s after the tap`)
    expect(seconds).toBeLessThan(9)
    const chickadee = (await snapshot(page)).last!.candidates.find((c) => c.speciesId === 'poecile-atricapillus')!
    expect(chickadee.confidence).toBeGreaterThan(0.4) // (0.81 + 0.19) / 2 in Python's numbers

    await page.getByTestId('dev-stop').click()
    await expect(page.getByTestId('dev-result')).toBeVisible({ timeout: 15_000 })
    const result = (await snapshot(page)).result!
    expect(result.candidates.map((c) => c.speciesId)).toContain('poecile-atricapillus')
    expect(result.clipSeconds).toBeGreaterThan(3)
    expect(errors).toEqual([])
  })

  liveTest('the same recording with the Dex only never names a bird that is not in the Dex, and never a non-bird class', async ({ page }) => {
    const errors = await openHarness(page)
    await prepared(page)
    await listenUntil(page, (snap) => snap.windows.length >= 7, 14)
    await page.getByTestId('dev-stop').click()
    await expect(page.getByTestId('dev-result')).toBeVisible({ timeout: 15_000 })
    const snap = await snapshot(page)
    // Python's raw top 5 of these windows hold North American birds and "Engine"; none of them may get through.
    for (const window of snap.windows) for (const entry of window.top) expect(dexIds.has(entry.speciesId), `${entry.speciesId} in window ${window.index}`).toBe(true)
    for (const candidate of snap.result!.candidates) expect(dexIds.has(candidate.speciesId)).toBe(true)
    expect(snap.windows.length).toBeGreaterThanOrEqual(7)
    note('Dex-only candidates on the North American soundscape', snap.result!.candidates.map((c) => `${c.speciesId} ${c.confidence.toFixed(2)}`).join(', ') || 'none')
    expect(errors).toEqual([])
  })

  liveTest('the location prior keeps a bird that lives at the place and weighs down one that does not', async ({ page }) => {
    const errors = await openHarness(page)
    await page.evaluate((labels) => window.birddexSoundDev.configure({ allLabels: labels }), labelLines)
    await prepared(page)
    const hasChickadee = (snap: Snapshot) => (snap.last?.candidates ?? []).some((c) => c.speciesId === 'poecile-atricapillus')
    const confidence = async () => (await stopAndRead(page)).candidates.find((c) => c.speciesId === 'poecile-atricapillus')!.confidence

    await page.evaluate(() => window.birddexSoundDev.configure({ location: { lat: 40.7, lon: -74.0 }, date: '2026-05-14T12:00:00' })) // New York in May
    await listenUntil(page, hasChickadee, 10)
    const newYork = await confidence()

    await page.evaluate(() => window.birddexSoundDev.configure({ location: { lat: 50.08, lon: 14.43 }, date: '2026-05-14T12:00:00' })) // Prague in May
    await listenUntil(page, hasChickadee, 10)
    const prague = await confidence()

    note('Black-capped Chickadee confidence in New York / in Prague', `${newYork.toFixed(3)} / ${prague.toFixed(3)}`)
    expect(prague / newYork).toBeGreaterThan(0.7)
    expect(prague / newYork).toBeLessThan(0.9)
    expect(errors).toEqual([])
  })
})
