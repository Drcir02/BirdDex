import { afterEach, describe, expect, it, vi } from 'vitest'
import { createGeoPriorProvider, installGeoPrior, PRESENT_SCORE, priorFromGeoScores } from '../../src/ml/vision/geoPrior'
import { getOccurrencePriorProvider, priorToLogWeights, resolveLogWeights, setOccurrencePriorProvider } from '../../src/ml/vision/prior'

// BirdNET's location model as the occurrence prior of the photo engine: the pure parts and the "never in the way" rules.

const indexOf = new Map([
  ['common', 0],
  ['scarce', 1],
  ['absent', 2],
])
const scores = Float32Array.from([0.9, PRESENT_SCORE / 4, 0.001])

afterEach(() => setOccurrencePriorProvider(undefined))

describe('priorFromGeoScores', () => {
  it('counts every bird at or above the present score as fully expected and scales the rest', () => {
    const prior = priorFromGeoScores(scores, indexOf)
    expect(prior.get('common')).toBe(1)
    expect(prior.get('scarce')).toBeCloseTo(0.25, 6)
    expect(prior.get('absent')).toBeCloseTo(0.005, 6)
  })

  it('has no opinion about a bird BirdNET does not know', () => {
    expect(priorFromGeoScores(scores, indexOf).get('mystery')).toBeUndefined()
  })

  it('holds back a scarce bird by a factor of four and an absent one by the floor, not more', () => {
    const logs = priorToLogWeights([{ id: 'common' }, { id: 'scarce' }, { id: 'absent' }], priorFromGeoScores(scores, indexOf))!
    expect(logs[0]).toBe(0)
    expect(logs[1]).toBeCloseTo(Math.log(0.25), 5)
    expect(logs[2]).toBeCloseTo(Math.log(0.01), 5)
  })
})

describe('createGeoPriorProvider', () => {
  const base = {
    isAvailable: async () => true,
    loadBytes: async () => new Uint8Array([1]),
    birdnetIndexOf: async () => indexOf,
    compute: async () => scores,
  }
  const prague = { lat: 50.08, lon: 14.43 }

  it('gives a prior for a place when the model is on the phone', async () => {
    const prior = await createGeoPriorProvider(base)({ location: prague, date: new Date('2026-10-17T10:00:00') })
    expect(prior?.get('scarce')).toBeCloseTo(0.25, 6)
  })

  it('gives none without a place, and never asks for the model', async () => {
    const isAvailable = vi.fn(async () => true)
    const compute = vi.fn(async () => scores)
    expect(await createGeoPriorProvider({ ...base, isAvailable, compute })({ date: new Date() })).toBeUndefined()
    expect(isAvailable).not.toHaveBeenCalled()
    expect(compute).not.toHaveBeenCalled()
  })

  it('gives none (and does not compute) when the location model was not downloaded', async () => {
    const compute = vi.fn(async () => scores)
    const loadBytes = vi.fn(async () => new Uint8Array())
    expect(await createGeoPriorProvider({ ...base, isAvailable: async () => false, compute, loadBytes })({ location: prague })).toBeUndefined()
    expect(compute).not.toHaveBeenCalled()
    expect(loadBytes).not.toHaveBeenCalled()
  })

  it('remembers the answer for the same place and week', async () => {
    const compute = vi.fn(async () => scores)
    const provider = createGeoPriorProvider({ ...base, compute })
    const date = new Date('2026-10-17T10:00:00')
    await provider({ location: prague, date })
    await provider({ location: { lat: 50.081, lon: 14.431 }, date })
    expect(compute).toHaveBeenCalledTimes(1)
  })

  it('a model that will not run means "no prior", never a failed identification', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    setOccurrencePriorProvider(createGeoPriorProvider({ ...base, compute: async () => Promise.reject(new Error('does not compile')) }))
    expect(await resolveLogWeights([{ id: 'common' }], { location: prague })).toBeUndefined()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})

describe('installGeoPrior', () => {
  it('registers once and leaves a provider somebody else registered alone', () => {
    const other = () => undefined
    setOccurrencePriorProvider(other)
    installGeoPrior()
    expect(getOccurrencePriorProvider()).toBe(other)
  })
})
