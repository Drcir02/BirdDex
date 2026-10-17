import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ClassifierFormatError, decodeClassifier, norm, probeDot, similarities } from '../../src/ml/vision/classifier'
import { makeClassifierBytes, random, randomUnitRow, roundTrip } from './helpers/vision-fixtures'

const DIM = 768

function makeRows(count: number, seed: number): number[][] {
  const next = random(seed)
  return Array.from({ length: count }, () => randomUnitRow(DIM, next))
}

describe('decodeClassifier', () => {
  it('reads int8 rows with their scales, and splits off the last row as the probe', () => {
    const rows = makeRows(6, 1)
    const classifier = decodeClassifier(makeClassifierBytes(rows), 5)
    expect(classifier.rows).toBe(5)
    expect(classifier.q.length).toBe(5 * DIM)
    expect(classifier.scales.length).toBe(5)
    expect(classifier.probe.length).toBe(DIM)
    for (let r = 0; r < 5; r++) {
      const back = roundTrip(rows[r])
      for (let i = 0; i < DIM; i += 37) expect(classifier.q[r * DIM + i] * classifier.scales[r]).toBeCloseTo(back[i], 6)
    }
    const probe = roundTrip(rows[5])
    for (let i = 0; i < DIM; i += 41) expect(classifier.probe[i]).toBeCloseTo(probe[i], 6)
  })

  it('works when the file does not start at a multiple of four bytes', () => {
    const rows = makeRows(4, 2)
    const packed = makeClassifierBytes(rows)
    const shifted = new Uint8Array(packed.length + 3)
    shifted.set(packed, 3)
    const classifier = decodeClassifier(shifted.subarray(3), 3)
    const aligned = decodeClassifier(packed, 3)
    expect(Array.from(classifier.scales)).toEqual(Array.from(aligned.scales))
    expect(Array.from(classifier.probe)).toEqual(Array.from(aligned.probe))
  })

  it('refuses a file that is not a whole number of rows', () => {
    const packed = makeClassifierBytes(makeRows(4, 3))
    expect(() => decodeClassifier(packed.subarray(0, packed.length - 1))).toThrow(ClassifierFormatError)
    expect(() => decodeClassifier(new Uint8Array(DIM + 4))).toThrow(ClassifierFormatError)
    expect(() => decodeClassifier(new Uint8Array(0))).toThrow(ClassifierFormatError)
  })

  it('refuses a classifier with another number of species than expected', () => {
    const packed = makeClassifierBytes(makeRows(4, 4))
    expect(() => decodeClassifier(packed, 10994)).toThrow(/3 species rows/)
    expect(decodeClassifier(packed).rows).toBe(3)
  })
})

describe('similarities', () => {
  it('equal the float dot product of the dequantised rows with the normalised embedding', () => {
    const rows = makeRows(9, 5)
    const classifier = decodeClassifier(makeClassifierBytes(rows), 8)
    const embedding = Float32Array.from(randomUnitRow(DIM, random(99)).map((v) => v * 3.7))
    const sims = similarities(classifier, embedding)
    for (let r = 0; r < 8; r++) {
      const row = roundTrip(rows[r])
      let dot = 0
      for (let i = 0; i < DIM; i++) dot += row[i] * embedding[i]
      expect(sims[r]).toBeCloseTo(dot / norm(embedding), 5)
    }
  })

  it('give 1 for the row itself, and do not depend on the length of the embedding', () => {
    const rows = makeRows(4, 6)
    const classifier = decodeClassifier(makeClassifierBytes(rows), 3)
    const embedding = Float32Array.from(rows[1])
    const scaled = Float32Array.from(rows[1].map((v) => v * 50))
    const a = similarities(classifier, embedding)
    const b = similarities(classifier, scaled)
    expect(a[1]).toBeCloseTo(1, 2)
    for (let r = 0; r < 3; r++) expect(b[r]).toBeCloseTo(a[r], 5)
  })

  it('reuse the output array and give zeros for a dead embedding', () => {
    const classifier = decodeClassifier(makeClassifierBytes(makeRows(4, 7)), 3)
    const out = new Float32Array(3)
    const result = similarities(classifier, new Float32Array(DIM), out)
    expect(result).toBe(out)
    expect(Array.from(result)).toEqual([0, 0, 0])
  })

  it('handle a dimension that is not a multiple of four', () => {
    const rows = [
      [0.5, -0.5, 0.5, 0.5, 0.1],
      [1, 0, 0, 0, 0],
      [0, 0, 0, 0, 1],
    ]
    const classifier = decodeClassifier(makeClassifierBytes(rows), 2, 5)
    const sims = similarities(classifier, Float32Array.from([1, 0, 0, 0, 0]), undefined, 5)
    expect(sims[1]).toBeCloseTo(1, 2)
    expect(sims[0]).toBeCloseTo(roundTrip(rows[0])[0], 3)
    expect(sims[1]).toBeCloseTo(roundTrip(rows[1])[0], 3)
  })
})

describe('probeDot', () => {
  it('is the probe row dotted with the normalised embedding', () => {
    const rows = makeRows(4, 8)
    const classifier = decodeClassifier(makeClassifierBytes(rows), 3)
    const embedding = Float32Array.from(randomUnitRow(DIM, random(5)).map((v) => v * 2))
    const probe = roundTrip(rows[3])
    let dot = 0
    for (let i = 0; i < DIM; i++) dot += probe[i] * embedding[i]
    expect(probeDot(classifier, embedding)).toBeCloseTo(dot / norm(embedding), 5)
  })
})

// The real file, when it is on this machine: the numbers the whole engine relies on.
const modelDir = join(__dirname, '../../public/models')
describe.skipIf(!existsSync(join(modelDir, 'text_classifier_int8.bin')))('the real text_classifier_int8.bin', () => {
  const bytes = existsSync(join(modelDir, 'text_classifier_int8.bin')) ? new Uint8Array(readFileSync(join(modelDir, 'text_classifier_int8.bin'))) : new Uint8Array(0)

  it('has 10994 species rows and a probe, as WingDex says', () => {
    expect(bytes.byteLength).toBe(10995 * (DIM + 4))
    const classifier = decodeClassifier(bytes, 10994)
    expect(classifier.rows).toBe(10994)
  })

  it('has unit length rows (they are cosine directions) and a finite probe', () => {
    const classifier = decodeClassifier(bytes, 10994)
    for (const r of [0, 1, 76, 5000, 10993]) {
      let sum = 0
      for (let i = 0; i < DIM; i++) sum += (classifier.q[r * DIM + i] * classifier.scales[r]) ** 2
      expect(Math.sqrt(sum)).toBeGreaterThan(0.98)
      expect(Math.sqrt(sum)).toBeLessThan(1.02)
    }
    expect(classifier.probe.every(Number.isFinite)).toBe(true)
    expect(norm(classifier.probe)).toBeGreaterThan(0.1)
  })

  it('has a row for every bird of the Dex, and the rows are the right birds', () => {
    const list = JSON.parse(readFileSync(join(__dirname, '../../public/data/species.json'), 'utf8')) as { id: string; wingclipIndex: number | null }[]
    const rows = list.map((s) => s.wingclipIndex).filter((r): r is number => r !== null)
    expect(rows.length).toBeGreaterThanOrEqual(400)
    expect(Math.max(...rows)).toBeLessThan(10994)
    expect(new Set(rows).size).toBe(rows.length)
  })
})
