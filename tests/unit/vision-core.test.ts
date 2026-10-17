import { describe, expect, it } from 'vitest'
import type { ImageEncoder } from '../../src/ml/runtime/ort'
import { ModelLoadError } from '../../src/ml/runtime/ort'
import { VisionCore, type VisionFrame } from '../../src/ml/vision/core'
import { CALIBRATION } from '../../src/ml/vision/constants'
import { birdProbability } from '../../src/ml/vision/scoring'
import { makeClassifierBytes, random, randomUnitRow, roundTrip } from './helpers/vision-fixtures'
import { synthPicture } from './helpers/vision-synth'

const DIM = 768
const ROWS = 12 // 11 species and the probe

function setup(seed = 11) {
  const next = random(seed)
  const rows = Array.from({ length: ROWS }, () => randomUnitRow(DIM, next))
  return { rows, bytes: makeClassifierBytes(rows) }
}

/** An "image tower" that always answers with the given embedding, and records how it is called. */
function fakeEncoder(embedding: number[], log: { calls: number; overlap: number; running: number; released: boolean }): (graph: Uint8Array, external: { path: string; data: Uint8Array }) => Promise<ImageEncoder> {
  return async (_graph, external) => {
    expect(external.path).toBe('wingclip_visual_int8.data')
    return {
      build: 'wasm',
      version: 'test',
      inputShape: [1, 3, 224, 224],
      async run(input) {
        expect(input.length).toBe(3 * 224 * 224)
        log.calls++
        log.running++
        if (log.running > 1) log.overlap++
        await new Promise((resolve) => setTimeout(resolve, 5))
        log.running--
        return Float32Array.from(embedding)
      },
      async release() {
        log.released = true
      },
    }
  }
}

const newLog = () => ({ calls: 0, overlap: 0, running: 0, released: false })

function busyFrame(): VisionFrame {
  return { data: synthPicture(120, 90, 4), width: 120, height: 90, channels: 3 }
}

function blankFrame(): VisionFrame {
  return { data: new Uint8Array(40 * 30 * 4).fill(120), width: 40, height: 30, channels: 4 }
}

describe('VisionCore', () => {
  it('scores a picture: the Dex species that match the embedding win, the rest stay outside', async () => {
    const { rows, bytes } = setup()
    const log = newLog()
    // the image looks exactly like the species of row 3, which is in the Dex; row 7 is not in the Dex
    const core = await VisionCore.create(
      { graph: new Uint8Array(4), weights: new Uint8Array(4), classifier: bytes, dexRows: Int32Array.from([1, 3, 5]) },
      { createEncoder: fakeEncoder(roundTrip(rows[3]), log), speciesRows: ROWS - 1 },
    )
    expect(core.info).toMatchObject({ build: 'wasm', dexSize: 3 })
    const scores = await core.run(busyFrame())
    expect(scores.blank).toBe(false)
    expect(scores.probs.length).toBe(3)
    expect(scores.probs[1]).toBeGreaterThan(0.99)
    expect(scores.probs[0] + scores.probs[1] + scores.probs[2] + scores.outsideMass).toBeCloseTo(1, 5)
    expect(scores.bestSimilarity).toBeCloseTo(1, 2)
    expect(scores.bestDexSimilarity).toBeCloseTo(1, 2)
    // the best species of the whole classifier is a Dex species, so no foreign bird competes
    expect(scores.outsideTop).toBeLessThan(0.01)
    expect(scores.timings.inferMs).toBeGreaterThanOrEqual(0)
    expect(scores.embedding).toBeUndefined()
  })

  it('takes the probability of a bird from the probe row', async () => {
    const { rows, bytes } = setup(12)
    const log = newLog()
    const probeLike = roundTrip(rows[11])
    const core = await VisionCore.create(
      { graph: new Uint8Array(4), weights: new Uint8Array(4), classifier: bytes, dexRows: Int32Array.from([0, 1]) },
      { createEncoder: fakeEncoder(probeLike, log), speciesRows: ROWS - 1 },
    )
    const scores = await core.run(busyFrame())
    // dot of the probe row with itself (unit length) is about 1
    const expected = birdProbability(1, CALIBRATION.probe)
    expect(scores.pBird).toBeCloseTo(expected.pBird, 1)
    expect(scores.pRaw).toBeCloseTo(expected.pRaw, 1)
  })

  it('gives the embedding back only when asked', async () => {
    const { rows, bytes } = setup(13)
    const log = newLog()
    const core = await VisionCore.create(
      { graph: new Uint8Array(4), weights: new Uint8Array(4), classifier: bytes, dexRows: Int32Array.from([0]) },
      { createEncoder: fakeEncoder(roundTrip(rows[0]), log), speciesRows: ROWS - 1 },
    )
    const scores = await core.run(busyFrame(), { wantEmbedding: true })
    expect(scores.embedding).toHaveLength(DIM)
  })

  it('does not run the model for a blank picture (a covered lens)', async () => {
    const { rows, bytes } = setup(14)
    const log = newLog()
    const core = await VisionCore.create(
      { graph: new Uint8Array(4), weights: new Uint8Array(4), classifier: bytes, dexRows: Int32Array.from([0, 1]) },
      { createEncoder: fakeEncoder(roundTrip(rows[0]), log), speciesRows: ROWS - 1 },
    )
    const scores = await core.run(blankFrame())
    expect(log.calls).toBe(0)
    expect(scores.blank).toBe(true)
    expect(scores.pBird).toBe(0)
    expect(Array.from(scores.probs)).toEqual([0, 0])
    expect(scores.outsideMass).toBe(1)
  })

  it('passes the prior on to the scoring', async () => {
    const { rows, bytes } = setup(15)
    const log = newLog()
    // an embedding exactly between rows 0 and 1
    const between = roundTrip(rows[0]).map((v, i) => v + roundTrip(rows[1])[i])
    const core = await VisionCore.create(
      { graph: new Uint8Array(4), weights: new Uint8Array(4), classifier: bytes, dexRows: Int32Array.from([0, 1]) },
      { createEncoder: fakeEncoder(between, log), speciesRows: ROWS - 1 },
    )
    const flat = await core.run(busyFrame())
    expect(flat.probs[0]).toBeCloseTo(flat.probs[1], 1)
    const tilted = await core.run(busyFrame(), { logPrior: Float32Array.from([0, -4]) })
    expect(tilted.probs[0]).toBeGreaterThan(tilted.probs[1] * 20)
  })

  it('queues runs so that two pictures never use the model at the same time', async () => {
    const { rows, bytes } = setup(16)
    const log = newLog()
    const core = await VisionCore.create(
      { graph: new Uint8Array(4), weights: new Uint8Array(4), classifier: bytes, dexRows: Int32Array.from([0]) },
      { createEncoder: fakeEncoder(roundTrip(rows[0]), log), speciesRows: ROWS - 1 },
    )
    await Promise.all([core.run(busyFrame()), core.run(busyFrame()), core.run(busyFrame())])
    expect(log.calls).toBe(3)
    expect(log.overlap).toBe(0)
  })

  it('keeps working after one picture fails', async () => {
    const { rows, bytes } = setup(17)
    const log = newLog()
    const core = await VisionCore.create(
      { graph: new Uint8Array(4), weights: new Uint8Array(4), classifier: bytes, dexRows: Int32Array.from([0]) },
      { createEncoder: fakeEncoder(roundTrip(rows[0]), log), speciesRows: ROWS - 1 },
    )
    await expect(core.run({ data: new Uint8Array(3), width: 0, height: 0, channels: 3 })).rejects.toThrow(RangeError)
    const scores = await core.run(busyFrame())
    expect(scores.blank).toBe(false)
  })

  it('refuses to start with a classifier of the wrong size or a species row that does not exist', async () => {
    const { rows, bytes } = setup(18)
    const log = newLog()
    const make = (dexRows: number[], classifier: Uint8Array = bytes, speciesRows = ROWS - 1) =>
      VisionCore.create(
        { graph: new Uint8Array(4), weights: new Uint8Array(4), classifier, dexRows: Int32Array.from(dexRows) },
        { createEncoder: fakeEncoder(roundTrip(rows[0]), log), speciesRows },
      )
    await expect(make([0], bytes, 10994)).rejects.toThrow(ModelLoadError)
    await expect(make([0, 99])).rejects.toThrow(ModelLoadError)
    await expect(make([0], bytes.subarray(0, 100))).rejects.toThrow(ModelLoadError)
    expect(log.calls).toBe(0)
  })

  it('refuses an embedding of the wrong size', async () => {
    const { bytes } = setup(19)
    const log = newLog()
    const core = await VisionCore.create(
      { graph: new Uint8Array(4), weights: new Uint8Array(4), classifier: bytes, dexRows: Int32Array.from([0]) },
      { createEncoder: fakeEncoder([1, 2, 3], log), speciesRows: ROWS - 1 },
    )
    await expect(core.run(busyFrame())).rejects.toThrow(ModelLoadError)
  })

  it('finishes the queued pictures, then frees the model; later runs fail', async () => {
    const { rows, bytes } = setup(20)
    const log = newLog()
    const core = await VisionCore.create(
      { graph: new Uint8Array(4), weights: new Uint8Array(4), classifier: bytes, dexRows: Int32Array.from([0]) },
      { createEncoder: fakeEncoder(roundTrip(rows[0]), log), speciesRows: ROWS - 1 },
    )
    const pending = core.run(busyFrame())
    await core.dispose()
    expect((await pending).blank).toBe(false)
    expect(log.released).toBe(true)
    await expect(core.run(busyFrame())).rejects.toThrow(ModelLoadError)
    await core.dispose() // twice is fine
  })
})
