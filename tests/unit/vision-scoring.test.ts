import { describe, expect, it, vi, afterEach } from 'vitest'
import { CALIBRATION, SCORING } from '../../src/ml/vision/constants'
import {
  birdProbability,
  clamp01,
  isNotABird,
  logit,
  makeDexMask,
  scoreSpecies,
  sigmoid,
  toCandidates,
  topIndices,
} from '../../src/ml/vision/scoring'
import { createRegionPrior, getOccurrencePriorProvider, priorToLogWeights, resolveLogWeights, setOccurrencePriorProvider } from '../../src/ml/vision/prior'
import { makeSpecies } from './helpers/vision-fixtures'

describe('sigmoid and logit', () => {
  it('are inverse to each other and survive saturation', () => {
    expect(sigmoid(0)).toBe(0.5)
    expect(sigmoid(logit(0.3))).toBeCloseTo(0.3, 10)
    expect(Number.isFinite(logit(1))).toBe(true)
    expect(Number.isFinite(logit(0))).toBe(true)
    expect(logit(1)).toBeGreaterThan(15)
  })
})

describe('the bird probe', () => {
  it('reproduces the numbers WingDex documents: raw 0.1032229138 is the threshold 0.3736373465', () => {
    const dot = Math.log(0.1032229138 / (1 - 0.1032229138)) - CALIBRATION.probe.bias
    const { pRaw, pBird } = birdProbability(dot)
    expect(pRaw).toBeCloseTo(0.1032229138, 8)
    expect(pBird).toBeCloseTo(CALIBRATION.probe.threshold, 6)
  })

  it('gives a high probability for a strong bird signal and a low one for a weak signal', () => {
    expect(birdProbability(3).pBird).toBeGreaterThan(0.99)
    expect(birdProbability(-6).pBird).toBeLessThan(0.1)
  })

  it('does not return NaN when the probe saturates', () => {
    expect(Number.isFinite(birdProbability(100).pBird)).toBe(true)
    expect(Number.isFinite(birdProbability(-100).pBird)).toBe(true)
  })

  it('abstains below the threshold, and on anything that is not a number', () => {
    expect(isNotABird(0.2)).toBe(true)
    expect(isNotABird(CALIBRATION.probe.threshold - 1e-6)).toBe(true)
    expect(isNotABird(CALIBRATION.probe.threshold)).toBe(false)
    expect(isNotABird(0.9)).toBe(false)
    expect(isNotABird(Number.NaN)).toBe(true)
  })
})

describe('makeDexMask', () => {
  it('marks the rows of the Dex', () => {
    const mask = makeDexMask(6, [4, 1, 5])
    expect(Array.from(mask)).toEqual([0, 1, 0, 0, 1, 1])
  })

  it('refuses a row that does not exist', () => {
    expect(() => makeDexMask(6, [6])).toThrow(RangeError)
    expect(() => makeDexMask(6, [-1])).toThrow(RangeError)
    expect(() => makeDexMask(6, [1.5])).toThrow(RangeError)
  })
})

describe('scoreSpecies', () => {
  const T = CALIBRATION.temperature
  // rows 0..5; the Dex has rows 1, 3 and 4
  const dexRows = [1, 3, 4]
  const mask = makeDexMask(6, dexRows)

  it('is a softmax of cosine / temperature, and the mass of the Dex and outside adds up to 1', () => {
    const sims = Float32Array.from([0.1, 0.5, 0.2, 0.52, 0.3, 0.0])
    const { probs, outsideMass } = scoreSpecies(sims, dexRows, mask, { outOfDexPenalty: 0 })
    const total = Array.from(probs).reduce((a, b) => a + b, 0) + outsideMass
    expect(total).toBeCloseTo(1, 6)
    // with no penalty it is the plain softmax over all six rows
    const exps = Array.from(sims).map((s) => Math.exp((s - 0.52) / T))
    const sum = exps.reduce((a, b) => a + b, 0)
    expect(probs[1]).toBeCloseTo(exps[3] / sum, 6)
    expect(probs[0]).toBeCloseTo(exps[1] / sum, 6)
  })

  it('lowers species outside the Dex by the penalty, so they stay rivals without winning by default', () => {
    // row 0 is outside the Dex and the best match by 0.01 (1.3 temperature units)
    const sims = Float32Array.from([0.6, 0.59, 0.2, 0.2, 0.2, 0.2])
    const none = scoreSpecies(sims, dexRows, mask, { outOfDexPenalty: 0 })
    const six = scoreSpecies(sims, dexRows, mask, { outOfDexPenalty: 6 })
    expect(none.probs[0]).toBeLessThan(0.5)
    expect(six.probs[0]).toBeGreaterThan(0.9)
    expect(none.outsideMass).toBeGreaterThan(six.outsideMass)
    // a foreign bird far ahead of every Dex bird still takes the probability: the Dex bird gets little
    const foreign = scoreSpecies(Float32Array.from([0.7, 0.55, 0.2, 0.2, 0.2, 0.2]), dexRows, mask, { outOfDexPenalty: 6 })
    expect(foreign.probs[0]).toBeLessThan(0.1)
    expect(foreign.outsideMass).toBeGreaterThan(0.9)
  })

  it('does not change the order of the Dex species whatever the penalty', () => {
    const sims = Float32Array.from([0.9, 0.5, 0.2, 0.55, 0.3, 0.0])
    for (const penalty of [0, 3, 6, 20]) {
      const { probs } = scoreSpecies(sims, dexRows, mask, { outOfDexPenalty: penalty })
      expect(probs[1]).toBeGreaterThan(probs[0])
      expect(probs[0]).toBeGreaterThan(probs[2])
    }
  })

  it('uses the default temperature and penalty of the constants', () => {
    const sims = Float32Array.from([0.4, 0.5, 0.2, 0.45, 0.3, 0.0])
    const given = scoreSpecies(sims, dexRows, mask, { temperature: T, outOfDexPenalty: SCORING.outOfDexPenalty })
    const fallback = scoreSpecies(sims, dexRows, mask)
    expect(Array.from(fallback.probs)).toEqual(Array.from(given.probs))
  })

  it('shifts the odds with a prior and keeps working when it is flat', () => {
    const sims = Float32Array.from([0.1, 0.5, 0.2, 0.5, 0.3, 0.0])
    const flat = scoreSpecies(sims, dexRows, mask, { logPrior: Float32Array.from([0, 0, 0]) })
    expect(flat.probs[0]).toBeCloseTo(flat.probs[1], 6)
    const tilted = scoreSpecies(sims, dexRows, mask, { logPrior: Float32Array.from([0, -3, 0]) })
    expect(tilted.probs[0] / tilted.probs[1]).toBeCloseTo(Math.exp(3), 3)
  })

  it('refuses a prior of the wrong length', () => {
    expect(() => scoreSpecies(new Float32Array(6), dexRows, mask, { logPrior: new Float32Array(2) })).toThrow(RangeError)
  })

  it('gives zeros and all the mass to the outside when the similarities are not numbers', () => {
    const { probs, outsideMass } = scoreSpecies(new Float32Array(6).fill(Number.NaN), dexRows, mask)
    expect(Array.from(probs)).toEqual([0, 0, 0])
    expect(outsideMass).toBe(1)
  })
})

describe('topIndices and toCandidates', () => {
  it('pick the strongest, strongest first, and keep the order of equal values', () => {
    expect(topIndices([0.1, 0.5, 0.3, 0.5, 0.2], 3)).toEqual([1, 3, 2])
    expect(topIndices([0.1, 0.2], 3)).toEqual([1, 0])
    expect(topIndices([], 3)).toEqual([])
  })

  it('make candidates with confidence = P(bird) * P(species)', () => {
    const ids = ['a', 'b', 'c', 'd']
    const candidates = toCandidates([0.1, 0.6, 0.05, 0.2], 0.9, (i) => ids[i])
    expect(candidates.map((c) => c.speciesId)).toEqual(['b', 'd', 'a'])
    expect(candidates[0].confidence).toBeCloseTo(0.54, 10)
    expect(candidates[1].confidence).toBeCloseTo(0.18, 10)
  })

  it('keep every confidence between 0 and 1', () => {
    expect(clamp01(-0.2)).toBe(0)
    expect(clamp01(1.4)).toBe(1)
    expect(clamp01(Number.NaN)).toBe(0)
    const [only] = toCandidates([1.5], 1, () => 'x', 1)
    expect(only.confidence).toBe(1)
  })
})

describe('the occurrence prior', () => {
  afterEach(() => setOccurrencePriorProvider(undefined))
  const species = makeSpecies([0, 1, 2, 3])

  it('turns weights into log odds relative to the most plausible species', () => {
    const prior = new Map([
      ['sp-0', 0.8],
      ['sp-1', 0.08],
      ['sp-2', 0.8],
    ])
    const logs = priorToLogWeights(species, prior, { strength: 1, floor: 0.001 })!
    expect(logs[0]).toBeCloseTo(0, 6)
    expect(logs[2]).toBeCloseTo(0, 6)
    expect(logs[1]).toBeCloseTo(Math.log(0.08 / 0.8), 5)
    // no opinion about sp-3: treated like the most plausible
    expect(logs[3]).toBe(0)
  })

  it('applies the strength and the floor', () => {
    const prior = new Map([
      ['sp-0', 1],
      ['sp-1', 0],
    ])
    const logs = priorToLogWeights(species, prior, { strength: 0.5, floor: 0.001 })!
    expect(logs[1]).toBeCloseTo(0.5 * Math.log(0.001), 5)
  })

  it('has no effect when it has no opinion about any species', () => {
    expect(priorToLogWeights(species, new Map())).toBeUndefined()
    expect(priorToLogWeights(species, new Map([['sp-0', Number.NaN]]))).toBeUndefined()
  })

  it('works without a provider, and with one that returns nothing or fails', async () => {
    expect(getOccurrencePriorProvider()).toBeUndefined()
    expect(await resolveLogWeights(species, {})).toBeUndefined()
    setOccurrencePriorProvider(() => undefined)
    expect(await resolveLogWeights(species, {})).toBeUndefined()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    setOccurrencePriorProvider(() => {
      throw new Error('geo model is not loaded')
    })
    expect(await resolveLogWeights(species, {})).toBeUndefined()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('hands the location and date to the provider', async () => {
    const seen: unknown[] = []
    setOccurrencePriorProvider(async (request) => {
      seen.push(request)
      return new Map([['sp-1', 0.5]])
    })
    const date = new Date(2026, 4, 1)
    const logs = await resolveLogWeights(species, { location: { lat: 50, lon: 14 }, date })
    expect(seen).toEqual([{ location: { lat: 50, lon: 14 }, date }])
    expect(logs).toBeInstanceOf(Float32Array)
  })

  it('has a ready-made prior from the Dex flags', () => {
    const list = makeSpecies([0, 1, 2], { inCzechia: (i) => i !== 1 })
    const czech = createRegionPrior(list, 'czechia', 0.05)
    expect(czech.get('sp-0')).toBe(1)
    expect(czech.get('sp-1')).toBe(0.05)
    const europe = createRegionPrior(list, 'europe')
    expect(europe.get('sp-1')).toBe(1)
    const logs = priorToLogWeights(list, czech)!
    expect(logs[0]).toBe(0)
    expect(logs[1]).toBeCloseTo(Math.log(0.05), 5)
  })
})
