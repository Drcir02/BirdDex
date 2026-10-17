// The one WingCLIP model that the photo engine and the live scanner share.
//
//   const runtime = getVisionRuntime()
//   await runtime.prepare(onProgress)                  // downloads the model files once, starts the worker, loads the model
//   const scores = await runtime.analyse(frame)        // a picture as pixels in, probabilities out
//
// There is only one model in memory (about 150 MB of WebAssembly memory), however many screens use it. It is started on the
// first prepare() or analyse(), and let go again after IDLE_RELEASE_MS without any use (and never while a live camera session
// holds it), because iOS Safari is short of memory and the next prepare() takes only a second or two once the files are on
// the phone.

import { loadSpecies } from '../../data/species'
import type { ProgressCallback } from '../../domain/engines'
import type { ModelProgress, Species } from '../../domain/types'
import { ModelLoadError } from '../runtime/ort'
import { getModelBytes, planDownload, MODEL_FILE_IDS } from '../runtime/modelStore'
import { createInlineBackend, startWorkerBackend, WorkerStartError, type VisionBackend } from './backend'
import { IDLE_RELEASE_MS, WINGCLIP } from './constants'
import type { InitInfo, VisionFrame, VisionRunOptions, VisionScores } from './core'

export type BackendMode = 'auto' | 'worker' | 'main'

export interface VisionRuntimeOptions {
  /** 'auto' (default): a worker, or the main thread if no worker can be started. */
  mode?: BackendMode
  /** Milliseconds without use after which the model is released. 0 keeps it for good. */
  idleReleaseMs?: number
}

export interface RuntimeDeps {
  loadFile(fileId: string, onProgress?: (loadedBytes: number, totalBytes: number) => void): Promise<Uint8Array>
  /** Size of the files, for the progress bar. */
  totalBytes(fileIds: readonly string[]): Promise<number>
  loadSpecies(): Promise<readonly Species[]>
  startWorker(): Promise<VisionBackend>
  startInline(): VisionBackend
  setTimer(callback: () => void, ms: number): unknown
  clearTimer(handle: unknown): void
}

const defaultDeps: RuntimeDeps = {
  loadFile: (fileId, onProgress) => getModelBytes(fileId, onProgress),
  totalBytes: async (fileIds) => (await planDownload(fileIds)).totalBytes,
  loadSpecies,
  startWorker: () => startWorkerBackend(),
  startInline: () => createInlineBackend(),
  setTimer: (callback, ms) => setTimeout(callback, ms),
  clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
}

/** The Dex species that WingCLIP knows, in Dex order: the candidates of every identification. */
export function wingclipSpecies(list: readonly Species[]): Species[] {
  return list.filter((species) => species.wingclipIndex !== null)
}

const MODEL_FILES = [MODEL_FILE_IDS.wingclipGraph, MODEL_FILE_IDS.wingclipData, MODEL_FILE_IDS.wingclipText] as const

export class VisionRuntime {
  private readonly mode: BackendMode
  private readonly idleReleaseMs: number
  private readonly deps: RuntimeDeps
  private readonly listeners = new Set<ProgressCallback>()
  private backend: VisionBackend | undefined
  private species: readonly Species[] = []
  private initInfo: InitInfo | undefined
  private loading: Promise<void> | undefined
  private totalBytes = 0
  private holds = 0
  private busy = 0
  private idleTimer: unknown

  constructor(options: VisionRuntimeOptions = {}, deps: Partial<RuntimeDeps> = {}) {
    this.mode = options.mode ?? 'auto'
    this.idleReleaseMs = options.idleReleaseMs ?? IDLE_RELEASE_MS
    this.deps = { ...defaultDeps, ...deps }
  }

  /** True when a model is loaded and a picture can be analysed at once. */
  get isReady(): boolean {
    return this.backend !== undefined && this.backend.alive
  }

  /** The candidates of every identification: the Dex species WingCLIP knows. Empty before the first prepare(). */
  get dex(): readonly Species[] {
    return this.species
  }

  /** Where the model runs, once it runs. */
  get backendKind(): 'worker' | 'main' | undefined {
    return this.backend?.kind
  }

  get info(): InitInfo | undefined {
    return this.initInfo
  }

  /**
   * Gets everything ready: the model files (downloaded the first time), the Dex list, the worker and the model. Safe to call
   * many times and from many places; the work is done once. A failure is forgotten, so the next call tries again.
   */
  async prepare(onProgress?: ProgressCallback): Promise<void> {
    if (this.isReady) {
      onProgress?.(this.progress('ready'))
      return
    }
    if (onProgress) this.listeners.add(onProgress)
    try {
      this.loading ??= this.load().then(
        () => {
          this.loading = undefined
        },
        (error: unknown) => {
          this.loading = undefined
          throw error
        },
      )
      await this.loading
    } finally {
      if (onProgress) this.listeners.delete(onProgress)
    }
  }

  private progress(stage: ModelProgress['stage'], loadedBytes?: number): ModelProgress {
    return { modelId: WINGCLIP.modelId, stage, loadedBytes: loadedBytes ?? this.totalBytes, totalBytes: this.totalBytes }
  }

  private report(progress: ModelProgress): void {
    for (const listener of [...this.listeners]) listener(progress)
  }

  private async load(): Promise<void> {
    this.clearIdleTimer()
    const species = wingclipSpecies(await this.deps.loadSpecies())
    if (species.length === 0) throw new ModelLoadError('The Dex has no bird that WingCLIP knows')

    this.totalBytes = await this.deps.totalBytes(MODEL_FILES)
    this.report(this.progress('downloading', 0))
    const files: Uint8Array[] = []
    let done = 0
    for (const fileId of MODEL_FILES) {
      const bytes = await this.deps.loadFile(fileId, (loaded) => this.report(this.progress('downloading', Math.min(done + loaded, this.totalBytes))))
      done += bytes.byteLength
      files.push(bytes)
    }
    this.report(this.progress('preparing'))

    const [graph, weights, classifier] = files
    const dexRows = Int32Array.from(species, (s) => s.wingclipIndex as number)
    const backend = await this.startBackend()
    try {
      this.initInfo = await backend.init({ graph, weights, classifier, dexRows })
    } catch (error) {
      await backend.dispose().catch(() => undefined)
      throw error instanceof ModelLoadError ? error : new ModelLoadError('The photo model could not be started', { cause: error })
    }
    this.backend = backend
    this.species = species
    this.report(this.progress('ready'))
    this.scheduleIdleRelease()
  }

  private async startBackend(): Promise<VisionBackend> {
    if (this.mode === 'main') return this.deps.startInline()
    try {
      return await this.deps.startWorker()
    } catch (error) {
      if (this.mode === 'worker' || !(error instanceof WorkerStartError)) throw error
      console.warn('The vision worker could not be started, the model runs on the main thread', error)
      return this.deps.startInline()
    }
  }

  /** Scores one picture. Prepares the model first if that has not happened yet. */
  async analyse(frame: VisionFrame, options?: VisionRunOptions): Promise<VisionScores> {
    await this.prepare()
    const backend = this.backend
    if (!backend) throw new ModelLoadError('The photo model is not loaded')
    this.busy++
    this.clearIdleTimer()
    try {
      return await backend.run(frame, options)
    } catch (error) {
      if (!backend.alive) this.forget(backend)
      throw error
    } finally {
      this.busy--
      this.scheduleIdleRelease()
    }
  }

  /** Keeps the model in memory until the returned function is called (a live camera session holds it this way). */
  hold(): () => void {
    this.holds++
    this.clearIdleTimer()
    let released = false
    return () => {
      if (released) return
      released = true
      this.holds--
      this.scheduleIdleRelease()
    }
  }

  /** Forgets a backend that died, so the next prepare() starts a new one. */
  private forget(backend: VisionBackend): void {
    if (this.backend === backend) {
      this.backend = undefined
      this.initInfo = undefined
    }
  }

  private clearIdleTimer(): void {
    if (this.idleTimer !== undefined) {
      this.deps.clearTimer(this.idleTimer)
      this.idleTimer = undefined
    }
  }

  private scheduleIdleRelease(): void {
    this.clearIdleTimer()
    if (this.idleReleaseMs <= 0 || !this.backend || this.busy > 0 || this.holds > 0) return
    this.idleTimer = this.deps.setTimer(() => {
      this.idleTimer = undefined
      if (this.busy === 0 && this.holds === 0 && !this.loading) void this.dispose().catch(() => undefined)
    }, this.idleReleaseMs)
  }

  /** Frees the model and stops the worker. The next prepare() or analyse() starts it again. */
  async dispose(): Promise<void> {
    this.clearIdleTimer()
    try {
      await this.loading
    } catch {
      // A failed start leaves nothing to free.
    }
    const backend = this.backend
    this.backend = undefined
    this.initInfo = undefined
    await backend?.dispose()
  }
}

// ---------- The shared runtime ----------

let shared: VisionRuntime | undefined

/** The runtime that createPhotoEngine() and createLiveScanner() use unless they are given another one. */
export function getVisionRuntime(): VisionRuntime {
  shared ??= new VisionRuntime()
  return shared
}

/** For tests: frees and forgets the shared runtime. */
export async function resetVisionRuntime(): Promise<void> {
  const old = shared
  shared = undefined
  await old?.dispose()
}
