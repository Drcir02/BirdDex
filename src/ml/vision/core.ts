// The heart of the photo and live camera engines: one picture in, probabilities out. It owns the WingCLIP model (ONNX
// Runtime Web) and the species classifier. It has no DOM dependency, so it runs inside a Web Worker (worker.ts, the normal
// way: the model takes about 400 ms per picture on a laptop and a WebAssembly run cannot be interrupted, so on the main
// thread it would freeze the screen), or directly on the main thread as a fallback (backend.ts decides).

import { createImageEncoder, ModelLoadError, type ImageEncoder } from '../runtime/ort'
import { decodeClassifier, probeDot, similarities, ClassifierFormatError, type Classifier } from './classifier'
import { SCORING, WINGCLIP } from './constants'
import { preprocessWithStats } from './preprocess'
import { birdProbability, makeDexMask, scoreSpecies } from './scoring'

/** What the core needs to start: the three model files and which classifier rows are species of the Dex (in Dex order). */
export interface VisionInit {
  /** wingclip_visual_int8.onnx */
  graph: Uint8Array
  /** wingclip_visual_int8.data */
  weights: Uint8Array
  /** text_classifier_int8.bin */
  classifier: Uint8Array
  dexRows: Int32Array
}

/** A picture as pixels, the way a canvas hands them out. */
export interface VisionFrame {
  data: Uint8ClampedArray | Uint8Array
  width: number
  height: number
  channels: 3 | 4
}

export interface VisionRunOptions {
  /** One value per Dex species, added to the score (see priorToLogWeights in prior.ts). */
  logPrior?: Float32Array
  /** Also return the image embedding (768 floats). For tests and measurements. */
  wantEmbedding?: boolean
}

export interface VisionTimings {
  /** Resize, crop and normalise. */
  preprocessMs: number
  /** The model. 0 for a blank picture, which the model never sees. */
  inferMs: number
  /** Similarities, probe and softmax. */
  scoreMs: number
}

export interface VisionScores {
  /** Calibrated probability that the picture shows a bird (0 for a blank picture). */
  pBird: number
  /** The probe before the Platt map. */
  pRaw: number
  /** P(species) for each Dex species, in Dex order. With outsideMass they add up to 1. */
  probs: Float32Array
  /** The probability that the bird is one of the species outside the Dex. */
  outsideMass: number
  /** Best cosine similarity over all species, and over the Dex species. */
  bestSimilarity: number
  bestDexSimilarity: number
  /** The picture is flat (a covered lens). The model was not run. */
  blank: boolean
  timings: VisionTimings
  embedding?: Float32Array
}

export interface InitInfo {
  /** Which build of ONNX Runtime Web is running ('wasm' is the plain one). */
  build: string
  ortVersion: string
  /** Decoding the classifier and creating the model. */
  initMs: number
  /** Number of Dex species the core scores. */
  dexSize: number
}

export interface CoreDeps {
  createEncoder?: (graph: Uint8Array, external: { path: string; data: Uint8Array }) => Promise<ImageEncoder>
  /** Species rows the classifier must have. Default: WingCLIP's 10994. Tests with small classifiers change it. */
  speciesRows?: number
  now?: () => number
}

const clock = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())

export class VisionCore {
  private readonly encoder: ImageEncoder
  private readonly classifier: Classifier
  private readonly dexRows: Int32Array
  private readonly dexMask: Uint8Array
  private readonly sims: Float32Array
  private readonly now: () => number
  private queue: Promise<unknown> = Promise.resolve()
  private disposed = false
  readonly info: InitInfo

  private constructor(encoder: ImageEncoder, classifier: Classifier, dexRows: Int32Array, dexMask: Uint8Array, info: InitInfo, now: () => number) {
    this.encoder = encoder
    this.classifier = classifier
    this.dexRows = dexRows
    this.dexMask = dexMask
    this.sims = new Float32Array(classifier.rows)
    this.info = info
    this.now = now
  }

  /** Reads the classifier, starts ONNX Runtime Web and creates the model. Throws ModelLoadError when that is not possible. */
  static async create(init: VisionInit, deps: CoreDeps = {}): Promise<VisionCore> {
    const now = deps.now ?? clock
    const started = now()
    let classifier: Classifier
    let dexMask: Uint8Array
    try {
      classifier = decodeClassifier(init.classifier, deps.speciesRows ?? WINGCLIP.speciesRows)
      dexMask = makeDexMask(classifier.rows, init.dexRows)
    } catch (error) {
      throw new ModelLoadError(error instanceof ClassifierFormatError ? error.message : 'The species list does not fit the classifier', { cause: error })
    }
    const encoder = await (deps.createEncoder ?? createImageEncoder)(init.graph, { path: WINGCLIP.externalDataName, data: init.weights })
    const info: InitInfo = { build: encoder.build, ortVersion: encoder.version, initMs: now() - started, dexSize: init.dexRows.length }
    return new VisionCore(encoder, classifier, Int32Array.from(init.dexRows), dexMask, info, now)
  }

  /** Scores one picture. Calls are queued, so callers may fire them without waiting for each other. */
  run(frame: VisionFrame, options: VisionRunOptions = {}): Promise<VisionScores> {
    const task = this.queue.then(() => this.runNow(frame, options))
    this.queue = task.catch(() => undefined)
    return task
  }

  private async runNow(frame: VisionFrame, options: VisionRunOptions): Promise<VisionScores> {
    if (this.disposed) throw new ModelLoadError('The vision core was already disposed')
    const t0 = this.now()
    const { tensor, spread } = preprocessWithStats({ data: frame.data, width: frame.width, height: frame.height, channels: frame.channels })
    const t1 = this.now()

    if (spread < SCORING.blankSpread) {
      return {
        pBird: 0,
        pRaw: 0,
        probs: new Float32Array(this.dexRows.length),
        outsideMass: 1,
        bestSimilarity: 0,
        bestDexSimilarity: 0,
        blank: true,
        timings: { preprocessMs: t1 - t0, inferMs: 0, scoreMs: 0 },
      }
    }

    const embedding = await this.encoder.run(tensor)
    const t2 = this.now()
    if (embedding.length !== WINGCLIP.embeddingSize) {
      throw new ModelLoadError(`The model gave ${embedding.length} numbers, ${WINGCLIP.embeddingSize} were expected`)
    }

    const sims = similarities(this.classifier, embedding, this.sims)
    const { pRaw, pBird } = birdProbability(probeDot(this.classifier, embedding))
    const { probs, outsideMass } = scoreSpecies(sims, this.dexRows, this.dexMask, { logPrior: options.logPrior })
    let bestSimilarity = -Infinity
    for (let r = 0; r < sims.length; r++) if (sims[r] > bestSimilarity) bestSimilarity = sims[r]
    let bestDexSimilarity = -Infinity
    for (let i = 0; i < this.dexRows.length; i++) if (sims[this.dexRows[i]] > bestDexSimilarity) bestDexSimilarity = sims[this.dexRows[i]]
    const t3 = this.now()

    return {
      pBird,
      pRaw,
      probs,
      outsideMass,
      bestSimilarity,
      bestDexSimilarity,
      blank: false,
      timings: { preprocessMs: t1 - t0, inferMs: t2 - t1, scoreMs: t3 - t2 },
      ...(options.wantEmbedding ? { embedding } : {}),
    }
  }

  /** Frees the model's memory. Pictures already queued are still scored first. */
  async dispose(): Promise<void> {
    if (this.disposed) return
    await this.queue
    this.disposed = true
    await this.encoder.release()
  }
}
