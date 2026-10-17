// The photo identification engine: WingCLIP (int8 ONNX) looking at one picture. Implements PhotoEngine
// (src/domain/engines.ts); src/ml/engines.ts loads this module the first time a screen needs it.
//
//   const engine = getEngines().photo
//   await engine.prepare(onProgress)                      // downloads (once) and starts the model
//   const { candidates, pBird } = await engine.identify(bitmap, { location })
//
// How it works, in order: the picture is drawn into a canvas at a shorter side of about 512 pixels (frame.ts); the model
// side (worker.ts, core.ts) makes it 248 pixels with Pillow's exact bicubic resize, crops the centre 224, runs WingCLIP and
// compares the 768 numbers it gets with the 10994 species of the classifier; the species of our Dex are the candidates and
// the others compete as rivals (scoring.ts); an optional OccurrencePrior shifts the odds by place and season (prior.ts). The
// three strongest give {speciesId, confidence} with confidence = P(bird) * P(species). Below the bird probe's threshold
// there are no candidates at all: the picture shows no bird.
//
// The live camera (live.ts) uses the same model through the same runtime; there is only one copy in memory.

import type { ImageSource, PhotoEngine, PhotoResult } from '../../domain/engines'
import type { GeoPoint } from '../../domain/types'
import { FRAME, SCORING } from './constants'
import type { VisionFrame, VisionScores, VisionTimings } from './core'
import { grabFrame, type GrabOptions } from './frame'
import { resolveLogWeights } from './prior'
import { getVisionRuntime, type VisionRuntime } from './runtime'
import { isNotABird, toCandidates } from './scoring'

export interface IdentifyOptions {
  location?: GeoPoint
  date?: Date
  /** Debug: also return the image embedding in the diagnostics. */
  wantEmbedding?: boolean
  /** Debug: size the picture is scaled to before the exact resize (shorter side). Default FRAME.photoShortSide. */
  shortSide?: number
}

/** What happened inside, for the dev page and the notes. Screens do not need it. */
export interface PhotoDiagnostics {
  /** The probability that the bird is one of the species outside the Dex. High: a bird we do not have in the Dex. */
  outsideDexMass: number
  /** Same as PhotoResult.outsideDexTop: the plain model's best species outside the Dex. 0 for a blank picture. */
  outsideDexTop: number
  /** The picture was flat, the model was not run. */
  blank: boolean
  /** The probe before its calibration. */
  pRaw: number
  bestSimilarity: number
  bestDexSimilarity: number
  /** Size of the picture that went to the exact resize. */
  frame: { width: number; height: number }
  timings: VisionTimings & { grabMs: number; totalMs: number }
  backend: 'worker' | 'main' | undefined
  embedding?: Float32Array
}

export interface VisionPhotoResult extends PhotoResult {
  diagnostics: PhotoDiagnostics
}

export interface VisionPhotoEngine extends PhotoEngine {
  identify(image: ImageSource, options?: IdentifyOptions): Promise<VisionPhotoResult>
  /** Frees the model's memory. The next prepare() or identify() loads it again. */
  dispose(): Promise<void>
  readonly runtime: VisionRuntime
}

export interface PhotoEngineOptions {
  /** The model to use. Default: the one shared with the live camera. */
  runtime?: VisionRuntime
  /** Reads a picture as pixels. Default: grabFrame (a canvas). Tests pass their own. */
  grab?: (image: ImageSource, options: GrabOptions) => VisionFrame
}

const clock = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())

/** Turns the numbers of one analysed picture into the answer of the engine. */
export function toPhotoResult(scores: VisionScores, speciesIds: readonly string[]): PhotoResult {
  const pBird = scores.blank || !Number.isFinite(scores.pBird) ? 0 : scores.pBird
  if (isNotABird(pBird)) return { candidates: [], pBird }
  const outsideDexTop = Number.isFinite(scores.outsideTop) ? scores.outsideTop : 0
  return { candidates: toCandidates(scores.probs, pBird, (index) => speciesIds[index], SCORING.candidateCount), pBird, outsideDexTop }
}

export function createPhotoEngine(options: PhotoEngineOptions = {}): VisionPhotoEngine {
  const runtime = options.runtime ?? getVisionRuntime()
  const grab = options.grab ?? grabFrame
  return {
    runtime,
    prepare: (onProgress) => runtime.prepare(onProgress),
    dispose: () => runtime.dispose(),
    async identify(image, identifyOptions = {}) {
      const started = clock()
      await runtime.prepare()
      const grabStarted = clock()
      const frame = grab(image, { shortSide: identifyOptions.shortSide ?? FRAME.photoShortSide })
      const grabMs = clock() - grabStarted
      const size = { width: frame.width, height: frame.height }
      const dex = runtime.dex
      const logPrior = await resolveLogWeights(dex, { location: identifyOptions.location, date: identifyOptions.date })
      const scores = await runtime.analyse(frame, { logPrior, wantEmbedding: identifyOptions.wantEmbedding })
      const result = toPhotoResult(
        scores,
        dex.map((species) => species.id),
      )
      return {
        ...result,
        diagnostics: {
          outsideDexMass: scores.outsideMass,
          outsideDexTop: Number.isFinite(scores.outsideTop) ? scores.outsideTop : 0,
          blank: scores.blank,
          pRaw: scores.pRaw,
          bestSimilarity: scores.bestSimilarity,
          bestDexSimilarity: scores.bestDexSimilarity,
          frame: size,
          timings: { ...scores.timings, grabMs, totalMs: clock() - started },
          backend: runtime.backendKind,
          ...(scores.embedding ? { embedding: scores.embedding } : {}),
        },
      }
    },
  }
}
