import { afterEach, describe, expect, it } from 'vitest'
import type { ImageSource } from '../../src/domain/engines'
import { createPhotoEngine, toPhotoResult } from '../../src/ml/vision/engine'
import type { VisionBackend } from '../../src/ml/vision/backend'
import type { InitInfo, VisionFrame, VisionRunOptions, VisionScores } from '../../src/ml/vision/core'
import { setOccurrencePriorProvider } from '../../src/ml/vision/prior'
import { VisionRuntime } from '../../src/ml/vision/runtime'
import { CALIBRATION } from '../../src/ml/vision/constants'
import { makeSpecies } from './helpers/vision-fixtures'

const info: InitInfo = { build: 'wasm', ortVersion: 'test', initMs: 5, dexSize: 4 }

function scoresOf(partial: Partial<VisionScores>): VisionScores {
  return {
    pBird: 0.99,
    pRaw: 0.9,
    probs: Float32Array.from([0.05, 0.8, 0.1, 0.02]),
    outsideMass: 0.03,
    outsideTop: 0.02,
    bestSimilarity: 0.6,
    bestDexSimilarity: 0.6,
    blank: false,
    timings: { preprocessMs: 4, inferMs: 400, scoreMs: 10 },
    ...partial,
  }
}

/** A runtime whose model is a function from the request to scores. */
function makeRuntime(answer: (frame: VisionFrame, options?: VisionRunOptions) => VisionScores) {
  const calls: { frame: VisionFrame; options?: VisionRunOptions }[] = []
  const backend: VisionBackend = {
    kind: 'worker',
    alive: true,
    init: async () => info,
    run: async (frame, options) => {
      calls.push({ frame, options })
      return answer(frame, options)
    },
    dispose: async () => undefined,
  }
  const runtime = new VisionRuntime(
    { idleReleaseMs: 0 },
    {
      loadFile: async () => new Uint8Array(10),
      totalBytes: async () => 30,
      loadSpecies: async () => makeSpecies([10, 20, 30, 40]),
      startWorker: async () => backend,
    },
  )
  return { runtime, calls }
}

const picture = {} as ImageSource
const grab = (_image: ImageSource, options: { shortSide?: number }): VisionFrame => ({
  data: new Uint8ClampedArray(4 * 6 * 4),
  width: options.shortSide === 320 ? 8 : 6,
  height: 4,
  channels: 4,
})

afterEach(() => setOccurrencePriorProvider(undefined))

describe('toPhotoResult', () => {
  const ids = ['a', 'b', 'c', 'd']

  it('gives the three strongest species with confidence = P(bird) * P(species)', () => {
    const result = toPhotoResult(scoresOf({ pBird: 0.9 }), ids)
    expect(result.candidates.map((c) => c.speciesId)).toEqual(['b', 'c', 'a'])
    expect(result.candidates[0].confidence).toBeCloseTo(0.9 * 0.8, 6)
    expect(result.pBird).toBe(0.9)
  })

  it('passes on how sure the plain model is of a bird outside the Dex, so the Catch rules can use it', () => {
    expect(toPhotoResult(scoresOf({ outsideTop: 0.32 }), ids).outsideDexTop).toBe(0.32)
    expect(toPhotoResult(scoresOf({ outsideTop: Number.NaN }), ids).outsideDexTop).toBe(0)
  })

  it('gives no candidates, but still the probability, when the picture shows no bird', () => {
    const result = toPhotoResult(scoresOf({ pBird: CALIBRATION.probe.threshold - 0.01 }), ids)
    expect(result.candidates).toEqual([])
    expect(result.pBird).toBeCloseTo(CALIBRATION.probe.threshold - 0.01, 6)
  })

  it('gives a candidate list right at the threshold', () => {
    expect(toPhotoResult(scoresOf({ pBird: CALIBRATION.probe.threshold }), ids).candidates).toHaveLength(3)
  })

  it('treats a blank picture and a broken probability as no bird', () => {
    expect(toPhotoResult(scoresOf({ blank: true, pBird: 0.99 }), ids)).toEqual({ candidates: [], pBird: 0 })
    expect(toPhotoResult(scoresOf({ pBird: Number.NaN }), ids)).toEqual({ candidates: [], pBird: 0 })
  })

  it('keeps the confidence of a weak guess honest instead of rounding it away', () => {
    const result = toPhotoResult(scoresOf({ probs: Float32Array.from([0.001, 0.0005, 0.0002, 0.0001]) }), ids)
    expect(result.candidates).toHaveLength(3)
    expect(result.candidates[0].confidence).toBeGreaterThan(0)
  })
})

describe('createPhotoEngine', () => {
  it('prepares the shared model and passes the progress on', async () => {
    const { runtime } = makeRuntime(() => scoresOf({}))
    const engine = createPhotoEngine({ runtime, grab })
    const stages: string[] = []
    await engine.prepare((p) => stages.push(p.stage))
    expect(stages).toContain('ready')
    expect(runtime.isReady).toBe(true)
  })

  it('identifies a picture: species ids of the Dex, strongest first, with the bird probability', async () => {
    const { runtime, calls } = makeRuntime(() => scoresOf({ pBird: 0.95 }))
    const engine = createPhotoEngine({ runtime, grab })
    const result = await engine.identify(picture)
    expect(result.candidates.map((c) => c.speciesId)).toEqual(['sp-1', 'sp-2', 'sp-0'])
    expect(result.pBird).toBe(0.95)
    expect(result.candidates[0].confidence).toBeCloseTo(0.95 * 0.8, 6)
    expect(calls).toHaveLength(1)
    expect(calls[0].frame.width).toBe(6)
  })

  it('prepares the model by itself when identify comes first', async () => {
    const { runtime } = makeRuntime(() => scoresOf({}))
    expect(runtime.isReady).toBe(false)
    await createPhotoEngine({ runtime, grab }).identify(picture)
    expect(runtime.isReady).toBe(true)
  })

  it('answers with no candidates for a picture that is not a bird', async () => {
    const { runtime } = makeRuntime(() => scoresOf({ pBird: 0.05, probs: Float32Array.from([0.4, 0.3, 0.2, 0.1]) }))
    const result = await createPhotoEngine({ runtime, grab }).identify(picture)
    expect(result.candidates).toEqual([])
    expect(result.pBird).toBe(0.05)
  })

  it('reports what happened inside, for the dev page', async () => {
    const { runtime } = makeRuntime(() => scoresOf({ outsideMass: 0.4 }))
    const result = await createPhotoEngine({ runtime, grab }).identify(picture, { shortSide: 320 })
    expect(result.diagnostics).toMatchObject({ outsideDexMass: 0.4, blank: false, backend: 'worker', frame: { width: 8, height: 4 } })
    expect(result.diagnostics.timings.inferMs).toBe(400)
    expect(result.diagnostics.timings.totalMs).toBeGreaterThanOrEqual(0)
  })

  it('asks for the embedding only when told to', async () => {
    const { runtime, calls } = makeRuntime(() => scoresOf({ embedding: Float32Array.from([1, 2, 3]) }))
    const engine = createPhotoEngine({ runtime, grab })
    await engine.identify(picture)
    await engine.identify(picture, { wantEmbedding: true })
    expect(calls[0].options?.wantEmbedding).toBeFalsy()
    expect(calls[1].options?.wantEmbedding).toBe(true)
  })

  it('works without a prior, and with one it hands the prior to the model', async () => {
    const { runtime, calls } = makeRuntime(() => scoresOf({}))
    const engine = createPhotoEngine({ runtime, grab })
    await engine.identify(picture, { location: { lat: 50, lon: 14 } })
    expect(calls[0].options?.logPrior).toBeUndefined()

    let seen: unknown
    setOccurrencePriorProvider(async (request) => {
      seen = request
      return new Map([
        ['sp-0', 1],
        ['sp-1', 0.1],
        ['sp-2', 1],
        ['sp-3', 1],
      ])
    })
    const date = new Date(2026, 5, 1)
    await engine.identify(picture, { location: { lat: 50, lon: 14 }, date })
    expect(seen).toEqual({ location: { lat: 50, lon: 14 }, date })
    const logPrior = calls[1].options?.logPrior
    expect(logPrior).toBeInstanceOf(Float32Array)
    expect(logPrior?.[0]).toBe(0)
    expect(logPrior?.[1]).toBeCloseTo(Math.log(0.1), 5)
  })

  it('lets the failure of the model through', async () => {
    const { runtime } = makeRuntime(() => {
      throw new Error('out of memory')
    })
    await expect(createPhotoEngine({ runtime, grab }).identify(picture)).rejects.toThrow('out of memory')
  })

  it('frees the model on dispose', async () => {
    const { runtime } = makeRuntime(() => scoresOf({}))
    const engine = createPhotoEngine({ runtime, grab })
    await engine.prepare()
    await engine.dispose()
    expect(runtime.isReady).toBe(false)
  })
})
