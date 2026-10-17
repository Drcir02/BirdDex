// Pretend identification engines for screen tests, e2e flows and the owner's first look at the app.
// They answer after short delays with believable, fixed results for three common garden birds, so no model files,
// microphone signal or camera picture is needed. Choose them with ?engines=fake in the address (or the
// localStorage key "birddex:engines"). See src/ml/engines.ts.
//
// Which story the fakes tell is set by a scenario (?fake=low in the address, or localStorage "birddex:fake"):
//   clear           a clear winner: the Catch button works                              (default)
//   low             unsure about everything: the Catch button stays off (low confidence)
//   unclear         two birds nearly tied: the Catch button stays off for photos (unclear margin)
//   empty           no bird found at all
//   download-error  prepare() fails once with a ModelDownloadError, then works (tests "try again")
//   storage-full    prepare() always fails with a ModelStorageFullError

import type {
  Engines,
  ImageSource,
  LiveScanner,
  LiveSession,
  LiveUpdate,
  PhotoEngine,
  PhotoResult,
  ProgressCallback,
  SoundEngine,
  SoundResult,
  SoundSession,
  SoundUpdate,
} from '../domain/engines'
import type { Candidate } from '../domain/types'
import { ModelDownloadError, ModelStorageFullError } from './runtime/modelErrors'

export type FakeScenario = 'clear' | 'low' | 'unclear' | 'empty' | 'download-error' | 'storage-full'

export const FAKE_SCENARIOS: readonly FakeScenario[] = ['clear', 'low', 'unclear', 'empty', 'download-error', 'storage-full']

/** Turns a scenario name from the address or localStorage into a scenario; anything unknown means the default story. */
export function parseFakeScenario(value: string | undefined): FakeScenario {
  return (FAKE_SCENARIOS as readonly string[]).includes(value ?? '') ? (value as FakeScenario) : 'clear'
}

export interface FakeOptions {
  scenario?: FakeScenario
  /** Base delay in milliseconds: one listening step, half a download step. Default 150. Use 0 to make tests fast. */
  delayMs?: number
}

/** Species ids of the Dex that the fakes talk about: great tit, European robin, common blackbird. */
export const FAKE_SPECIES = {
  greatTit: 'parus-major',
  robin: 'erithacus-rubecula',
  blackbird: 'turdus-merula',
} as const

const { greatTit, robin, blackbird } = FAKE_SPECIES

const guess = (speciesId: string, confidence: number): Candidate => ({ speciesId, confidence })

/** What BirdNET-like sound scores look like. They do not compete: two birds can both score high. */
const SOUND_RESULTS: Record<FakeScenario, Candidate[]> = {
  clear: [guess(greatTit, 0.91), guess(blackbird, 0.22), guess(robin, 0.09)],
  low: [guess(robin, 0.41), guess(greatTit, 0.23), guess(blackbird, 0.12)],
  unclear: [guess(blackbird, 0.74), guess(greatTit, 0.71), guess(robin, 0.1)],
  empty: [],
  'download-error': [guess(greatTit, 0.91), guess(blackbird, 0.22), guess(robin, 0.09)],
  'storage-full': [guess(greatTit, 0.91), guess(blackbird, 0.22), guess(robin, 0.09)],
}

/** What WingCLIP-like picture scores look like. They compete, so a clear winner leaves little for the others. */
const PICTURE_RESULTS: Record<FakeScenario, Candidate[]> = {
  clear: [guess(greatTit, 0.88), guess(robin, 0.07), guess(blackbird, 0.03)],
  low: [guess(robin, 0.41), guess(greatTit, 0.23), guess(blackbird, 0.12)],
  unclear: [guess(blackbird, 0.78), guess(greatTit, 0.74), guess(robin, 0.1)],
  empty: [],
  'download-error': [guess(greatTit, 0.88), guess(robin, 0.07), guess(blackbird, 0.03)],
  'storage-full': [guess(greatTit, 0.88), guess(robin, 0.07), guess(blackbird, 0.03)],
}

const P_BIRD: Record<FakeScenario, number> = {
  clear: 0.97,
  low: 0.72,
  unclear: 0.95,
  empty: 0.03,
  'download-error': 0.97,
  'storage-full': 0.97,
}

// The sizes of the real model files, so the progress bar behaves like the real one.
const SOUND_DOWNLOAD_BYTES = 25_932_528 + 14_770_468
const PHOTO_DOWNLOAD_BYTES = 14_386_564 + 25_165_824 + 8_488_140

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, Math.max(0, ms)))
const round3 = (value: number) => Math.round(value * 1000) / 1000

function scaled(candidates: readonly Candidate[], factor: number): Candidate[] {
  return candidates.map((candidate) => ({ speciesId: candidate.speciesId, confidence: round3(candidate.confidence * factor) }))
}

/** Shared by the three fakes: pretends to download and prepare a model, and fails the way the scenario says. */
function createPreparer(scenario: FakeScenario, delayMs: number, modelId: string, totalBytes: number) {
  let prepared = false
  let failedOnce = false
  return async (onProgress?: ProgressCallback): Promise<void> => {
    const report = (stage: 'downloading' | 'preparing' | 'ready', fraction: number) =>
      onProgress?.({ modelId, stage, loadedBytes: Math.round(totalBytes * fraction), totalBytes })
    if (prepared) {
      report('ready', 1)
      return
    }
    if (scenario === 'storage-full') {
      report('downloading', 0.35)
      await wait(delayMs)
      throw new ModelStorageFullError('Fake: the phone has no room for the models', { neededBytes: totalBytes, availableBytes: 1_000_000 })
    }
    if (scenario === 'download-error' && !failedOnce) {
      failedOnce = true
      report('downloading', 0.4)
      await wait(delayMs)
      throw new ModelDownloadError('Fake: the download failed', { reason: 'network' })
    }
    for (const fraction of [0, 0.25, 0.5, 0.75, 1]) {
      report('downloading', fraction)
      await wait(delayMs / 2)
    }
    report('preparing', 1)
    await wait(delayMs / 2)
    prepared = true
    report('ready', 1)
  }
}

// ---------- A bird-like WAV clip ----------

function writeAscii(view: DataView, offset: number, text: string) {
  for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i))
}

/** Three short rising chirps in a 16-bit mono 48 kHz WAV, like the clip the real sound engine saves. */
export function makeFakeClip(seconds = 2): Blob {
  const sampleRate = 48_000
  const count = Math.round(seconds * sampleRate)
  const buffer = new ArrayBuffer(44 + count * 2)
  const view = new DataView(buffer)
  writeAscii(view, 0, 'RIFF')
  view.setUint32(4, 36 + count * 2, true)
  writeAscii(view, 8, 'WAVE')
  writeAscii(view, 12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeAscii(view, 36, 'data')
  view.setUint32(40, count * 2, true)

  // Each chirp rises from 3.2 to 4.6 kHz in 0.16 s, with a soft start and end.
  const chirpSeconds = 0.16
  const starts = [0.1, 0.35, 0.6].map((fraction) => fraction * seconds)
  for (let i = 0; i < count; i++) {
    const t = i / sampleRate
    let sample = 0
    for (const start of starts) {
      const local = t - start
      if (local < 0 || local > chirpSeconds) continue
      const envelope = Math.sin((Math.PI * local) / chirpSeconds) ** 2
      const phase = 2 * Math.PI * (3200 * local + (1400 * local * local) / (2 * chirpSeconds))
      sample += 0.45 * envelope * Math.sin(phase)
    }
    view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, sample)) * 32767, true)
  }
  return new Blob([buffer], { type: 'audio/wav' })
}

// ---------- Sound ----------

export function createFakeSoundEngine(options: FakeOptions = {}): SoundEngine {
  const scenario = options.scenario ?? 'clear'
  const delayMs = options.delayMs ?? 150
  const prepare = createPreparer(scenario, delayMs, 'birdnet', SOUND_DOWNLOAD_BYTES)
  const truth = SOUND_RESULTS[scenario]

  return {
    prepare,
    async start({ onUpdate }): Promise<SoundSession> {
      await prepare()
      let ticks = 0
      let running = true
      const current = (): Candidate[] => {
        // Nothing to say for the first two steps (BirdNET needs 3 seconds of sound), then the guesses grow clearer.
        if (ticks < 3) return []
        return scaled(truth, Math.min(1, 0.6 + 0.2 * (ticks - 3)))
      }
      const timer = setInterval(() => {
        if (!running) return
        ticks++
        const candidates = current()
        const update: SoundUpdate = {
          candidates,
          level: round3(Math.min(1, 0.18 + 0.5 * Math.abs(Math.sin(ticks * 0.9)))),
          analysedSeconds: ticks,
          hearingBird: (candidates[0]?.confidence ?? 0) >= 0.3,
        }
        onUpdate(update)
      }, Math.max(1, delayMs))
      return {
        async stop(): Promise<SoundResult> {
          running = false
          clearInterval(timer)
          const candidates = current()
          if (candidates.length === 0) return { candidates: [] }
          return { candidates, clip: makeFakeClip(2), clipSeconds: 2 }
        },
      }
    },
  }
}

// ---------- Photo ----------

export function createFakePhotoEngine(options: FakeOptions = {}): PhotoEngine {
  const scenario = options.scenario ?? 'clear'
  const delayMs = options.delayMs ?? 150
  const prepare = createPreparer(scenario, delayMs, 'wingclip', PHOTO_DOWNLOAD_BYTES)

  return {
    prepare,
    async identify(_image: ImageSource): Promise<PhotoResult> {
      await prepare()
      await wait(delayMs * 2)
      return { candidates: PICTURE_RESULTS[scenario].map((candidate) => ({ ...candidate })), pBird: P_BIRD[scenario] }
    },
  }
}

// ---------- Live camera ----------

// A 64x48 picture of a dark bird on a blue sky, for when the video has no frame to copy (tests, or a camera that has not started).
const FALLBACK_JPEG_BASE64 =
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAoHBwgHBgoICAgLCgoLDhgQDg0NDh0VFhEYIx8lJCIfIiEmKzcvJik0KSEiMEExNDk7Pj4+JS5ESUM8SDc9Pjv/2wBDAQoLCw4NDhwQEBw7KCIoOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozv/wAARCAAwAEADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDI2UbKn2UbK9r2h4fKQbKNlT7KNlHtA5SDZRsqcgKpZiAAMkntWW+tRCUqsJZAfvZwSPXFTKvGO7LhRlP4UXdlGypYyk0ayRsGVhkEU7ZVe0I5LE+yjZU+yjZXD7Q6eUrsAqlmIAAySegrCu9bkMjJagKnQORyfetnVo5Dpc/l53BcnBxxnn9M1yFY1KstkdVClF6stS6ldTxNFLIHVh02gY5z2+lVaK1vD1uJbySRo1ZY06kA4bIx/I1hrJ6s6nanFtI6K2j0+LTbdVtXWYxoZSp25bYAeueePSmFBuO0EDPAJzU2yjZW1GKpKybfq7nn1Zuo7tIn2UbKn2UbK5vaGnKQbKw77wyssjS2kixbufLYfLnvz2+mK6PZRso57lRvHY5OLwrclj51xEi46oCxz+lb9rZRWcCwwrhR1J6k+pq7so2UKaQ5OUtyDZRsqfZRso9oRyn/2Q=='

function fallbackSnapshot(): Blob {
  const binary = atob(FALLBACK_JPEG_BASE64)
  return new Blob([Uint8Array.from(binary, (char) => char.charCodeAt(0))], { type: 'image/jpeg' })
}

/** A JPEG of the current video frame, or the stand-in picture when there is none. */
async function snapshotOf(video: HTMLVideoElement | undefined): Promise<Blob> {
  try {
    if (video && video.videoWidth > 0 && typeof document !== 'undefined') {
      const scale = Math.min(1, 640 / video.videoWidth)
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(video.videoWidth * scale))
      canvas.height = Math.max(1, Math.round(video.videoHeight * scale))
      const context = canvas.getContext('2d')
      if (context) {
        context.drawImage(video, 0, 0, canvas.width, canvas.height)
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.8))
        if (blob) return blob
      }
    }
  } catch {
    // Use the stand-in picture.
  }
  return fallbackSnapshot()
}

export function createFakeLiveScanner(options: FakeOptions = {}): LiveScanner {
  const scenario = options.scenario ?? 'clear'
  const delayMs = options.delayMs ?? 150
  const prepare = createPreparer(scenario, delayMs, 'wingclip', PHOTO_DOWNLOAD_BYTES)
  const truth = PICTURE_RESULTS[scenario]

  return {
    async start(video, { onUpdate }): Promise<LiveSession> {
      await prepare()
      let frames = 0
      let running = true
      const timer = setInterval(() => {
        if (!running) return
        frames++
        let candidates: Candidate[] = []
        let lockedSpeciesId: string | undefined
        if (truth.length > 0) {
          // The picture is hazy at first and clears up over a few frames.
          candidates = scaled(truth, Math.min(1, 0.55 + 0.15 * frames))
          if (scenario === 'low' && frames % 2 === 0) {
            // A shaky, low-confidence view keeps changing its mind, so it never locks on.
            candidates = [candidates[1], candidates[0], candidates[2]]
          }
          if (scenario !== 'low' && frames >= 3) lockedSpeciesId = candidates[0].speciesId
        }
        const update: LiveUpdate = {
          candidates,
          pBird: round3(P_BIRD[scenario] * Math.min(1, 0.6 + 0.2 * frames)),
          framesPerSecond: round3(1000 / Math.max(1, delayMs)),
          ...(lockedSpeciesId ? { lockedSpeciesId } : {}),
        }
        onUpdate(update)
      }, Math.max(1, delayMs))
      return {
        stop() {
          running = false
          clearInterval(timer)
        },
        snapshot: () => snapshotOf(video),
      }
    },
  }
}

export function createFakeEngines(options: FakeOptions = {}): Engines {
  return {
    sound: createFakeSoundEngine(options),
    photo: createFakePhotoEngine(options),
    live: createFakeLiveScanner(options),
  }
}
