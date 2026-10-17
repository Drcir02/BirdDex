import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  CLIP_CROP,
  CLIP_MEAN,
  CLIP_RESIZE,
  CLIP_STD,
  bankersRound,
  brightnessSpread,
  computeTaps,
  cropOffset,
  normalize,
  preprocess,
  preprocessWithStats,
  resizeAndCrop,
  resizedSize,
} from '../../src/ml/vision/preprocess'
import { synthPicture, withAlpha } from './helpers/vision-synth'

interface VectorCase {
  name: string
  width: number
  height: number
  seed: number
  resized: [number, number]
  left: number
  top: number
  cropSha256: string
  tensorSha256: string
  cropHead: number[]
  cropMean: number[]
}

const vectors = JSON.parse(readFileSync(join(__dirname, '../fixtures/vision/preprocess-vectors.json'), 'utf8')) as { pillow: string; cases: VectorCase[] }

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const bytesOf = (tensor: Float32Array) => new Uint8Array(tensor.buffer, tensor.byteOffset, tensor.byteLength)

describe('sizes and offsets', () => {
  it('resizes the shorter side and floors the other, like torchvision', () => {
    expect(resizedSize(1000, 751, 248)).toEqual({ width: 330, height: 248 })
    expect(resizedSize(683, 1024, 248)).toEqual({ width: 248, height: 371 })
    // 1024x683 at 224 is 335.86 and must give 335, where rounding would give 336
    expect(resizedSize(1024, 683, 224)).toEqual({ width: 335, height: 224 })
    expect(resizedSize(500, 500, 248)).toEqual({ width: 248, height: 248 })
  })

  it('rounds halves to the even number, like Python', () => {
    expect(bankersRound(52.5)).toBe(52)
    expect(bankersRound(53.5)).toBe(54)
    expect(bankersRound(55.5)).toBe(56)
    expect(bankersRound(0.5)).toBe(0)
    expect(bankersRound(12)).toBe(12)
    expect(bankersRound(12.4)).toBe(12)
    expect(bankersRound(12.6)).toBe(13)
  })

  it('places the crop with that rounding', () => {
    expect(cropOffset(329, 224)).toBe(52)
    expect(cropOffset(335, 224)).toBe(56)
    expect(cropOffset(248, 224)).toBe(12)
    expect(cropOffset(371, 224)).toBe(74)
  })
})

describe('the resampling taps', () => {
  it('give every output position weights that add up to one in fixed point', () => {
    for (const [inSize, outSize] of [
      [1000, 330],
      [100, 310],
      [1920, 992],
      [17, 248],
    ]) {
      const taps = computeTaps(inSize, outSize, 0, outSize)
      for (let i = 0; i < outSize; i++) {
        let sum = 0
        for (let t = 0; t < taps.counts[i]; t++) sum += taps.weights[i * taps.ksize + t]
        // Pillow rounds every weight on its own, so the sum may be off by a few units of 2^-22
        expect(Math.abs(sum - (1 << 22))).toBeLessThanOrEqual(8)
      }
    }
  })

  it('keep every position inside the source and stretch the filter when shrinking', () => {
    const taps = computeTaps(1920, 248, 0, 248)
    expect(taps.ksize).toBe(Math.ceil(2 * (1920 / 248)) * 2 + 1)
    for (let i = 0; i < 248; i++) {
      expect(taps.starts[i]).toBeGreaterThanOrEqual(0)
      expect(taps.starts[i] + taps.counts[i]).toBeLessThanOrEqual(1920)
    }
  })

  it('give the same numbers when only a part of the positions is asked for', () => {
    const all = computeTaps(1000, 330, 0, 330)
    const part = computeTaps(1000, 330, 53, 224)
    for (let i = 0; i < 224; i++) {
      expect(part.starts[i]).toBe(all.starts[53 + i])
      expect(part.counts[i]).toBe(all.counts[53 + i])
      for (let t = 0; t < part.ksize; t++) expect(part.weights[i * part.ksize + t]).toBe(all.weights[(53 + i) * all.ksize + t])
    }
  })

  it('are an identity when the size does not change', () => {
    const taps = computeTaps(248, 248, 0, 248)
    for (let i = 0; i < 248; i++) {
      let value = 0
      for (let t = 0; t < taps.counts[i]; t++) if (taps.weights[i * taps.ksize + t] !== 0) value += taps.weights[i * taps.ksize + t] * (taps.starts[i] + t === i ? 1 : 0)
      expect(value).toBe(1 << 22)
    }
  })
})

describe(`bit for bit like Pillow ${vectors.pillow}`, () => {
  it.each(vectors.cases.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    const rgb = synthPicture(c.width, c.height, c.seed)
    // the picture itself must be the one Pillow got: the means of the crops were printed by the generator
    const crop = resizeAndCrop({ data: rgb, width: c.width, height: c.height })
    expect(Array.from(crop.subarray(0, 30))).toEqual(c.cropHead)
    expect(sha256(crop)).toBe(c.cropSha256)
    expect(sha256(bytesOf(normalize(crop)))).toBe(c.tensorSha256)
    expect(sha256(bytesOf(preprocess({ data: rgb, width: c.width, height: c.height })))).toBe(c.tensorSha256)
    const resized = resizedSize(c.width, c.height, CLIP_RESIZE)
    expect([resized.width, resized.height]).toEqual(c.resized)
    expect([cropOffset(resized.width, CLIP_CROP), cropOffset(resized.height, CLIP_CROP)]).toEqual([c.left, c.top])
  })

  it('ignores the alpha channel of a canvas picture', () => {
    const c = vectors.cases[0]
    const rgb = synthPicture(c.width, c.height, c.seed)
    const crop = resizeAndCrop({ data: withAlpha(rgb), width: c.width, height: c.height, channels: 4 })
    expect(sha256(crop)).toBe(c.cropSha256)
  })
})

describe('the tensor', () => {
  it('has the shape and the values the model expects', () => {
    const rgb = synthPicture(300, 200, 9)
    const tensor = preprocess({ data: rgb, width: 300, height: 200 })
    expect(tensor).toBeInstanceOf(Float32Array)
    expect(tensor.length).toBe(3 * 224 * 224)
    // normalised CLIP values lie between (0 - mean) / std and (1 - mean) / std
    for (let ch = 0; ch < 3; ch++) {
      const lo = (0 - CLIP_MEAN[ch]) / CLIP_STD[ch]
      const hi = (1 - CLIP_MEAN[ch]) / CLIP_STD[ch]
      for (let i = 0; i < 224 * 224; i += 97) {
        const v = tensor[ch * 224 * 224 + i]
        expect(v).toBeGreaterThanOrEqual(lo - 1e-6)
        expect(v).toBeLessThanOrEqual(hi + 1e-6)
      }
    }
  })

  it('repeats torch float32 arithmetic for black and white', () => {
    const black = normalize(new Uint8Array(224 * 224 * 3))
    const white = normalize(new Uint8Array(224 * 224 * 3).fill(255))
    for (let ch = 0; ch < 3; ch++) {
      const mean = Math.fround(CLIP_MEAN[ch])
      const std = Math.fround(CLIP_STD[ch])
      expect(black[ch * 224 * 224]).toBe(Math.fround(Math.fround(0 - mean) / std))
      expect(white[ch * 224 * 224]).toBe(Math.fround(Math.fround(Math.fround(255 / 255) - mean) / std))
    }
  })

  it('reports the brightness spread, so blank pictures can be told apart', () => {
    const flat = preprocessWithStats({ data: new Uint8Array(40 * 30 * 3).fill(128), width: 40, height: 30 })
    expect(flat.spread).toBe(0)
    const busy = preprocessWithStats({ data: synthPicture(120, 90, 3), width: 120, height: 90 })
    expect(busy.spread).toBeGreaterThan(20)
    expect(brightnessSpread(new Uint8Array(0))).toBe(0)
    expect(brightnessSpread(new Uint8Array([0, 0, 0, 255, 255, 255]))).toBeCloseTo(127.5, 5)
  })

  it('refuses pictures it cannot read', () => {
    expect(() => preprocess({ data: new Uint8Array(10), width: 0, height: 5 })).toThrow(RangeError)
    expect(() => preprocess({ data: new Uint8Array(10), width: 5, height: 5 })).toThrow(RangeError)
    expect(() => preprocess({ data: new Uint8Array(75), width: 5, height: 5 }, 100, 224)).toThrow(RangeError)
  })
})

// WingDex ships golden vectors made with Pillow and timm: the decoded pixels of two photos and the tensors the
// reference pipeline made from them. They live outside this repository, so the test is skipped where they are missing.
const wingdexParity = process.env.WINGDEX_PARITY_DIR ?? '/home/user/birdnet-team/wingdex/ml/parity'
describe.skipIf(!existsSync(join(wingdexParity, 'meta.json')))('against the WingDex golden vectors', () => {
  const meta = existsSync(join(wingdexParity, 'meta.json'))
    ? (JSON.parse(readFileSync(join(wingdexParity, 'meta.json'), 'utf8')) as { photos: { i: number; w: number; h: number }[] })
    : { photos: [] }

  it.each(meta.photos.map((p) => [`photo ${p.i} (${p.w}x${p.h})`, p] as const))('%s matches the Pillow tensor to the last float', (_label, photo) => {
    const tag = String(photo.i).padStart(3, '0')
    const source = new Uint8Array(readFileSync(join(wingdexParity, `src_${tag}.u8.bin`)))
    const reference = readFileSync(join(wingdexParity, `ref_${tag}.f32.bin`))
    const want = new Float32Array(reference.buffer.slice(reference.byteOffset, reference.byteOffset + reference.byteLength))
    const got = preprocess({ data: source, width: photo.w, height: photo.h })
    expect(got.length).toBe(want.length)
    let worst = 0
    let different = 0
    for (let i = 0; i < want.length; i++) {
      const d = Math.abs(got[i] - want[i])
      if (d > worst) worst = d
      if (d > 0) different++
    }
    // WingDex's own floating point version is off by up to 0.03 here (one or two grey levels in 14 percent of the values)
    expect(worst).toBeLessThanOrEqual(1e-6)
    expect(different).toBeLessThanOrEqual(want.length / 1000)
  })
})
