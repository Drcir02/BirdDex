// Developer page for the sound engine: /#/dev/sound. Not in the navigation and not part of the app proper (like the Field
// check, it is a plain English diagnostic page). The end-to-end tests in tests/e2e/sound-engine.spec.ts drive the real
// engine through it, in real Chromium with a fake microphone that plays a WAV file, and use window.birddexSoundDev to
// read results. You can open it yourself on a phone to see the engine work: Prepare, Start, make a sound, Stop.

import { useEffect, useReducer } from 'react'
import type { SoundResult, SoundSession, SoundUpdate } from '../../domain/engines'
import type { Candidate, ModelProgress } from '../../domain/types'
import { measureBlock } from '../audio/loudness'
import { decodeWav } from '../audio/wav'
import { TARGET_SAMPLE_RATE } from '../audio/resample'
import { WINDOW_SAMPLES } from '../audio/windowing'
import { isLiteRtLoaded, wasmMemoryBytes } from '../runtime/litert'
import { getModelBytes, MODEL_FILE_IDS } from '../runtime/modelStore'
import type { DisposableSoundEngine, SoundEngineOptions, SoundStartOptions } from './engine'
import type { GeoPrior } from './geo'
import type { WindowInfo } from './pipeline'
import type { WindowScorer } from './scorerProtocol'

// The engine code is loaded on demand, like the real app loads it (src/ml/engines.ts), so it stays in its own chunk
// and this page only adds the buttons.
const engineModule = () => import('./engine')

// ---------- The state the page and the tests look at ----------

interface Snapshot {
  prepared: 'idle' | 'loading' | 'ready' | 'error'
  prepareMs?: number
  progress?: ModelProgress
  running: boolean
  updates: number
  last?: SoundUpdate
  /** Every level value that was reported, in order. */
  levels: number[]
  /** The candidate list each time it changed, with seconds since the start. */
  candidateLog: Array<{ seconds: number; candidates: Candidate[]; hearingBird: boolean; analysedSeconds: number }>
  windows: WindowInfo[]
  capture?: { sampleRate: number; method: string; settings: unknown }
  /** Where BirdNET runs (the page or a worker), and why the worker was not used if it was not. */
  model?: { mode: 'main' | 'worker'; workerError?: string }
  /** How many times BirdNET was loaded (a worker that was shut down for resting is loaded again by the next prepare). */
  modelLoads: number
  result?: { candidates: Candidate[]; clipBytes?: number; clipSeconds?: number; clipUrl?: string; clipRms?: number; clipPeak?: number; clipRate?: number }
  error?: string
  errors: string[]
  startedAt?: number
}

const initial = (): Snapshot => ({ prepared: 'idle', running: false, updates: 0, levels: [], candidateLog: [], windows: [], errors: [], modelLoads: 0 })

let state = initial()
const listeners = new Set<() => void>()
const notify = () => listeners.forEach((listener) => listener())
function patch(change: Partial<Snapshot>): void {
  state = { ...state, ...change }
  notify()
}

// The worker is shut down after a minute of rest in the real app. Here that is off unless a test asks for it.
let engineOptions: SoundEngineOptions = { idleReleaseSeconds: 0 }
let loadedEngine: DisposableSoundEngine | undefined
/** Counts the engines made, so that a slow one from before a configure() cannot become "the" engine after it. */
let engineNumber = 0
let enginePromise = makeEngine()
let session: SoundSession | undefined
let longTasks: Array<{ start: number; duration: number }> = []
let observer: PerformanceObserver | undefined

function makeEngine(): Promise<DisposableSoundEngine> {
  const options = engineOptions
  const number = ++engineNumber
  loadedEngine = undefined
  return engineModule().then(({ createSoundEngine }) => {
    const engine = createSoundEngine({
      ...options,
      onWindow: (info) => patch({ windows: [...state.windows, info] }),
      onCapture: (capture) => patch({ capture }),
      onModel: (model) => patch({ model, modelLoads: state.modelLoads + 1 }),
    })
    if (number === engineNumber) loadedEngine = engine
    return engine
  })
}

const describeError = (error: unknown): string => (error instanceof Error ? `${error.name}: ${error.message}` : String(error))

// ---------- Actions (the buttons call these, and so do the tests) ----------

async function prepare(): Promise<number> {
  const started = performance.now()
  patch({ prepared: 'loading', error: undefined })
  try {
    await (await enginePromise).prepare((progress) => patch({ progress }))
    const prepareMs = performance.now() - started
    patch({ prepared: 'ready', prepareMs })
    return prepareMs
  } catch (error) {
    patch({ prepared: 'error', error: describeError(error) })
    throw error
  }
}

async function start(): Promise<void> {
  // Called from a click: the engine starts the microphone inside this very call.
  state = { ...initial(), prepared: state.prepared, prepareMs: state.prepareMs, progress: state.progress, model: state.model, modelLoads: state.modelLoads, startedAt: performance.now() }
  notify()
  const options: SoundStartOptions = {
    location: pendingLocation,
    date: pendingDate,
    onUpdate: (update) => {
      const seconds = (performance.now() - (state.startedAt ?? performance.now())) / 1000
      const previous = state.last
      const changed = !previous || previous.candidates !== update.candidates || previous.hearingBird !== update.hearingBird
      patch({
        last: update,
        updates: state.updates + 1,
        levels: [...state.levels, update.level],
        candidateLog: changed
          ? [...state.candidateLog, { seconds, candidates: update.candidates, hearingBird: update.hearingBird, analysedSeconds: update.analysedSeconds }]
          : state.candidateLog,
      })
    },
    onError: (error) => patch({ errors: [...state.errors, describeError(error)] }),
  }
  try {
    // Once the engine is loaded (Prepare loads it) start() is called right here, inside the click, as iOS needs.
    session = await (loadedEngine ?? (await enginePromise)).start(options)
    patch({ running: true })
  } catch (error) {
    patch({ error: describeError(error), running: false })
    throw error
  }
}

async function stop(): Promise<SoundResult | undefined> {
  const current = session
  if (!current) return undefined
  session = undefined
  const result = await current.stop()
  const clipUrl = result.clip ? URL.createObjectURL(result.clip) : undefined
  let loudness: { clipRms?: number; clipPeak?: number; clipRate?: number } = {}
  if (result.clip) {
    const wav = decodeWav(new Uint8Array(await result.clip.arrayBuffer()))
    const { rms, peak } = measureBlock(wav.samples)
    loudness = { clipRms: rms, clipPeak: peak, clipRate: wav.sampleRate }
  }
  patch({
    running: false,
    result: { candidates: result.candidates, clipBytes: result.clip?.size, clipSeconds: result.clipSeconds, clipUrl, ...loudness },
  })
  return result
}

let pendingLocation: SoundStartOptions['location']
let pendingDate: Date | undefined

function configure(options: {
  allLabels?: string[] | null
  location?: { lat: number; lon: number } | null
  date?: string | null
  maxScanSeconds?: number
  worker?: boolean
  idleReleaseSeconds?: number
}): void {
  // The location and date are only used when a scan starts. The labels change what the engine reports, so they need a new engine.
  let rebuild = false
  if (options.allLabels !== undefined) {
    engineOptions = { ...engineOptions, allLabels: options.allLabels ?? undefined }
    rebuild = true
  }
  if (options.maxScanSeconds !== undefined) {
    engineOptions = { ...engineOptions, maxScanSeconds: options.maxScanSeconds }
    rebuild = true
  }
  if (options.worker !== undefined) {
    engineOptions = { ...engineOptions, worker: options.worker }
    rebuild = true
  }
  if (options.idleReleaseSeconds !== undefined) {
    engineOptions = { ...engineOptions, idleReleaseSeconds: options.idleReleaseSeconds }
    rebuild = true
  }
  if (options.location !== undefined) pendingLocation = options.location ?? undefined
  if (options.date !== undefined) pendingDate = options.date ? new Date(options.date) : undefined
  if (rebuild) {
    void enginePromise.then((engine) => engine.dispose())
    enginePromise = makeEngine()
    state = initial()
  } else {
    state = { ...initial(), prepared: state.prepared, prepareMs: state.prepareMs, progress: state.progress, model: state.model, modelLoads: state.modelLoads }
  }
  notify()
}

// ---------- Helpers for the parity and speed tests ----------

const modelCache = new Map<string, WindowScorer>()

/** BirdNET for the parity tests: `via` says whether the page or a worker (when it works) runs it. */
async function modelFor(kind: 'fp16' | 'fp32', via: 'main' | 'worker'): Promise<WindowScorer> {
  const key = `${kind}-${via}`
  let model = modelCache.get(key)
  if (!model) {
    const bytes =
      kind === 'fp16'
        ? await getModelBytes(MODEL_FILE_IDS.birdnet)
        : new Uint8Array(await (await fetch(`${import.meta.env.BASE_URL}models/birdnet-v2.4-fp32.tflite`)).arrayBuffer())
    const { loadScorer } = await import('./scorer')
    model = await loadScorer(bytes, { worker: via === 'worker' })
    modelCache.set(key, model)
  }
  return model
}

interface ScoredWindow {
  startS: number
  /** Where the model ran. */
  mode: 'main' | 'worker'
  ms: number
  top5: Array<{ index: number; score: number }>
  /** The scores at the requested positions. */
  at: number[]
  full?: number[]
}

/** Runs BirdNET on windows of a WAV file (served by the test) and returns the scores, like Python's golden.json holds. */
async function scoreFixture(
  url: string,
  starts: number[],
  options: { model?: 'fp16' | 'fp32'; indices?: number[][]; full?: boolean; via?: 'main' | 'worker' } = {},
): Promise<ScoredWindow[]> {
  const wav = decodeWav(new Uint8Array(await (await fetch(url)).arrayBuffer()))
  if (wav.sampleRate !== TARGET_SAMPLE_RATE) throw new Error(`Fixture is ${wav.sampleRate} Hz, expected 48000`)
  const model = await modelFor(options.model ?? 'fp16', options.via ?? 'main')
  const out: ScoredWindow[] = []
  for (const [i, startS] of starts.entries()) {
    const from = Math.round(startS * TARGET_SAMPLE_RATE)
    const window = wav.samples.slice(from, from + WINDOW_SAMPLES)
    const t0 = performance.now()
    const scores = await model.scores(window)
    const ms = performance.now() - t0
    const order = Array.from(scores.keys()).sort((a, b) => scores[b] - scores[a]).slice(0, 5)
    out.push({
      startS,
      mode: model.mode,
      ms,
      top5: order.map((index) => ({ index, score: scores[index] })),
      at: (options.indices?.[i] ?? []).map((index) => scores[index]),
      ...(options.full ? { full: Array.from(scores) } : {}),
    })
  }
  return out
}

/** Times `count` runs of the model on a window of the fixture, after one warm-up run. */
async function benchmark(url: string, count: number, via: 'main' | 'worker' = 'main'): Promise<{ firstMs: number; times: number[]; mode: string }> {
  const wav = decodeWav(new Uint8Array(await (await fetch(url)).arrayBuffer()))
  const model = await modelFor('fp16', via)
  const window = wav.samples.slice(0, WINDOW_SAMPLES)
  const first = performance.now()
  await model.scores(window)
  const firstMs = performance.now() - first
  const times: number[] = []
  for (let i = 0; i < count; i++) {
    const t0 = performance.now()
    await model.scores(window)
    times.push(performance.now() - t0)
  }
  return { firstMs, times, mode: model.mode }
}

/** The location filter on its own: the same call the engine makes. `via` says whether the page or BirdNET's worker runs the model. */
async function geoCheck(
  lat: number,
  lon: number,
  isoDate: string,
  via: 'main' | 'worker' = 'main',
): Promise<{ week: number; top: Array<{ index: number; score: number }>; aboveThreshold: number; scores: number[]; ms: number; cachedAfter: number; mode: string }> {
  const { weekOfYear48 } = await import('./geo')
  const prior = await geoPrior(via)
  const scorer = via === 'worker' ? await modelFor('fp16', 'worker') : undefined
  const date = new Date(isoDate)
  const t0 = performance.now()
  const scores = await prior.scores({ lat, lon }, date, scorer?.geoScores?.bind(scorer))
  const ms = performance.now() - t0
  if (!scores) throw new Error('No scores for this place')
  const order = Array.from(scores.keys()).sort((a, b) => scores[b] - scores[a]).slice(0, 10)
  return {
    week: weekOfYear48(date),
    top: order.map((index) => ({ index, score: scores[index] })),
    aboveThreshold: scores.filter((v) => v >= 0.03).length, // BirdNET Analyzer's species list threshold
    scores: Array.from(scores),
    ms,
    cachedAfter: prior.cached,
    mode: scorer ? scorer.mode : 'main',
  }
}

const geoPriors = new Map<string, Promise<GeoPrior>>()
const geoPrior = (via: 'main' | 'worker') => {
  let prior = geoPriors.get(via)
  if (!prior) {
    prior = import('./geo').then(({ createGeoPrior }) => createGeoPrior(() => getModelBytes(MODEL_FILE_IDS.birdnetGeo)))
    geoPriors.set(via, prior)
  }
  return prior
}

async function memory(): Promise<{ jsHeapUsed?: number; jsHeapTotal?: number; engineWasmBytes: number; pageWasmBytes: number }> {
  const perf = performance as Performance & { memory?: { usedJSHeapSize: number; totalJSHeapSize: number } }
  return {
    jsHeapUsed: perf.memory?.usedJSHeapSize,
    jsHeapTotal: perf.memory?.totalJSHeapSize,
    // The model of the engine, wherever it runs (in its worker or on the page)...
    engineWasmBytes: await (await enginePromise).wasmMemory(),
    // ...and LiteRT.js on the page itself, which only runs when the model (or the location filter) is on the page.
    pageWasmBytes: isLiteRtLoaded() ? await wasmMemoryBytes() : 0,
  }
}

/** The sound engine the screens get from getEngines() (the real one, loaded the way the app loads it), for a few seconds. */
async function throughGetEngines(seconds: number): Promise<{ candidates: Candidate[]; hearingBird: boolean; clipBytes: number | undefined; result: Candidate[]; keys: string[] }> {
  const { getEngines } = await import('../engines')
  const engine = getEngines().sound
  await engine.prepare()
  let last: SoundUpdate | undefined
  const running = await engine.start({ onUpdate: (update) => (last = update) })
  await new Promise((resolve) => setTimeout(resolve, seconds * 1000))
  const result = await running.stop()
  return {
    candidates: last?.candidates ?? [],
    hearingBird: last?.hearingBird ?? false,
    clipBytes: result.clip?.size,
    result: result.candidates,
    keys: Object.keys(engine).sort(),
  }
}

function watchLongTasks(): void {
  longTasks = []
  observer?.disconnect()
  try {
    observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) longTasks.push({ start: entry.startTime, duration: entry.duration })
    })
    observer.observe({ entryTypes: ['longtask'] })
  } catch {
    // This browser has no long task reporting.
  }
}

const api = {
  prepare,
  start,
  stop,
  configure,
  snapshot: (): Snapshot => state,
  scoreFixture,
  benchmark,
  geoCheck,
  throughGetEngines,
  memory,
  watchLongTasks,
  longTasks: () => longTasks,
  /** Frees the model of the current engine (it is compiled again by the next prepare). */
  async reset(): Promise<void> {
    await session?.stop().catch(() => undefined)
    session = undefined
    for (const model of modelCache.values()) model.delete()
    modelCache.clear()
    await (await enginePromise).dispose()
    enginePromise = makeEngine()
    state = initial()
    notify()
  },
}

declare global {
  interface Window {
    birddexSoundDev: typeof api
  }
}
window.birddexSoundDev = api

// ---------- The page ----------

const pad = { padding: '4px 10px', margin: '0 8px 8px 0', fontSize: 16 } as const

export default function DevSoundPage() {
  const [, redraw] = useReducer((n: number) => n + 1, 0)
  useEffect(() => {
    listeners.add(redraw)
    return () => {
      listeners.delete(redraw)
    }
  }, [])
  const s = state
  const last = s.last
  return (
    <main style={{ fontFamily: 'ui-monospace, monospace', padding: 16, maxWidth: 640, margin: '0 auto', color: '#111', background: '#fff', minHeight: '100vh' }}>
      <h1 style={{ fontSize: 20 }}>Sound engine (developer page)</h1>
      <p style={{ fontSize: 13 }}>Prepare downloads and compiles BirdNET. Start listens through the microphone; Stop gives the result and the clip.</p>
      <div>
        <button style={pad} data-testid="dev-prepare" onClick={() => void prepare().catch(() => undefined)}>
          Prepare
        </button>
        <button style={pad} data-testid="dev-start" disabled={s.running} onClick={() => void start().catch(() => undefined)}>
          Start
        </button>
        <button style={pad} data-testid="dev-stop" disabled={!s.running} onClick={() => void stop().catch(() => undefined)}>
          Stop
        </button>
      </div>
      <p data-testid="dev-status">
        models: {s.prepared}
        {s.prepareMs !== undefined ? ` (${Math.round(s.prepareMs)} ms)` : ''}
        {s.progress ? ` · ${s.progress.stage} ${Math.round((100 * s.progress.loadedBytes) / Math.max(1, s.progress.totalBytes))} %` : ''} · {s.running ? 'listening' : 'not listening'}
      </p>
      {s.error && (
        <p data-testid="dev-error" style={{ color: '#b00' }}>
          {s.error}
        </p>
      )}
      <div aria-label="level" style={{ background: '#ddd', height: 14, width: '100%', borderRadius: 7 }}>
        <div data-testid="dev-level" data-level={last?.level ?? 0} style={{ background: '#2a7', height: 14, borderRadius: 7, width: `${Math.round((last?.level ?? 0) * 100)}%` }} />
      </div>
      <p data-testid="dev-analysed">
        analysed {last ? last.analysedSeconds.toFixed(0) : 0} s · {last?.hearingBird ? 'hearing a bird' : 'quiet'} · {s.updates} updates
      </p>
      <ol data-testid="dev-candidates">
        {(last?.candidates ?? []).map((candidate) => (
          <li key={candidate.speciesId}>
            {candidate.speciesId} {candidate.confidence.toFixed(3)}
          </li>
        ))}
      </ol>
      {s.capture && (
        <pre data-testid="dev-capture" style={{ fontSize: 12 }}>
          {JSON.stringify(s.capture)}
        </pre>
      )}
      {s.errors.length > 0 && (
        <pre data-testid="dev-errors" style={{ fontSize: 12, color: '#b00' }}>
          {s.errors.join('\n')}
        </pre>
      )}
      {s.result && (
        <div data-testid="dev-result">
          <p>
            result: {s.result.candidates.map((c) => `${c.speciesId} ${c.confidence.toFixed(2)}`).join(', ') || 'nothing'} · clip {s.result.clipBytes ?? 0} bytes ·{' '}
            {s.result.clipSeconds?.toFixed(2) ?? 0} s
          </p>
          {s.result.clipUrl && <audio controls src={s.result.clipUrl} />}
        </div>
      )}
      <details>
        <summary>windows ({s.windows.length})</summary>
        <pre style={{ fontSize: 12 }}>{s.windows.map((w) => `${w.index}: ${w.endSeconds.toFixed(0)} s, ${w.ms.toFixed(0)} ms, ${w.top[0]?.speciesId ?? '-'} ${(w.top[0]?.confidence ?? 0).toFixed(2)}`).join('\n')}</pre>
      </details>
    </main>
  )
}
