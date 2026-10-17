// "Is the bird brain (the models) on the phone, and is the engine ready?" worked out as plain functions.
// The hook that uses them is useModelReadiness.ts; the banner that shows the result is ModelBanner.tsx.
//
// Two sources of truth, because there are two kinds of engines:
//   real engines: the model store knows which files are on the phone (src/ml/runtime/modelStore.ts, useModelStatus());
//   fake engines (?engines=fake, for tests and demos): they pretend to download, so a small memory of "this was
//   prepared already" stands in for the model store.

import type { Engines } from '../../domain/engines'
import type { ModelProgress } from '../../domain/types'
import { MODEL_FILE_IDS, type ModelStoreStatus } from '../../ml/runtime/modelStore'
import { classifyScanError, type ScanErrorKind } from './errors'

export type ReadinessKind = 'sound' | 'photo' | 'live' | 'all'

const SOUND_FILES: readonly string[] = [MODEL_FILE_IDS.birdnet, MODEL_FILE_IDS.birdnetGeo]
const PHOTO_FILES: readonly string[] = [MODEL_FILE_IDS.wingclipGraph, MODEL_FILE_IDS.wingclipData, MODEL_FILE_IDS.wingclipText]

/** Used by the photo and live screens when present (the occurrence prior), fetched quietly after the main model. */
export const PHOTO_EXTRA_FILES: readonly string[] = [MODEL_FILE_IDS.birdnetGeo]

/** The model files a screen needs. The live camera shares the model of the photo screen. */
export function modelFilesFor(kind: ReadinessKind): readonly string[] {
  switch (kind) {
    case 'sound':
      return SOUND_FILES
    case 'photo':
    case 'live':
      return PHOTO_FILES
    case 'all':
      return [...SOUND_FILES, ...PHOTO_FILES]
  }
}

// ---------- What the model store says ----------

export interface StatusSummary {
  state: 'unknown' | 'unavailable' | 'missing' | 'downloading' | 'ready'
  /** Size of the files asked about. */
  totalBytes: number
  /** How much of that is on the phone, or has arrived so far in a running download. */
  loadedBytes: number
  /** How much would still have to be downloaded. */
  missingBytes: number
  error?: unknown
}

/** The part of the model store's status that concerns `fileIds`. */
export function summarizeStatus(status: ModelStoreStatus | undefined, fileIds: readonly string[]): StatusSummary {
  if (!status) return { state: 'unknown', totalBytes: 0, loadedBytes: 0, missingBytes: 0 }
  const files = status.files.filter((file) => fileIds.includes(file.id))
  if (status.state === 'unavailable' || files.length === 0) {
    return { state: 'unavailable', totalBytes: 0, loadedBytes: 0, missingBytes: 0, error: status.error }
  }
  const totalBytes = files.reduce((sum, file) => sum + file.bytes, 0)
  const loadedBytes = files.reduce((sum, file) => sum + file.loadedBytes, 0)
  const missingBytes = files.reduce((sum, file) => sum + (file.state === 'ready' ? 0 : file.bytes), 0)
  const state = files.some((file) => file.state === 'downloading') ? 'downloading' : files.every((file) => file.state === 'ready') ? 'ready' : 'missing'
  return { state, totalBytes, loadedBytes, missingBytes }
}

// ---------- The run: our own call of prepare() ----------

export type PrepareStage = 'downloading' | 'preparing'

export interface PrepareProgress {
  stage: PrepareStage
  loadedBytes: number
  totalBytes: number
}

export interface RunState {
  run: 'idle' | 'running' | 'done' | 'failed'
  stage: PrepareStage
  loadedBytes: number
  totalBytes: number
  error?: ScanErrorKind
}

export const IDLE_RUN: RunState = { run: 'idle', stage: 'preparing', loadedBytes: 0, totalBytes: 0 }

export type RunAction =
  /** `downloading`: the person asked for the download, so the bar shows at once (at zero) instead of a spinner. */
  | { type: 'start'; downloading?: boolean; totalBytes?: number }
  | ({ type: 'progress' } & PrepareProgress)
  | { type: 'done' }
  | { type: 'failed'; error: ScanErrorKind }
  | { type: 'reset' }

export function runReducer(state: RunState, action: RunAction): RunState {
  switch (action.type) {
    case 'start':
      return {
        run: 'running',
        stage: action.downloading ? 'downloading' : 'preparing',
        loadedBytes: 0,
        totalBytes: action.totalBytes ?? state.totalBytes,
      }
    case 'progress':
      return state.run === 'running' ? { run: 'running', stage: action.stage, loadedBytes: action.loadedBytes, totalBytes: action.totalBytes } : state
    case 'done':
      return { ...state, run: 'done', stage: 'preparing', loadedBytes: state.totalBytes }
    case 'failed':
      return { run: 'failed', stage: 'preparing', loadedBytes: 0, totalBytes: state.totalBytes, error: action.error }
    case 'reset':
      return IDLE_RUN
  }
}

// ---------- What the screen shows ----------

export type ReadinessPhase = 'checking' | 'needed' | 'working' | 'ready' | 'error'

export interface ReadinessView {
  phase: ReadinessPhase
  /** While working: downloading (with a progress bar) or only starting the engine (a spinner). */
  stage: PrepareStage
  /** 0 to 1 of the download. */
  fraction: number
  loadedBytes: number
  totalBytes: number
  /** How much would be downloaded when the person presses the button. */
  needBytes: number
  error?: ScanErrorKind
  /** The files are here and the screen wants the engine: the hook should start preparing now. */
  startNow: boolean
}

export interface ReadinessInput {
  run: RunState
  summary: StatusSummary
  /** Fake engines are in use: the model store is not asked. */
  fake: boolean
  /** Fake engines only: this kind was prepared before in this page session. */
  fakePrepared: boolean
  /** Fake engines only: how big the pretend download is. */
  fakeBytes: number
  /** Start the engine by itself as soon as the files are here (scan screens), instead of only showing "ready" (the hub). */
  autoPrepare: boolean
}

const fractionOf = (loaded: number, total: number): number => (total > 0 ? Math.min(1, Math.max(0, loaded / total)) : 0)

export function deriveReadiness({ run, summary, fake, fakePrepared, fakeBytes, autoPrepare }: ReadinessInput): ReadinessView {
  const base = { stage: 'preparing' as PrepareStage, fraction: 0, loadedBytes: 0, totalBytes: 0, needBytes: 0, startNow: false }
  if (run.run === 'failed') return { ...base, phase: 'error', error: run.error ?? 'generic', totalBytes: run.totalBytes }
  if (run.run === 'running') {
    return { ...base, phase: 'working', stage: run.stage, fraction: fractionOf(run.loadedBytes, run.totalBytes), loadedBytes: run.loadedBytes, totalBytes: run.totalBytes }
  }
  if (run.run === 'done') return { ...base, phase: 'ready', fraction: 1, loadedBytes: run.totalBytes, totalBytes: run.totalBytes }

  // Nothing of ours is running. Look at what is on the phone.
  // The files are here: a scan screen starts the engine by itself, the hub only says that all is well.
  const filesAreHere = (): ReadinessView =>
    autoPrepare ? { ...base, phase: 'working', stage: 'preparing', fraction: 1, startNow: true } : { ...base, phase: 'ready', fraction: 1 }

  if (fake) {
    return fakePrepared ? filesAreHere() : { ...base, phase: 'needed', needBytes: fakeBytes, totalBytes: fakeBytes }
  }
  switch (summary.state) {
    case 'unknown':
      return { ...base, phase: 'checking' }
    case 'unavailable': {
      const kind = classifyScanError(summary.error)
      return { ...base, phase: 'error', error: kind === 'generic' ? 'modelDownload' : kind }
    }
    case 'downloading':
      // Somebody else (another screen) is downloading: show its progress, and take over when it is done.
      return {
        ...base,
        phase: 'working',
        stage: 'downloading',
        fraction: fractionOf(summary.loadedBytes, summary.totalBytes),
        loadedBytes: summary.loadedBytes,
        totalBytes: summary.totalBytes,
        needBytes: summary.missingBytes,
      }
    case 'missing':
      return { ...base, phase: 'needed', needBytes: summary.missingBytes, totalBytes: summary.totalBytes }
    case 'ready':
      return filesAreHere()
  }
}

// ---------- Fake engines: remembering what was "downloaded" ----------

const fakePreparedKinds = new Set<'sound' | 'photo'>()

function kindsOf(kind: ReadinessKind): Array<'sound' | 'photo'> {
  return kind === 'sound' ? ['sound'] : kind === 'all' ? ['sound', 'photo'] : ['photo']
}

export function markPrepared(kind: ReadinessKind): void {
  for (const part of kindsOf(kind)) fakePreparedKinds.add(part)
}

export function isFakePrepared(kind: ReadinessKind): boolean {
  return kindsOf(kind).every((part) => fakePreparedKinds.has(part))
}

/** For tests. */
export function resetFakePrepared(): void {
  fakePreparedKinds.clear()
}

/** The sizes of the real model files, for the pretend downloads of the fake engines (the numbers the fakes use too). */
export const FAKE_BYTES = { sound: 25_932_528 + 14_770_468, photo: 14_386_564 + 25_165_824 + 8_488_140 } as const

export function fakeBytesFor(kind: ReadinessKind): number {
  return kindsOf(kind).reduce((sum, part) => sum + FAKE_BYTES[part], 0)
}

// ---------- Preparing the engines ----------

function toProgress(progress: ModelProgress): PrepareProgress {
  if (progress.stage === 'downloading') return { stage: 'downloading', loadedBytes: progress.loadedBytes, totalBytes: progress.totalBytes }
  // Preparing and ready: the files are here, the engine is starting.
  return { stage: 'preparing', loadedBytes: progress.totalBytes, totalBytes: progress.totalBytes }
}

/**
 * Downloads (the first time) and prepares the engine a screen needs, reporting one progress for all of it.
 * `totals` are the sizes to use until an engine reports its own (the hub prepares the sound and the photo engine in
 * turn, and shows one bar for both).
 */
export async function prepareKind(
  kind: ReadinessKind,
  engines: Pick<Engines, 'sound' | 'photo'>,
  onProgress: (progress: PrepareProgress) => void,
  totals: { sound: number; photo: number },
  /**
   * Fetches files in the background, for nothing the screen waits for: the 15 MB location model, which improves photo
   * answers (a Common Goldeneye against Barrow's Goldeneye) but is not needed for them. Real engines only; failures are ignored.
   */
  fetchInBackground?: (fileIds: readonly string[]) => Promise<void>,
): Promise<void> {
  if (kind === 'sound') return engines.sound.prepare((progress) => onProgress(toProgress(progress)))
  if (kind === 'photo' || kind === 'live') {
    await engines.photo.prepare((progress) => onProgress(toProgress(progress)))
    if (fetchInBackground) void fetchInBackground(PHOTO_EXTRA_FILES).catch(() => undefined)
    return
  }

  let soundTotal = totals.sound
  let photoTotal = totals.photo
  await engines.sound.prepare((progress) => {
    const mapped = toProgress(progress)
    soundTotal = mapped.totalBytes || soundTotal
    onProgress({ stage: mapped.stage, loadedBytes: mapped.loadedBytes, totalBytes: soundTotal + photoTotal })
  })
  await engines.photo.prepare((progress) => {
    const mapped = toProgress(progress)
    photoTotal = mapped.totalBytes || photoTotal
    onProgress({ stage: mapped.stage, loadedBytes: soundTotal + mapped.loadedBytes, totalBytes: soundTotal + photoTotal })
  })
}

/** True once a progress report shows that bytes really had to come over the network (some were missing when it began). */
export function isRealDownload(progress: PrepareProgress): boolean {
  return progress.stage === 'downloading' && progress.totalBytes > 0 && progress.loadedBytes < progress.totalBytes
}
