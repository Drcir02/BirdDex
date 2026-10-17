// The model store: gets the big model files onto the phone once, keeps them there, and hands the bytes to the engines.
//
//   getModelBytes('birdnet-fp16', onProgress)   the bytes of one file (downloads it the first time)
//   ensureModels([...ids], { modelId, onProgress })   makes sure several files are on the phone, with one combined progress
//   planDownload([...ids])                      how much would still have to be downloaded
//   getModelStatus() / subscribeModelStatus()   what is on the phone, for the settings and welcome screens
//   deleteCached()                              frees the space again
//
// How it works:
//   - The list of files comes from models/manifest.json (version 2, written by scripts/fetch-models.mjs).
//   - A file is downloaded as a stream (so there is progress), checked against its SHA-256 from the list, and then
//     kept in Cache Storage under the name "birddex-models-v1". After that the app works with no network.
//   - A download that breaks off is retried and resumed where it stopped (HTTP Range) when the server allows it.
//   - Engines never fetch model files themselves; they ask this store.
//
// Failures are ModelDownloadError, ModelChecksumError and ModelStorageFullError (see modelErrors.ts); screens turn
// them into calm Czech messages with a next step.

import type { ProgressCallback } from '../../domain/engines'
import { isQuotaExceededError } from '../../state/storage'
import { ModelChecksumError, ModelDownloadError, ModelStorageFullError, ModelStoreError, type ModelDownloadReason } from './modelErrors'
import { parseManifest, type ModelFile, type ModelManifest } from './modelManifest'
import { sha256Hex } from './sha256'

export { ModelChecksumError, ModelDownloadError, ModelStorageFullError, ModelStoreError } from './modelErrors'
export type { ModelDownloadReason } from './modelErrors'
export { parseManifest } from './modelManifest'
export type { ModelBenchmark, ModelFile, ModelManifest } from './modelManifest'

/** The Cache Storage cache that holds the downloaded model files. Bump the suffix to throw all old copies away. */
export const MODEL_CACHE_NAME = 'birddex-models-v1'

/** The ids that engines pass to getModelBytes. They match the "id" fields in models/manifest.json. */
export const MODEL_FILE_IDS = {
  /** BirdNET V2.4, FP16: 3 seconds of 48 kHz audio in, 6522 scores out. */
  birdnet: 'birdnet-fp16',
  /** BirdNET's location filter: latitude, longitude and week in, 6522 occurrence scores out. */
  birdnetGeo: 'birdnet-geo-fp16',
  /** WingCLIP image model, the graph (it needs the .data file next to it). */
  wingclipGraph: 'wingclip-onnx',
  /** WingCLIP image model, the weights that belong to the graph. */
  wingclipData: 'wingclip-data',
  /** WingCLIP species classifier: int8 matrix followed by per-row scales, last row is the bird/not-bird probe. */
  wingclipText: 'wingclip-text',
} as const

/** The service worker also caches everything under models/ (see vite.config.ts); deleteCached empties that copy too. */
const SERVICE_WORKER_CACHE_NAME = 'birddex-heavy-v1'

const SHA_HEADER = 'X-Birddex-Sha256'
const MANIFEST_FILE = 'manifest.json'

// ---------- Public types ----------

/** Called while a file downloads. `totalBytes` is the size from the model list. */
export type FileProgressCallback = (loadedBytes: number, totalBytes: number) => void

export type ModelFileState = 'missing' | 'downloading' | 'ready' | 'failed'

export interface ModelFileStatus {
  id: string
  label: string
  file: string
  bytes: number
  state: ModelFileState
  /** Bytes received so far while downloading, the full size when ready, otherwise 0. */
  loadedBytes: number
  /** Why the last download of this file failed. */
  error?: ModelStoreError
}

export type ModelStoreState =
  /** Every file is on the phone. */
  | 'ready'
  /** Some files are on the phone. */
  | 'partial'
  /** None of the files are on the phone. */
  | 'missing'
  /** A download is running right now. */
  | 'downloading'
  /** The last download failed and none is running. */
  | 'failed'
  /** The list of models cannot be read, so nothing is known. */
  | 'unavailable'

export interface ModelStoreStatus {
  state: ModelStoreState
  files: ModelFileStatus[]
  /** Size of all model files together. */
  totalBytes: number
  /** How much of that is already on the phone, including the progress of a running download. */
  readyBytes: number
  /** False where Cache Storage does not work: downloads then only last until the app is closed. */
  persistent: boolean
  /** Why the state is 'unavailable'. */
  error?: ModelStoreError
}

export interface DownloadPlan {
  /** Size of the files asked about. */
  totalBytes: number
  /** How much of that still has to be downloaded. */
  missingBytes: number
  missing: ModelFile[]
}

export interface ModelStoreOptions {
  /** Address of the folder with the models, ending in a slash. Default: the app's own models/ folder. */
  modelsUrl?: string
  fetch?: (input: string, init?: RequestInit) => Promise<Response>
  /** Where to find Cache Storage. Default: the browser's own. */
  getCaches?: () => CacheStorage | undefined
  /** SHA-256 of some bytes as lower-case hex. */
  digest?: (bytes: Uint8Array) => Promise<string>
  /** How much room is left. Default: navigator.storage.estimate(). */
  estimateStorage?: () => Promise<{ quota?: number; usage?: number } | undefined>
  /** Whether the phone says it is online. Default: navigator.onLine. */
  isOnline?: () => boolean | undefined
  /** Pauses between attempts to download a file. The number of attempts is one more than the list is long. Default: 0.8 s, 2.5 s. */
  retryDelaysMs?: number[]
  /** A download that receives nothing for this long is given up and tried again. Default: 30 s. */
  stallTimeoutMs?: number
}

export interface ModelStore {
  getManifest(): Promise<ModelManifest>
  getModelBytes(fileId: string, onProgress?: FileProgressCallback): Promise<Uint8Array>
  ensureModels(fileIds: readonly string[], options?: { modelId?: string; onProgress?: ProgressCallback }): Promise<void>
  planDownload(fileIds: readonly string[]): Promise<DownloadPlan>
  isCached(fileIds: readonly string[]): Promise<boolean>
  getStatus(): Promise<ModelStoreStatus>
  subscribe(listener: (status: ModelStoreStatus) => void): () => void
  deleteCached(): Promise<void>
}

// ---------- Helpers ----------

/** A failure worth another try: the connection broke, the server was busy, the file came up short. */
class TransientFailure extends Error {
  readonly reason: ModelDownloadReason
  readonly status?: number

  constructor(message: string, reason: ModelDownloadReason, status?: number) {
    super(message)
    this.name = 'TransientFailure'
    this.reason = reason
    this.status = status
  }
}

const isTransientStatus = (status: number) => status === 408 || status === 425 || status === 429 || status >= 500

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

const sumBytes = (entries: readonly ModelFile[]) => entries.reduce((total, entry) => total + entry.bytes, 0)

function defaultModelsUrl(): string {
  const page = typeof location === 'undefined' ? 'http://localhost/' : location.href
  return new URL(`${import.meta.env.BASE_URL}models/`, page).href
}

// ---------- The store ----------

export function createModelStore(options: ModelStoreOptions = {}): ModelStore {
  const modelsUrl = options.modelsUrl ?? defaultModelsUrl()
  const fetchFile = options.fetch ?? ((input, init) => globalThis.fetch(input, init))
  const getCaches = options.getCaches ?? (() => (typeof caches === 'undefined' ? undefined : caches))
  const digest = options.digest ?? sha256Hex
  const estimateStorage =
    options.estimateStorage ?? (async () => (typeof navigator !== 'undefined' ? await navigator.storage?.estimate?.() : undefined))
  const isOnline = options.isOnline ?? (() => (typeof navigator === 'undefined' ? undefined : navigator.onLine))
  const retryDelaysMs = options.retryDelaysMs ?? [800, 2500]
  const stallTimeoutMs = options.stallTimeoutMs ?? 30_000

  const keyOf = (entry: ModelFile) => `${modelsUrl}${entry.file}`
  const manifestKey = `${modelsUrl}${MANIFEST_FILE}`

  /** Files known to be in Cache Storage. */
  let readyIds = new Set<string>()
  /** Files being downloaded or whose last download failed. */
  const running = new Map<string, { state: 'downloading' | 'failed'; loadedBytes: number; error?: ModelStoreError }>()
  const downloads = new Map<string, { promise: Promise<Uint8Array>; loaded: number; listeners: Set<FileProgressCallback> }>()
  const listeners = new Set<(status: ModelStoreStatus) => void>()
  let manifestPromise: Promise<ModelManifest> | undefined
  let knownManifest: ModelManifest | undefined
  let persistent = true
  /** Raised by deleteCached, so a download that was running at the time does not put its file back. */
  let generation = 0
  let lastEmit = 0

  // ----- Cache Storage -----

  /** Looking must not create an empty cache, so only the callers that write pass `create`. */
  async function openCache(create = false): Promise<Cache | undefined> {
    try {
      const storage = getCaches()
      if (!storage) {
        persistent = false
        return undefined
      }
      if (!create && !(await storage.has(MODEL_CACHE_NAME))) return undefined
      return await storage.open(MODEL_CACHE_NAME)
    } catch {
      // Some private modes refuse Cache Storage altogether.
      persistent = false
      return undefined
    }
  }

  async function matchStored(cache: Cache, entry: ModelFile): Promise<Response | undefined> {
    try {
      const response = await cache.match(keyOf(entry))
      if (response && response.headers.get(SHA_HEADER) === entry.sha256) return response
      if (response) await cache.delete(keyOf(entry)).catch(() => false) // an older version of the file
    } catch {
      // Treat an unreadable cache like an empty one.
    }
    return undefined
  }

  async function isStored(entry: ModelFile): Promise<boolean> {
    const cache = await openCache()
    return cache ? (await matchStored(cache, entry)) !== undefined : false
  }

  async function readStored(entry: ModelFile): Promise<Uint8Array | undefined> {
    const cache = await openCache()
    if (!cache) return undefined
    const response = await matchStored(cache, entry)
    if (!response) return undefined
    try {
      const bytes = new Uint8Array(await response.arrayBuffer())
      if (bytes.byteLength === entry.bytes) return bytes
    } catch {
      // Fall through: a damaged entry is thrown away and downloaded again.
    }
    await cache.delete(keyOf(entry)).catch(() => false)
    readyIds.delete(entry.id)
    return undefined
  }

  /** Keeps a verified file for later. Returns false when it could not be kept (no Cache Storage) but the bytes are still good. */
  async function keep(entry: ModelFile, bytes: Uint8Array): Promise<boolean> {
    const cache = await openCache(true)
    if (!cache) return false
    try {
      await cache.put(
        keyOf(entry),
        new Response(bytes as BodyInit, {
          headers: { 'Content-Type': 'application/octet-stream', [SHA_HEADER]: entry.sha256, 'X-Birddex-Bytes': String(entry.bytes) },
        }),
      )
      return true
    } catch (error) {
      if (isQuotaExceededError(error)) {
        throw new ModelStorageFullError(`The phone has no room to keep ${entry.file}`, { fileId: entry.id, neededBytes: entry.bytes, cause: error })
      }
      persistent = false
      return false
    }
  }

  async function assertRoom(neededBytes: number, fileId?: string): Promise<void> {
    let estimate: { quota?: number; usage?: number } | undefined
    try {
      estimate = await estimateStorage()
    } catch {
      return
    }
    if (!estimate || typeof estimate.quota !== 'number' || typeof estimate.usage !== 'number' || !(estimate.quota > 0)) return
    const availableBytes = estimate.quota - estimate.usage
    if (availableBytes < neededBytes) {
      throw new ModelStorageFullError('The phone does not have enough free space for the models', { fileId, neededBytes, availableBytes })
    }
  }

  // ----- Manifest -----

  async function fetchManifest(): Promise<ModelManifest> {
    let failure: unknown
    try {
      const response = await fetchFile(manifestKey, { cache: 'no-store' })
      if (!response.ok) {
        throw new ModelDownloadError(`The model list answered with status ${response.status}`, { reason: 'manifest', status: response.status })
      }
      const manifest = parseManifest(await response.json())
      const cache = await openCache(true)
      await cache?.put(manifestKey, new Response(JSON.stringify(manifest), { headers: { 'Content-Type': 'application/json' } })).catch(() => undefined)
      return manifest
    } catch (error) {
      failure = error
    }
    // No network, or this build has no models: use the list from the last time, if there is one.
    try {
      const cache = await openCache()
      const stored = await cache?.match(manifestKey)
      if (stored) return parseManifest(await stored.json())
    } catch {
      // Ignore: report the first failure.
    }
    if (failure instanceof ModelDownloadError) throw failure
    throw new ModelDownloadError('The model list could not be loaded', { reason: isOnline() === false ? 'offline' : 'manifest', cause: failure })
  }

  function getManifest(): Promise<ModelManifest> {
    manifestPromise ??= fetchManifest().then(
      (manifest) => {
        knownManifest = manifest
        return manifest
      },
      (error: unknown) => {
        manifestPromise = undefined // try again next time
        throw error
      },
    )
    return manifestPromise
  }

  function findEntry(manifest: ModelManifest, fileId: string): ModelFile {
    const entry = manifest.files.find((candidate) => candidate.id === fileId)
    if (!entry) throw new ModelDownloadError(`There is no model file called "${fileId}"`, { reason: 'unknown-file', fileId })
    return entry
  }

  // ----- Status -----

  function buildStatus(manifest: ModelManifest): ModelStoreStatus {
    const files: ModelFileStatus[] = manifest.files.map((entry) => {
      const base = { id: entry.id, label: entry.label, file: entry.file, bytes: entry.bytes }
      const job = running.get(entry.id)
      if (job?.state === 'downloading') return { ...base, state: 'downloading', loadedBytes: job.loadedBytes }
      if (readyIds.has(entry.id)) return { ...base, state: 'ready', loadedBytes: entry.bytes }
      if (job?.state === 'failed') return { ...base, state: 'failed', loadedBytes: 0, ...(job.error ? { error: job.error } : {}) }
      return { ...base, state: 'missing', loadedBytes: 0 }
    })
    const states = files.map((file) => file.state)
    let state: ModelStoreState
    if (states.includes('downloading')) state = 'downloading'
    else if (files.length > 0 && states.every((value) => value === 'ready')) state = 'ready'
    else if (states.includes('failed')) state = 'failed'
    else if (states.includes('ready')) state = 'partial'
    else state = 'missing'
    return {
      state,
      files,
      totalBytes: sumBytes(manifest.files),
      readyBytes: files.reduce((total, file) => total + file.loadedBytes, 0),
      persistent,
    }
  }

  /** Tells the listeners. Progress ticks are limited to a few per second; changes of state always go out. */
  function emit(always: boolean): void {
    if (!knownManifest || listeners.size === 0) return
    const now = Date.now()
    if (!always && now - lastEmit < 120) return
    lastEmit = now
    const status = buildStatus(knownManifest)
    listeners.forEach((listener) => listener(status))
  }

  async function refreshReady(manifest: ModelManifest): Promise<void> {
    const cache = await openCache()
    const found = new Set<string>()
    if (cache) for (const entry of manifest.files) if (await matchStored(cache, entry)) found.add(entry.id)
    readyIds = found
  }

  async function getStatus(): Promise<ModelStoreStatus> {
    let manifest: ModelManifest
    try {
      manifest = await getManifest()
    } catch (error) {
      const typed = error instanceof ModelStoreError ? error : new ModelDownloadError('The model list could not be loaded', { reason: 'manifest', cause: error })
      return { state: 'unavailable', files: [], totalBytes: 0, readyBytes: 0, persistent, error: typed }
    }
    await refreshReady(manifest)
    return buildStatus(manifest)
  }

  // ----- Downloading -----

  async function readBody(
    entry: ModelFile,
    buffer: Uint8Array,
    cursor: { received: number },
    onLoaded: (loaded: number) => void,
  ): Promise<void> {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const stillAlive = () => {
      clearTimeout(timer)
      timer = setTimeout(() => controller.abort(), stallTimeoutMs)
    }
    stillAlive()
    try {
      const resuming = cursor.received > 0
      // "?v=" makes the address change whenever the file does, so no cache on the way can serve an old version.
      const response = await fetchFile(`${keyOf(entry)}?v=${entry.sha256.slice(0, 16)}`, {
        signal: controller.signal,
        cache: 'no-store',
        ...(resuming ? { headers: { Range: `bytes=${cursor.received}-` } } : {}),
      })
      stillAlive()

      if (resuming && response.status === 206) {
        const start = /^bytes (\d+)-/.exec(response.headers.get('Content-Range') ?? '')?.[1]
        if (start === undefined || Number(start) !== cursor.received) {
          cursor.received = 0
          throw new TransientFailure('The server answered a different part than asked for', 'network')
        }
      } else if (response.status === 200) {
        cursor.received = 0 // a plain answer: the whole file comes again (also when the server ignores Range)
      } else if (resuming && response.status === 416) {
        cursor.received = 0
        throw new TransientFailure('The server could not resume the download', 'network', 416)
      } else if (isTransientStatus(response.status)) {
        throw new TransientFailure(`Server answered ${response.status} for ${entry.file}`, 'http', response.status)
      } else {
        throw new ModelDownloadError(`Server answered ${response.status} for ${entry.file}`, { reason: 'http', status: response.status, fileId: entry.id })
      }

      const take = (chunk: Uint8Array) => {
        if (cursor.received + chunk.byteLength > entry.bytes) {
          throw new ModelChecksumError(`${entry.file} is bigger than the ${entry.bytes} bytes it should be`, {
            expected: entry.sha256,
            actual: `more than ${entry.bytes} bytes`,
            fileId: entry.id,
          })
        }
        buffer.set(chunk, cursor.received)
        cursor.received += chunk.byteLength
        onLoaded(cursor.received)
      }

      if (response.body) {
        const reader = response.body.getReader()
        try {
          for (;;) {
            const { done, value } = await reader.read()
            if (done) break
            stillAlive()
            take(value)
          }
        } finally {
          reader.cancel().catch(() => undefined)
        }
      } else {
        take(new Uint8Array(await response.arrayBuffer()))
      }
      if (cursor.received < entry.bytes) {
        throw new TransientFailure(`${entry.file} ended after ${cursor.received} of ${entry.bytes} bytes`, 'incomplete')
      }
    } finally {
      clearTimeout(timer)
    }
  }

  function toDownloadError(error: unknown, entry: ModelFile): ModelStoreError {
    if (error instanceof ModelStoreError) return error
    if (error instanceof TransientFailure) {
      return new ModelDownloadError(error.message, { reason: error.reason, status: error.status, fileId: entry.id, cause: error })
    }
    const stalled = (error as { name?: unknown } | null)?.name === 'AbortError'
    return new ModelDownloadError(stalled ? `The download of ${entry.file} stalled` : `The download of ${entry.file} failed`, {
      reason: isOnline() === false ? 'offline' : 'network',
      fileId: entry.id,
      cause: error,
    })
  }

  /** Downloads one file completely, resuming after breaks, and checks it. Returns the verified bytes. */
  async function fetchVerified(entry: ModelFile, onLoaded: (loaded: number) => void): Promise<Uint8Array> {
    const buffer = new Uint8Array(entry.bytes)
    const cursor = { received: 0 }
    const maxAttempts = retryDelaysMs.length + 1
    let attempt = 0
    let mismatches = 0
    for (;;) {
      attempt++
      try {
        await readBody(entry, buffer, cursor, onLoaded)
        const actual = await digest(buffer)
        if (actual === entry.sha256) return buffer
        if (++mismatches >= 2) {
          throw new ModelChecksumError(`${entry.file} does not match its checksum`, { expected: entry.sha256, actual, fileId: entry.id })
        }
        // Something on the way damaged it. Start again from the beginning, once.
        cursor.received = 0
        onLoaded(0)
      } catch (error) {
        if (error instanceof ModelChecksumError || error instanceof ModelStorageFullError || error instanceof ModelDownloadError) throw error
        if (attempt >= maxAttempts || isOnline() === false) throw toDownloadError(error, entry)
        await sleep(retryDelaysMs[Math.min(attempt - 1, retryDelaysMs.length - 1)])
      }
    }
  }

  async function runDownload(entry: ModelFile, job: { loaded: number; listeners: Set<FileProgressCallback> }): Promise<Uint8Array> {
    const startedIn = generation
    running.set(entry.id, { state: 'downloading', loadedBytes: 0 })
    emit(true)
    try {
      if (isOnline() === false) {
        throw new ModelDownloadError('The phone is offline', { reason: 'offline', fileId: entry.id })
      }
      await assertRoom(entry.bytes, entry.id)
      let reportedBytes = 0
      let reportedAt = 0
      const bytes = await fetchVerified(entry, (loaded) => {
        job.loaded = loaded
        running.set(entry.id, { state: 'downloading', loadedBytes: loaded })
        // Chunks arrive many times a second; callers get a step for every 1% or every 100 ms, whichever comes first
        // (plus the very first and last), so a progress bar is smooth without flooding React with updates.
        const now = Date.now()
        const moved = Math.abs(loaded - reportedBytes)
        if (loaded === 0 || loaded === entry.bytes || moved >= entry.bytes / 100 || now - reportedAt >= 100) {
          reportedBytes = loaded
          reportedAt = now
          job.listeners.forEach((listener) => listener(loaded, entry.bytes))
        }
        emit(false)
      })
      const kept = startedIn === generation ? await keep(entry, bytes) : false
      running.delete(entry.id)
      if (kept) readyIds.add(entry.id)
      emit(true)
      return bytes
    } catch (error) {
      const typed = toDownloadError(error, entry)
      running.set(entry.id, { state: 'failed', loadedBytes: 0, error: typed })
      emit(true)
      throw typed
    }
  }

  /** Starts the download of a file, or joins the one that is already running. */
  function download(entry: ModelFile, onProgress?: FileProgressCallback): Promise<Uint8Array> {
    let job = downloads.get(entry.id)
    if (!job) {
      const fresh = { promise: undefined as unknown as Promise<Uint8Array>, loaded: 0, listeners: new Set<FileProgressCallback>() }
      fresh.promise = runDownload(entry, fresh).finally(() => {
        downloads.delete(entry.id)
      })
      downloads.set(entry.id, fresh)
      job = fresh
    }
    if (onProgress) {
      job.listeners.add(onProgress)
      onProgress(job.loaded, entry.bytes)
    }
    return job.promise
  }

  // ----- Public functions -----

  async function getModelBytes(fileId: string, onProgress?: FileProgressCallback): Promise<Uint8Array> {
    const entry = findEntry(await getManifest(), fileId)
    const stored = await readStored(entry)
    if (stored) {
      readyIds.add(entry.id)
      onProgress?.(entry.bytes, entry.bytes)
      return stored
    }
    return download(entry, onProgress)
  }

  async function planDownload(fileIds: readonly string[]): Promise<DownloadPlan> {
    const manifest = await getManifest()
    const entries = [...new Set(fileIds)].map((id) => findEntry(manifest, id))
    const missing: ModelFile[] = []
    for (const entry of entries) if (!(await isStored(entry))) missing.push(entry)
    return { totalBytes: sumBytes(entries), missingBytes: sumBytes(missing), missing }
  }

  async function isCached(fileIds: readonly string[]): Promise<boolean> {
    return (await planDownload(fileIds)).missing.length === 0
  }

  async function ensureModels(fileIds: readonly string[], opts: { modelId?: string; onProgress?: ProgressCallback } = {}): Promise<void> {
    const manifest = await getManifest()
    const entries = [...new Set(fileIds)].map((id) => findEntry(manifest, id))
    const modelId = opts.modelId ?? entries.map((entry) => entry.id).join('+')
    const totalBytes = sumBytes(entries)
    const report = (loadedBytes: number) => opts.onProgress?.({ modelId, stage: 'downloading', loadedBytes, totalBytes })

    const missing: ModelFile[] = []
    for (const entry of entries) if (!(await isStored(entry))) missing.push(entry)
    // Progress counts the files that are already here, so a half-finished set starts where it really is.
    let done = totalBytes - sumBytes(missing)
    report(done)
    if (missing.length === 0) return
    if (isOnline() === false) throw new ModelDownloadError('The phone is offline', { reason: 'offline' })
    await assertRoom(sumBytes(missing))
    // One file at a time: parallel downloads compete for the phone's bandwidth and make the progress meaningless.
    for (const entry of missing) {
      const before = done
      await download(entry, (loaded) => report(before + loaded))
      done += entry.bytes
      report(done)
    }
  }

  function subscribe(listener: (status: ModelStoreStatus) => void): () => void {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }

  async function purgeServiceWorkerCopies(): Promise<void> {
    try {
      const storage = getCaches()
      if (!storage || !(await storage.has(SERVICE_WORKER_CACHE_NAME))) return
      const cache = await storage.open(SERVICE_WORKER_CACHE_NAME)
      const folder = new URL(modelsUrl).pathname
      for (const request of await cache.keys()) {
        const { pathname } = new URL(request.url)
        if (pathname.startsWith(folder) && !pathname.endsWith(`/${MANIFEST_FILE}`)) await cache.delete(request)
      }
    } catch {
      // Best effort: the files in our own cache are gone either way.
    }
  }

  async function deleteCached(): Promise<void> {
    generation++
    try {
      await getCaches()?.delete(MODEL_CACHE_NAME)
    } catch {
      // Nothing to delete, or the browser refused.
    }
    await purgeServiceWorkerCopies()
    readyIds = new Set()
    for (const [id, job] of [...running]) if (job.state === 'failed') running.delete(id)
    emit(true)
  }

  return { getManifest, getModelBytes, ensureModels, planDownload, isCached, getStatus, subscribe, deleteCached }
}

// ---------- The app's own store ----------

const store = createModelStore()

/** The list of model files, from models/manifest.json (or the copy kept from the last time when offline). */
export const getModelManifest = (): Promise<ModelManifest> => store.getManifest()

/**
 * The bytes of one model file. The first time they are downloaded (with progress) and kept for offline use;
 * afterwards they come straight from the phone. Treat the bytes as read-only: they may be shared.
 */
export const getModelBytes = (fileId: string, onProgress?: FileProgressCallback): Promise<Uint8Array> => store.getModelBytes(fileId, onProgress)

/** Makes sure these files are on the phone, downloading what is missing one file at a time, with one combined progress. */
export const ensureModels = (fileIds: readonly string[], options?: { modelId?: string; onProgress?: ProgressCallback }): Promise<void> =>
  store.ensureModels(fileIds, options)

/** How much of these files would still have to be downloaded. Ask before downloading, to warn about mobile data. */
export const planDownload = (fileIds: readonly string[]): Promise<DownloadPlan> => store.planDownload(fileIds)

export const areModelsCached = (fileIds: readonly string[]): Promise<boolean> => store.isCached(fileIds)

export const getModelStatus = (): Promise<ModelStoreStatus> => store.getStatus()

/** Calls the listener whenever a download starts, progresses, finishes or fails, and when the models are deleted. */
export const subscribeModelStatus = (listener: (status: ModelStoreStatus) => void): (() => void) => store.subscribe(listener)

/** Deletes the downloaded models from the phone (also the service worker's copy), to free space. */
export const deleteCached = (): Promise<void> => store.deleteCached()
