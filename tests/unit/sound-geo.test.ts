import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FloatModel } from '../../src/ml/runtime/litert'

vi.mock('../../src/ml/runtime/litert', () => ({ compileFloatModel: vi.fn() }))

import { compileFloatModel } from '../../src/ml/runtime/litert'
import { createGeoPrior, GEO_MIN_SPECIES, GEO_THRESHOLD, geoKey, isValidPoint, weekOfYear48 } from '../../src/ml/sound/geo'
import { BIRDNET_OUTPUTS } from '../../src/ml/sound/scores'

describe('weekOfYear48: BirdNET\'s week, four per month', () => {
  const week = (year: number, month: number, day: number) => weekOfYear48(new Date(year, month - 1, day, 12))

  it('splits every month into days 1 to 7, 8 to 14, 15 to 21 and 22 to the end', () => {
    expect([1, 7, 8, 14, 15, 21, 22, 28, 31].map((day) => week(2026, 1, day))).toEqual([1, 1, 2, 2, 3, 3, 4, 4, 4])
    expect([1, 7, 8, 14, 15, 21, 22, 30].map((day) => week(2026, 4, day))).toEqual([13, 13, 14, 14, 15, 15, 16, 16])
  })
  it('runs from 1 on January 1 to 48 on December 31', () => {
    expect(week(2026, 1, 1)).toBe(1)
    expect(week(2026, 12, 31)).toBe(48)
    expect(week(2024, 12, 31)).toBe(48)
  })
  it('puts the 29th of February (leap year) into the last week of February', () => {
    expect(week(2024, 2, 29)).toBe(8)
    expect(week(2026, 2, 28)).toBe(8)
  })
  it('has 48 different weeks over a year and never leaves 1 to 48', () => {
    const seen = new Set<number>()
    for (let d = new Date(2026, 0, 1); d.getFullYear() === 2026; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
      const w = weekOfYear48(d)
      expect(w).toBeGreaterThanOrEqual(1)
      expect(w).toBeLessThanOrEqual(48)
      seen.add(w)
    }
    expect(seen.size).toBe(48)
  })
  it('is mid-October for the day this was written (17 October 2026 is week 39)', () => {
    expect(week(2026, 10, 17)).toBe(39)
  })
  it('follows the phone\'s own calendar day, not UTC', () => {
    // Late evening on the 7th in local time is still week 1 of the month, whatever UTC says.
    expect(weekOfYear48(new Date(2026, 4, 7, 23, 59))).toBe(17)
    expect(weekOfYear48(new Date(2026, 4, 8, 0, 1))).toBe(18)
  })
})

describe('geoKey: one answer per rounded place and week', () => {
  it('rounds to a tenth of a degree', () => {
    expect(geoKey({ lat: 50.08, lon: 14.43 }, 20)).toBe('50.1|14.4|20')
    expect(geoKey({ lat: 50.12, lon: 14.38 }, 20)).toBe('50.1|14.4|20')
    expect(geoKey({ lat: -33.87, lon: 151.21 }, 3)).toBe('-33.9|151.2|3')
  })
  it('tells places that are apart', () => {
    expect(geoKey({ lat: 50.1, lon: 14.4 }, 20)).not.toBe(geoKey({ lat: 50.3, lon: 14.4 }, 20))
    expect(geoKey({ lat: 50.1, lon: 14.4 }, 20)).not.toBe(geoKey({ lat: 50.1, lon: 14.4 }, 21))
  })
  it('refuses positions and weeks that cannot be right', () => {
    expect(geoKey(undefined, 20)).toBeUndefined()
    expect(geoKey({ lat: Number.NaN, lon: 14 }, 20)).toBeUndefined()
    expect(geoKey({ lat: 91, lon: 14 }, 20)).toBeUndefined()
    expect(geoKey({ lat: 50, lon: -181 }, 20)).toBeUndefined()
    expect(geoKey({ lat: 50, lon: 14 }, 0)).toBeUndefined()
    expect(geoKey({ lat: 50, lon: 14 }, 49)).toBeUndefined()
    expect(geoKey({ lat: 50, lon: 14 }, 1.5)).toBeUndefined()
    expect(isValidPoint({ lat: 0, lon: 0 })).toBe(true) // a real place in the Atlantic
    expect(isValidPoint({ lat: Number.POSITIVE_INFINITY, lon: 0 })).toBe(false)
  })
  it('has the constants of BirdNET Analyzer', () => {
    expect(GEO_THRESHOLD).toBe(0.03)
    expect(GEO_MIN_SPECIES).toBeGreaterThan(0)
  })
})

describe('createGeoPrior', () => {
  const calls: Float32Array[] = []
  const models: Array<{ delete: ReturnType<typeof vi.fn> }> = []

  function fakeModel(overrides: Partial<FloatModel> = {}): FloatModel {
    const model = {
      inputShape: [1, 3],
      outputLength: BIRDNET_OUTPUTS,
      deleted: false,
      run: vi.fn(async (input: Float32Array) => {
        calls.push(input.slice())
        return new Float32Array(BIRDNET_OUTPUTS).fill(input[2] / 100) // the week decides the answer
      }),
      delete: vi.fn(),
      ...overrides,
    } as unknown as FloatModel
    models.push(model as unknown as { delete: ReturnType<typeof vi.fn> })
    return model
  }

  const loadBytes = vi.fn(async () => new Uint8Array(8))
  const may = new Date(2026, 4, 14, 12) // week 18

  beforeEach(() => {
    calls.length = 0
    models.length = 0
    loadBytes.mockClear()
    vi.mocked(compileFloatModel).mockReset()
    vi.mocked(compileFloatModel).mockImplementation(async () => fakeModel())
  })

  it('asks the model with [latitude, longitude, week], the position rounded like the cache key', async () => {
    const prior = createGeoPrior(loadBytes)
    const scores = await prior.scores({ lat: 50.08, lon: 14.43 }, may)
    expect(scores).toBeDefined()
    expect(scores!.length).toBe(BIRDNET_OUTPUTS)
    expect(scores![0]).toBeCloseTo(0.18, 6) // week 18 / 100
    expect(calls).toHaveLength(1)
    expect(calls[0][0]).toBeCloseTo(50.1, 4)
    expect(calls[0][1]).toBeCloseTo(14.4, 4)
    expect(calls[0][2]).toBe(18)
  })

  it('computes a place and week once, then answers from memory', async () => {
    const prior = createGeoPrior(loadBytes)
    const first = await prior.scores({ lat: 50.08, lon: 14.43 }, may)
    const second = await prior.scores({ lat: 50.12, lon: 14.38 }, new Date(2026, 4, 10)) // same 0.1 degree cell, same week
    expect(second).toBe(first)
    expect(compileFloatModel).toHaveBeenCalledTimes(1)
    expect(loadBytes).toHaveBeenCalledTimes(1)
    expect(prior.cached).toBe(1)
  })

  it('computes again for another week or another place', async () => {
    const prior = createGeoPrior(loadBytes)
    await prior.scores({ lat: 50.1, lon: 14.4 }, may)
    await prior.scores({ lat: 50.1, lon: 14.4 }, new Date(2026, 5, 14))
    await prior.scores({ lat: 48.9, lon: 2.4 }, may)
    expect(compileFloatModel).toHaveBeenCalledTimes(3)
    expect(prior.cached).toBe(3)
  })

  it('shares one calculation between callers that ask at the same time', async () => {
    const prior = createGeoPrior(loadBytes)
    const [a, b, c] = await Promise.all([1, 2, 3].map(() => prior.scores({ lat: 50.1, lon: 14.4 }, may)))
    expect(a).toBe(b)
    expect(b).toBe(c)
    expect(compileFloatModel).toHaveBeenCalledTimes(1)
  })

  it('frees the model after every calculation', async () => {
    const prior = createGeoPrior(loadBytes)
    await prior.scores({ lat: 50.1, lon: 14.4 }, may)
    expect(models[0].delete).toHaveBeenCalledTimes(1)
  })

  it('has no answer without a usable place, and does not even load the model', async () => {
    const prior = createGeoPrior(loadBytes)
    expect(await prior.scores(undefined, may)).toBeUndefined()
    expect(await prior.scores({ lat: 200, lon: 14 }, may)).toBeUndefined()
    expect(loadBytes).not.toHaveBeenCalled()
  })

  it('fails loudly, frees the model, and tries again next time', async () => {
    const prior = createGeoPrior(loadBytes)
    vi.mocked(compileFloatModel).mockImplementationOnce(async () => fakeModel({ run: vi.fn(async () => Promise.reject(new Error('boom'))) }))
    await expect(prior.scores({ lat: 50.1, lon: 14.4 }, may)).rejects.toThrow('boom')
    expect(models[0].delete).toHaveBeenCalledTimes(1)
    expect(prior.cached).toBe(0)
    expect(await prior.scores({ lat: 50.1, lon: 14.4 }, may)).toBeDefined() // the second try works
  })

  it('refuses a model with the wrong shape', async () => {
    const prior = createGeoPrior(loadBytes)
    vi.mocked(compileFloatModel).mockImplementationOnce(async () => fakeModel({ inputShape: [1, 144000] }))
    await expect(prior.scores({ lat: 50.1, lon: 14.4 }, may)).rejects.toThrow('unexpected shape')
    expect(models[0].delete).toHaveBeenCalledTimes(1)
  })

  it('can compute somewhere else (the worker that holds BirdNET) and still cache the answer', async () => {
    const prior = createGeoPrior(loadBytes)
    const elsewhere = vi.fn(async (_bytes: Uint8Array, _lat: number, _lon: number, week: number) => new Float32Array(BIRDNET_OUTPUTS).fill(week / 100))
    const first = await prior.scores({ lat: 50.08, lon: 14.43 }, may, elsewhere)
    expect(first![0]).toBeCloseTo(0.18, 6)
    expect(elsewhere).toHaveBeenCalledTimes(1)
    expect(elsewhere.mock.calls[0][1]).toBeCloseTo(50.1, 4) // rounded like the cache key
    expect(elsewhere.mock.calls[0][2]).toBeCloseTo(14.4, 4)
    expect(elsewhere.mock.calls[0][3]).toBe(18)
    expect(elsewhere.mock.calls[0][0]).toBeInstanceOf(Uint8Array) // the model file
    expect(compileFloatModel).not.toHaveBeenCalled() // nothing was started on this side
    expect(await prior.scores({ lat: 50.1, lon: 14.4 }, may)).toBe(first) // the answer is cached, whoever computed it
  })

  it('remembers at most 16 places', async () => {
    const prior = createGeoPrior(loadBytes)
    for (let i = 0; i < 20; i++) await prior.scores({ lat: i, lon: 0 }, may)
    expect(prior.cached).toBe(16)
  })
})
