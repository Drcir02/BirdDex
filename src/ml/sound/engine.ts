// The sound identification engine: BirdNET V2.4 listening through the microphone. Implements SoundEngine
// (src/domain/engines.ts); src/ml/engines.ts loads this module the first time a screen needs it.
//
//   const engine = getEngines().sound
//   await engine.prepare(onProgress)                       // downloads (once) and compiles the models
//   const session = await engine.start({ location, onUpdate })   // straight from a tap
//   const { candidates, clip } = await session.stop()
//
// How it works, in order: the microphone gives 48 kHz audio (capture.ts, resampled if the phone insists on another
// rate); every second the newest 3 seconds are cut out (windowing.ts) and BirdNET scores them (birdnet.ts); only the
// birds of the Dex are kept (scores.ts), and those BirdNET's location model does not expect here and now are weighed
// down (geo.ts); the last three windows must agree before a bird counts (aggregate.ts); the loop that ties this
// together is pipeline.ts.

import type { ProgressCallback, SoundEngine, SoundSession } from '../../domain/engines'
import type { ModelProgress } from '../../domain/types'
import { loadSpecies } from '../../data/species'
import { SoundCaptureError, startCapture, type CaptureSettings } from '../audio/capture'
import { FLAT_LIMIT, isOnlyHiss } from '../audio/flatness'
import { TARGET_SAMPLE_RATE } from '../audio/resample'
import { getModelBytes, getModelManifest, ensureModels, MODEL_FILE_IDS } from '../runtime/modelStore'
import { AGGREGATE_DEFAULTS, type AggregateOptions, type WindowScores } from './aggregate'
import { createGeoPrior, GEO_MIN_SPECIES, GEO_THRESHOLD, type GeoPrior } from './geo'
import { SoundPipeline, type WindowInfo } from './pipeline'
import { loadScorer, type WindowScorer } from './scorer'
import { allLabelsLookup, dexLookup, topScores, weightByLocation, type SpeciesLookup } from './scores'

/** The model id screens see in ModelProgress. */
export const SOUND_MODEL_ID = 'birdnet'

/** A scan stops by itself after this long, so a screen that forgets to call stop() cannot leave the microphone on. */
export const MAX_SCAN_SECONDS = 15 * 60

/** A worker that holds BirdNET is shut down this long after the last scan, which returns its 350 MB. */
export const IDLE_RELEASE_SECONDS = 60

/** What start() takes: the options of the SoundEngine contract (location, date, onUpdate, onError). */
export type SoundStartOptions = Parameters<SoundEngine['start']>[0]

export interface SoundEngineOptions {
  /**
   * Debug only. Report every BirdNET label instead of only the Dex birds. Pass the label lines
   * ("Scientific name_Common name", data/birdnet-v2.4/labels_en.txt) so non-Dex birds get an id.
   */
  allLabels?: readonly string[]
  /** Debug only. Called after every analysed window with its timing. */
  onWindow?: (info: WindowInfo) => void
  /** Debug only. Called when the microphone is open, with what the browser really gave. */
  onCapture?: (info: { sampleRate: number; method: string; settings: CaptureSettings }) => void
  /** Debug only. Called when BirdNET is ready, with where it runs and, if the worker did not work, why not. */
  onModel?: (info: { mode: 'main' | 'worker'; workerError?: string }) => void
  /** Run BirdNET in a Web Worker (the default) or, with false, on the page. The page is the fallback when the worker fails. */
  worker?: boolean
  /** Seconds after the last scan when a worker is shut down to give its memory back (0 never). Default 60. */
  idleReleaseSeconds?: number
  /** Overrides for the rules in aggregate.ts (tests and measurements). */
  aggregate?: Partial<AggregateOptions>
  /** Seconds after which a scan stops by itself. */
  maxScanSeconds?: number
  /** Windows whose spectrum is flatter than this are only hiss and are not analysed (flatness.ts). Infinity switches the check off. */
  flatLimit?: number
}

/** The engine, plus a way to free its memory (tests and the developer page use it; screens need not). */
export interface DisposableSoundEngine extends SoundEngine {
  /** Stops a running scan and frees the BirdNET model. The engine can be prepared again afterwards. */
  dispose(): Promise<void>
  /** Bytes of WebAssembly memory held by the model (in its worker, or on the page); 0 when it is not loaded. For measurements. */
  wasmMemory(): Promise<number>
}

interface Ready {
  scorer: WindowScorer
  lookup: SpeciesLookup
  hasGeo: boolean
  totalBytes: number
}

export function createSoundEngine(options: SoundEngineOptions = {}): DisposableSoundEngine {
  const topPerWindow = options.aggregate?.topPerWindow ?? AGGREGATE_DEFAULTS.topPerWindow
  const listeners = new Set<ProgressCallback>()
  const geo: GeoPrior = createGeoPrior(() => getModelBytes(MODEL_FILE_IDS.birdnetGeo))
  let preparing: Promise<Ready> | undefined
  let ready: Ready | undefined
  let active: SoundSession | undefined
  let idleTimer: ReturnType<typeof setTimeout> | undefined
  /** Counts the times the model was freed, so a load that was still going when that happened can tell and clean up after itself. */
  let generation = 0

  const stopIdleTimer = () => {
    if (idleTimer) clearTimeout(idleTimer)
    idleTimer = undefined
  }
  /** Frees BirdNET (a worker takes all its memory with it) and forgets that it was prepared. The next prepare() loads it again. */
  const release = () => {
    stopIdleTimer()
    generation++
    const loading = preparing
    preparing = undefined
    ready = undefined
    void loading?.then((loaded) => loaded.scorer.delete(), () => undefined)
  }
  /** When nothing happens for a while, give a worker's memory back. A model on the page cannot give its memory back. */
  const releaseWhenIdle = () => {
    stopIdleTimer()
    const seconds = options.idleReleaseSeconds ?? IDLE_RELEASE_SECONDS
    if (seconds <= 0 || ready?.scorer.mode !== 'worker') return
    idleTimer = setTimeout(() => {
      if (!active) release()
    }, seconds * 1000)
  }

  const report = (progress: ModelProgress) => {
    for (const listener of [...listeners]) listener(progress)
  }

  async function load(): Promise<Ready> {
    const mine = generation
    const manifest = await getModelManifest()
    const hasGeo = manifest.files.some((file) => file.id === MODEL_FILE_IDS.birdnetGeo)
    const ids: string[] = [MODEL_FILE_IDS.birdnet, ...(hasGeo ? [MODEL_FILE_IDS.birdnetGeo] : [])]
    const totalBytes = manifest.files.filter((file) => ids.includes(file.id)).reduce((sum, file) => sum + file.bytes, 0)

    await ensureModels(ids, { modelId: SOUND_MODEL_ID, onProgress: report })
    report({ modelId: SOUND_MODEL_ID, stage: 'preparing', loadedBytes: totalBytes, totalBytes })

    const [list, bytes] = await Promise.all([loadSpecies(), getModelBytes(MODEL_FILE_IDS.birdnet)])
    let workerError: string | undefined
    const scorer = await loadScorer(bytes, { worker: options.worker, onWorkerFailed: (error) => (workerError = error.message) })
    if (mine !== generation) {
      scorer.delete() // dispose() was called while this was loading: nobody wants the model any more
      throw new Error('The sound engine was shut down while it was loading')
    }
    options.onModel?.({ mode: scorer.mode, ...(workerError ? { workerError } : {}) })
    const lookup = options.allLabels ? allLabelsLookup(options.allLabels, list) : dexLookup(list)
    ready = { scorer, lookup, hasGeo, totalBytes }
    report({ modelId: SOUND_MODEL_ID, stage: 'ready', loadedBytes: totalBytes, totalBytes })
    return ready
  }

  function ensureReady(): Promise<Ready> {
    if (!preparing) {
      const job: Promise<Ready> = load().catch((error: unknown) => {
        if (preparing === job) preparing = undefined // the next try starts again (downloads carry on where they stopped)
        throw error
      })
      preparing = job
    }
    return preparing
  }

  return {
    async wasmMemory() {
      return ready ? ready.scorer.wasmMemory() : 0
    },

    async dispose() {
      await active?.stop().catch(() => undefined)
      active = undefined
      const loading = preparing
      stopIdleTimer()
      generation++
      preparing = undefined
      ready = undefined
      const loaded = await loading?.catch(() => undefined)
      loaded?.scorer.delete()
    },

    async prepare(onProgress) {
      stopIdleTimer()
      if (ready) {
        onProgress?.({ modelId: SOUND_MODEL_ID, stage: 'ready', loadedBytes: ready.totalBytes, totalBytes: ready.totalBytes })
        if (!active) releaseWhenIdle()
        return
      }
      if (onProgress) listeners.add(onProgress)
      try {
        await ensureReady()
      } finally {
        if (onProgress) listeners.delete(onProgress)
      }
      // Opening the scan screen prepares the engine; if nobody scans, a worker gives its memory back after a while.
      if (!active) releaseWhenIdle()
    },

    start(startOptions: SoundStartOptions): Promise<SoundSession> {
      // Everything up to the first `await` runs inside the tap, which is what iOS needs to let the audio start.
      void active?.stop().catch(() => undefined)
      active = undefined
      stopIdleTimer()
      const date = startOptions.date ?? new Date()

      const readyPromise = ensureReady()
      // The bird list for this place and week: the Dex, with birds the location model does not expect here weighed down.
      const lookupPromise: Promise<SpeciesLookup> = readyPromise.then(async (r) => {
        if (!r.hasGeo || !startOptions.location) return r.lookup
        try {
          // Next to BirdNET when it has a worker (the page then never starts LiteRT.js), otherwise right here.
          const scores = await geo.scores(startOptions.location, date, r.scorer.geoScores?.bind(r.scorer))
          return scores ? weightByLocation(r.lookup, scores, GEO_THRESHOLD, GEO_MIN_SPECIES) : r.lookup
        } catch (error) {
          console.warn('The location filter could not run, using the whole Dex', error)
          return r.lookup
        }
      })

      lookupPromise.catch(() => undefined) // a failed start is reported through readyPromise; this copy must not be "unhandled"

      const analyse = async (window: Float32Array, end: number): Promise<WindowScores> => {
        // BirdNET hears a woodpecker in flat noise at any loudness (0.55), the same score as a faint real bird: skip such windows.
        if (isOnlyHiss(window, TARGET_SAMPLE_RATE, options.flatLimit ?? FLAT_LIMIT)) return { end, top: [] }
        const [{ scorer }, lookup] = await Promise.all([readyPromise, lookupPromise])
        const scores = await scorer.scores(window)
        const top = topScores(scores, lookup.indices, topPerWindow, lookup.weights).map((entry) => ({
          speciesId: lookup.idOf(entry.index) ?? `birdnet-${entry.index}`,
          confidence: entry.score,
        }))
        return { end, top }
      }

      const pipeline = new SoundPipeline({
        analyse,
        onUpdate: startOptions.onUpdate,
        onError: (error) => {
          console.warn('Analysing a window failed', error)
          startOptions.onError?.(error)
        },
        onWindow: options.onWindow,
        aggregate: options.aggregate,
      })

      const capturing = startCapture({
        onBlock: (samples, rms, peak, rate) => pipeline.push(samples, rms, peak, rate),
        onEnded: (reason) => startOptions.onError?.(new SoundCaptureError(reason, 'The microphone stopped')),
      })

      return (async () => {
        const [capture] = await Promise.all([capturing, readyPromise]).catch((error: unknown) => {
          // Whichever of the two did work must be undone: the microphone must not stay on.
          void capturing.then((c) => c.stop(), () => undefined)
          void pipeline.finish().catch(() => undefined)
          throw error
        })
        options.onCapture?.({ sampleRate: capture.sampleRate, method: capture.method, settings: capture.settings })

        let timer: ReturnType<typeof setTimeout> | undefined
        let stopping: ReturnType<SoundSession['stop']> | undefined
        const session: SoundSession = {
          stop() {
            stopping ??= (async () => {
              if (timer) clearTimeout(timer)
              await capture.stop().catch(() => undefined) // release the microphone first
              const result = await pipeline.finish()
              if (active === session) {
                active = undefined
                releaseWhenIdle()
              }
              return result
            })()
            return stopping
          },
        }
        timer = setTimeout(() => {
          startOptions.onError?.(new SoundCaptureError('timeout', 'The scan ran out of time and stopped'))
          void session.stop().catch(() => undefined)
        }, (options.maxScanSeconds ?? MAX_SCAN_SECONDS) * 1000)
        active = session
        return session
      })()
    },
  }
}
