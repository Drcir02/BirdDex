// Developer page for the photo engine and the live scanner: /#/dev/photo. Not in the navigation and not part of the app
// proper; the real screens are built by the scan task. The end-to-end tests (tests/e2e/photo-engine.spec.ts) drive the real
// engine on the real WingCLIP model through it, and read results from the page (data attributes) and from
// window.birddexPhotoDev. You can also open it on a phone: pick a photo and see the three guesses and the timings.
//
// Address options (after the #, like ?x=y): vision=main|worker|auto (where the model runs), short=<pixels> (the shorter
// side the picture is scaled to before the exact resize). The text on the page is Czech from src/i18n; everything else
// is data (names, numbers).

import { useEffect, useReducer, useRef } from 'react'
import { displayName } from '../../data/species'
import type { LiveUpdate } from '../../domain/engines'
import type { Candidate, ModelProgress, Species } from '../../domain/types'
import { formatPercent, t } from '../../i18n'
import type { PhotoDiagnostics, VisionPhotoEngine } from './engine'
import type { BackendMode } from './runtime'
import './DevPhotoPage.css'

export interface DevRow {
  /** File name or the name of a generated picture. */
  label: string
  candidates: Candidate[]
  pBird: number
  diagnostics: PhotoDiagnostics
  /** Names of the guesses, in the same order. */
  names: string[]
}

export interface DevStatus {
  state: 'idle' | 'loading' | 'ready' | 'error'
  ms?: number
  backend?: string
  build?: string
  version?: string
  progress?: ModelProgress
  error?: string
}

interface Stalls {
  maxFrameGapMs: number
  maxTimerGapMs: number
  longTasksMs: number[]
  wallMs: number
}

export interface LiveLogEntry {
  at: number
  update: LiveUpdate
}

/** One option from the address, behind the # like the rest of the app (/#/dev/photo?vision=main). */
function option(name: string): string | null {
  const hash = location.hash
  return new URLSearchParams(hash.includes('?') ? hash.slice(hash.indexOf('?')) : '').get(name)
}

function readMode(): BackendMode {
  const value = option('vision')
  return value === 'main' || value === 'worker' ? value : 'auto'
}

function readShortSide(): number | undefined {
  const value = Number(option('short'))
  return Number.isFinite(value) && value > 0 ? value : undefined
}

// One engine for the page and its test hooks. The engine modules are loaded on demand, like the app does it, so they stay
// out of this page's own chunk.
let engine: Promise<VisionPhotoEngine> | undefined
function getEngine(): Promise<VisionPhotoEngine> {
  engine ??= Promise.all([import('./engine'), import('./runtime')]).then(([{ createPhotoEngine }, { VisionRuntime }]) =>
    createPhotoEngine({ runtime: new VisionRuntime({ mode: readMode(), idleReleaseMs: 0 }) }),
  )
  return engine
}

const state: { status: DevStatus; rows: DevRow[]; live: LiveLogEntry[]; liveError?: string; liveRunning: boolean } = {
  status: { state: 'idle' },
  rows: [],
  live: [],
  liveRunning: false,
}
const listeners = new Set<() => void>()
function patch(change: Partial<typeof state>): void {
  Object.assign(state, change)
  listeners.forEach((listener) => listener())
}

async function prepare(): Promise<DevStatus> {
  const photo = await getEngine()
  if (state.status.state === 'ready') return state.status
  patch({ status: { state: 'loading' } })
  const started = performance.now()
  try {
    await photo.prepare((progress) => patch({ status: { ...state.status, state: 'loading', progress } }))
    const info = photo.runtime.info
    patch({
      status: { state: 'ready', ms: performance.now() - started, backend: photo.runtime.backendKind, build: info?.build, version: info?.ortVersion },
    })
  } catch (error) {
    patch({ status: { state: 'error', error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) } })
    throw error
  }
  return state.status
}

function describe(candidates: Candidate[], list: readonly Species[]): string[] {
  return candidates.map((candidate) => {
    const species = list.find((s) => s.id === candidate.speciesId)
    return species ? displayName(species) : candidate.speciesId
  })
}

async function identify(label: string, source: Parameters<VisionPhotoEngine['identify']>[0], options: { wantEmbedding?: boolean; shortSide?: number } = {}): Promise<DevRow> {
  await prepare()
  const photo = await getEngine()
  const result = await photo.identify(source, { shortSide: readShortSide(), ...options })
  const row: DevRow = {
    label,
    candidates: result.candidates,
    pBird: result.pBird,
    diagnostics: result.diagnostics,
    names: describe(result.candidates, photo.runtime.dex),
  }
  patch({ rows: [...state.rows, row] })
  return row
}

async function identifyBlob(label: string, blob: Blob, options?: { wantEmbedding?: boolean; shortSide?: number }): Promise<DevRow> {
  const { decodeImageFile } = await import('./frame')
  const image = await decodeImageFile(blob)
  try {
    return await identify(label, image, options)
  } finally {
    if ('close' in image) image.close()
  }
}

/** Pictures that are not birds, made on the spot. */
function generated(kind: string): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = 640
  canvas.height = 480
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('no canvas')
  if (kind === 'noise') {
    const image = ctx.createImageData(640, 480)
    let x = 123456789
    for (let i = 0; i < image.data.length; i += 4) {
      for (let c = 0; c < 3; c++) {
        x ^= x << 13
        x ^= x >>> 17
        x ^= x << 5
        image.data[i + c] = (x >>> 0) & 255
      }
      image.data[i + 3] = 255
    }
    ctx.putImageData(image, 0, 0)
  } else if (kind === 'gradient') {
    const gradient = ctx.createLinearGradient(0, 0, 640, 0)
    gradient.addColorStop(0, '#000')
    gradient.addColorStop(1, '#fff')
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, 640, 480)
  } else {
    ctx.fillStyle = kind.startsWith('flat:') ? kind.slice(5) : '#808080'
    ctx.fillRect(0, 0, 640, 480)
  }
  return canvas
}

async function measureStalls<T>(work: () => Promise<T>): Promise<{ result: T; stalls: Stalls }> {
  let maxFrame = 0
  let maxTimer = 0
  let lastFrame = performance.now()
  let lastTimer = performance.now()
  let running = true
  const frame = () => {
    const now = performance.now()
    maxFrame = Math.max(maxFrame, now - lastFrame)
    lastFrame = now
    if (running) requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)
  const timer = setInterval(() => {
    const now = performance.now()
    maxTimer = Math.max(maxTimer, now - lastTimer)
    lastTimer = now
  }, 10)
  const longTasks: number[] = []
  let observer: PerformanceObserver | undefined
  try {
    observer = new PerformanceObserver((list) => list.getEntries().forEach((entry) => longTasks.push(Math.round(entry.duration))))
    observer.observe({ entryTypes: ['longtask'] })
  } catch {
    // No long task API (Safari): the two gap measures still work.
  }
  const started = performance.now()
  try {
    const result = await work()
    // Count the stall that is still going on when the work ends (a run that never let the page breathe).
    await new Promise<void>((resolve) => setTimeout(resolve, 30))
    const now = performance.now()
    maxFrame = Math.max(maxFrame, now - lastFrame)
    maxTimer = Math.max(maxTimer, now - lastTimer)
    return { result, stalls: { maxFrameGapMs: Math.round(maxFrame), maxTimerGapMs: Math.round(maxTimer), longTasksMs: longTasks, wallMs: Math.round(now - started) } }
  } finally {
    running = false
    clearInterval(timer)
    observer?.disconnect()
  }
}

let liveSession: { stop(): void; snapshot(): Promise<Blob> } | undefined
let liveStream: MediaStream | undefined
let liveVideo: HTMLVideoElement | null = null

async function startLive(): Promise<void> {
  if (!liveVideo) throw new Error('no video element')
  await prepare()
  const [{ createLiveScanner }, photo] = await Promise.all([import('./live'), getEngine()])
  liveStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false })
  liveVideo.srcObject = liveStream
  liveVideo.muted = true
  await liveVideo.play()
  const scanner = createLiveScanner({ runtime: photo.runtime })
  const began = performance.now()
  patch({ live: [], liveError: undefined, liveRunning: true })
  liveSession = await scanner.start(liveVideo, {
    onUpdate: (update) => patch({ live: [...state.live, { at: performance.now() - began, update }] }),
    onError: (error) => patch({ liveError: error instanceof Error ? error.message : String(error), liveRunning: false }),
  })
}

function stopLive(): void {
  liveSession?.stop()
  liveStream?.getTracks().forEach((track) => track.stop())
  if (liveVideo) liveVideo.srcObject = null
  liveSession = undefined
  liveStream = undefined
  patch({ liveRunning: false })
}

const hooks = {
  prepare,
  identifyBlob,
  identifyDataUrl: async (label: string, dataUrl: string, options?: { wantEmbedding?: boolean; shortSide?: number }) => identifyBlob(label, await (await fetch(dataUrl)).blob(), options),
  identifyGenerated: (kind: string, options?: { wantEmbedding?: boolean }) => identify(`generated:${kind}`, generated(kind), options),
  measureStalls,
  /** Times `count` identifications of a generated picture, in a row. */
  repeat: async (kind: string, count: number) => {
    const times: number[] = []
    for (let i = 0; i < count; i++) {
      const row = await identify(`generated:${kind}`, generated(kind))
      times.push(row.diagnostics.timings.totalMs)
    }
    return times
  },
  /** The way the real screens will do it: getEngines() from src/ml/engines.ts, the shared model, a decoded picture file. */
  identifyViaEngines: async (dataUrl: string) => {
    const [{ getEngines }, { decodeImageFile }] = await Promise.all([import('../engines'), import('./frame')])
    const engines = getEngines()
    await engines.photo.prepare()
    const image = await decodeImageFile(await (await fetch(dataUrl)).blob())
    const result = await engines.photo.identify(image)
    if ('close' in image) image.close()
    return { result, liveHasStart: typeof engines.live.start === 'function' }
  },
  /** Switches the occurrence prior on (a region of the Dex flags, see createRegionPrior) or off (no argument). */
  setRegionPrior: async (region?: 'czechia' | 'europe') => {
    const [{ setOccurrencePriorProvider, createRegionPrior }, photo] = await Promise.all([import('./prior'), getEngine()])
    await photo.prepare()
    const dex = photo.runtime.dex
    setOccurrencePriorProvider(region ? () => createRegionPrior(dex, region) : undefined)
  },
  startLive,
  stopLive,
  liveSnapshot: async () => {
    if (!liveSession) throw new Error('live camera not running')
    const blob = await liveSession.snapshot()
    return { type: blob.type, size: blob.size }
  },
  getState: () => ({ ...state, rows: [...state.rows], live: [...state.live] }),
  getRuntime: async () => (await getEngine()).runtime,
  getEngine,
  reset: () => patch({ rows: [], live: [] }),
}

declare global {
  interface Window {
    birddexPhotoDev?: typeof hooks
  }
}

function useSnapshot(): void {
  const [, rerender] = useReducer((n: number) => n + 1, 0)
  useEffect(() => {
    listeners.add(rerender)
    return () => {
      listeners.delete(rerender)
    }
  }, [])
}

export default function DevPhotoPage() {
  useSnapshot()
  const videoRef = useRef<HTMLVideoElement | null>(null)

  useEffect(() => {
    window.birddexPhotoDev = hooks
    return () => {
      delete window.birddexPhotoDev
      stopLive()
    }
  }, [])

  const { status, rows, live, liveError, liveRunning } = state
  const lastLive = live[live.length - 1]?.update

  return (
    <main className="dev-photo" data-testid="dev-photo">
      <h1>{t('common.methods.photo')}</h1>

      <section>
        <p
          data-testid="dev-photo-status"
          data-state={status.state}
          data-backend={status.backend ?? ''}
          data-build={status.build ?? ''}
          data-ms={status.ms === undefined ? '' : Math.round(status.ms)}
        >
          {status.state === 'idle' && t('common.start')}
          {status.state === 'loading' &&
            `${t('common.loading')} ${status.progress ? formatPercent(status.progress.totalBytes ? status.progress.loadedBytes / status.progress.totalBytes : 0) : ''}`}
          {status.state === 'ready' && `${t('common.ok')} · ${status.backend} · ${status.build} ${status.version} · ${Math.round(status.ms ?? 0)} ms`}
          {status.state === 'error' && `${t('common.errors.modelLoad')} (${status.error})`}
        </p>
        <div className="dev-photo-actions">
          <button type="button" onClick={() => void prepare().catch(() => undefined)} data-testid="dev-photo-prepare">
            {status.state === 'error' ? t('common.retry') : t('common.start')}
          </button>
          <label>
            {t('common.open')}
            <input
              type="file"
              accept="image/*"
              multiple
              data-testid="dev-photo-input"
              onChange={(event) => {
                const files = Array.from(event.target.files ?? [])
                event.target.value = ''
                void (async () => {
                  for (const file of files) await identifyBlob(file.name, file).catch((error: unknown) => patch({ status: { ...state.status, error: String(error) } }))
                })()
              }}
            />
          </label>
        </div>
      </section>

      <ol className="dev-photo-rows" data-testid="dev-photo-rows">
        {rows.map((row, index) => (
          <li key={index} data-testid="dev-photo-row" data-label={row.label} data-pbird={row.pBird.toFixed(4)} data-top={row.candidates[0]?.speciesId ?? ''} data-ms={Math.round(row.diagnostics.timings.totalMs)}>
            <strong>{row.label}</strong>
            <span>
              {' '}
              {formatPercent(row.pBird)} · {Math.round(row.diagnostics.timings.totalMs)} ms
            </span>
            <ul>
              {row.candidates.map((candidate, i) => (
                <li key={candidate.speciesId}>
                  {row.names[i]} ({candidate.speciesId}) {formatPercent(candidate.confidence)}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>

      <section>
        <h2>{t('common.methods.live')}</h2>
        <video ref={(node) => { videoRef.current = node; liveVideo = node }} playsInline muted data-testid="dev-live-video" className="dev-photo-video" />
        <div className="dev-photo-actions">
          <button type="button" disabled={liveRunning} onClick={() => void startLive().catch((error: unknown) => patch({ liveError: String(error) }))} data-testid="dev-live-start">
            {t('common.start')}
          </button>
          <button type="button" disabled={!liveRunning} onClick={stopLive} data-testid="dev-live-stop">
            {t('common.close')}
          </button>
        </div>
        <p data-testid="dev-live-status" data-updates={live.length} data-locked={lastLive?.lockedSpeciesId ?? ''} data-top={lastLive?.candidates[0]?.speciesId ?? ''} data-running={String(liveRunning)}>
          {lastLive ? `${lastLive.candidates.map((c) => `${c.speciesId} ${formatPercent(c.confidence)}`).join(', ')} · ${lastLive.framesPerSecond.toFixed(1)}/s` : ''}
          {liveError ? ` ${t('common.errors.cameraStalled')} (${liveError})` : ''}
        </p>
      </section>

      <pre data-testid="dev-photo-json" className="dev-photo-json">
        {JSON.stringify(
          rows.map((row) => ({ label: row.label, pBird: row.pBird, candidates: row.candidates, timings: row.diagnostics.timings })),
          null,
          1,
        )}
      </pre>
    </main>
  )
}
