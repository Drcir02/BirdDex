import { describe, expect, it } from 'vitest'
import {
  BP_CONFIG,
  FACTOR_ORDER,
  TIER_RANGES,
  baseBp,
  bpRangeOf,
  calculateBirdPoints,
  clarityScore,
  confidenceScore,
  factorsOf,
  finishBp,
  qualityOf,
  recalculateStored,
  rollLuck,
  seasonScore,
  timeOfDayScore,
  toStored,
  wayScore,
} from '../../src/domain/birdPoints'
import type { SpeciesInfo } from '../../src/domain/types'

// The BP of a catch (docs/notes/birdpoints-design.md): five scores make the quality, the quality puts the bird in its range,
// a little luck moves it.

/** A small seeded random generator, so that the simulations give the same numbers every time. */
function seeded(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const at = (month: number, hour: number, minute = 0) => new Date(2026, month, 15, hour, minute).getTime()
const info = (patch: Partial<SpeciesInfo> = {}): SpeciesInfo => ({ months: '000033333000', place: 'woods', shy: 2, day: 'dawn', tip: 'thrushes', ...patch })

describe('the weights', () => {
  it('add up to one', () => {
    const sum = Object.values(BP_CONFIG.weights).reduce((a, b) => a + b, 0)
    expect(sum).toBeCloseTo(1, 10)
    expect(Object.keys(BP_CONFIG.weights).sort()).toEqual([...FACTOR_ORDER].sort())
  })
})

describe('the confidence score', () => {
  it('is 0 at half sure, 0.5 at three quarters and 1 when certain', () => {
    expect(confidenceScore(0.5)).toBe(0)
    expect(confidenceScore(0.75)).toBeCloseTo(0.5, 10)
    expect(confidenceScore(1)).toBe(1)
  })
  it('stays between 0 and 1', () => {
    expect(confidenceScore(0.2)).toBe(0)
    expect(confidenceScore(1.4)).toBe(1)
    expect(confidenceScore(Number.NaN)).toBe(0)
  })
})

describe('the clarity score', () => {
  it('is the lead over the next guess as a share of 0.5, and 1 when there is no other guess', () => {
    expect(clarityScore(undefined)).toBe(1)
    expect(clarityScore(0)).toBe(0)
    expect(clarityScore(0.25)).toBeCloseTo(0.5, 10)
    expect(clarityScore(0.5)).toBe(1)
    expect(clarityScore(0.9)).toBe(1)
    expect(clarityScore(-0.1)).toBe(0)
  })
})

describe('the season score', () => {
  const months = '012300000321' // January 0 ... April 3 ... December 1
  it('follows the level of the month of the catch', () => {
    expect(seasonScore(months, at(0, 12))).toBe(0.1) // January: level 0
    expect(seasonScore(months, at(1, 12))).toBe(0.35) // February: level 1
    expect(seasonScore(months, at(2, 12))).toBe(0.7) // March: level 2
    expect(seasonScore(months, at(3, 12))).toBe(1) // April: level 3
  })
  it('is neutral for a bird without a month strip or with a broken one', () => {
    expect(seasonScore(undefined, at(3, 12))).toBe(BP_CONFIG.neutral.season)
    expect(seasonScore('123', at(3, 12))).toBe(BP_CONFIG.neutral.season)
  })
})

describe('the time of day score', () => {
  it('is 1 inside the time of day of the bird', () => {
    expect(timeOfDayScore('day', at(5, 12))).toBe(1)
    expect(timeOfDayScore('dawn', at(5, 6))).toBe(1)
    expect(timeOfDayScore('dawn_dusk', at(5, 6))).toBe(1)
    expect(timeOfDayScore('dawn_dusk', at(5, 19))).toBe(1)
    expect(timeOfDayScore('dusk', at(5, 22))).toBe(1)
    expect(timeOfDayScore('dusk', at(5, 2))).toBe(1)
    expect(timeOfDayScore('night', at(5, 23))).toBe(1)
    expect(timeOfDayScore('night', at(5, 3))).toBe(1)
  })
  it('is 0.7 within two hours of it, and 0.5 further away', () => {
    expect(timeOfDayScore('day', at(5, 7))).toBe(0.7)
    expect(timeOfDayScore('day', at(5, 19, 30))).toBe(0.7)
    expect(timeOfDayScore('day', at(5, 2))).toBe(0.5)
    expect(timeOfDayScore('dawn', at(5, 11))).toBe(0.7)
    expect(timeOfDayScore('dawn', at(5, 14))).toBe(0.5)
    expect(timeOfDayScore('night', at(5, 12))).toBe(0.5)
    expect(timeOfDayScore('night', at(5, 6))).toBe(0.7)
  })
  it('is neutral for a bird without a time of day', () => {
    expect(timeOfDayScore(undefined, at(5, 12))).toBe(BP_CONFIG.neutral.timeOfDay)
  })
})

describe('the way of catching', () => {
  const HOUR = 3_600_000
  const DAY = 24 * HOUR
  it('rates the live camera and a sound scan', () => {
    expect(wayScore('live', 0)).toBe(1)
    expect(wayScore('sound', 0)).toBe(0.9)
    expect(wayScore('sound', 30 * DAY)).toBe(0.9)
  })
  it('rates a fresh photo 0.8 and lets an old one fall to 0.4 over a week', () => {
    expect(wayScore('photo', 0)).toBe(0.8)
    expect(wayScore('photo', HOUR)).toBe(0.8)
    expect(wayScore('photo', 7 * DAY)).toBeCloseTo(0.4, 10)
    expect(wayScore('photo', 400 * DAY)).toBeCloseTo(0.4, 10)
    const middle = wayScore('photo', 3.5 * DAY)
    expect(middle).toBeGreaterThan(0.4)
    expect(middle).toBeLessThan(0.8)
  })
  it('treats a date in the future like a fresh photo', () => {
    expect(wayScore('photo', -5 * HOUR)).toBe(0.8)
  })
})

describe('the quality and the start', () => {
  const all = (value: number) => ({ confidence: value, clarity: value, season: value, timeOfDay: value, way: value })
  it('is 0 for nothing and 1 for everything', () => {
    expect(qualityOf(all(0))).toBe(0)
    expect(qualityOf(all(1))).toBeCloseTo(1, 10)
  })
  it('weighs the confidence half', () => {
    expect(qualityOf({ ...all(0), confidence: 1 })).toBeCloseTo(0.5, 10)
    expect(qualityOf({ ...all(0), way: 1 })).toBeCloseTo(0.2, 10)
  })
  it('puts a perfect catch of a 50 to 750 bird at 680, as in the design', () => {
    expect(baseBp([50, 750], 1)).toBeCloseTo(680, 6)
    expect(baseBp([50, 750], 0)).toBe(50)
    expect(baseBp([1600, 2600], 1)).toBeCloseTo(2500, 6)
    expect(baseBp([1100, 1900], 1)).toBeCloseTo(1820, 6)
  })
  it('follows the curve: a middle quality is below the middle of the range', () => {
    expect(baseBp([0, 1000], 0.5)).toBeLessThan(0.9 * 500)
  })
})

describe('the luck', () => {
  it('runs from -9 % to +13 % of the range, and the middle is a little above nothing', () => {
    expect(rollLuck(() => 0)).toBeCloseTo(-0.09, 10)
    expect(rollLuck(() => 1)).toBeCloseTo(0.13, 10)
    expect(rollLuck(() => 0.5)).toBeCloseTo(0.02, 10)
  })
  it('turns 680 into 620 to 750 for the 50 to 750 bird of the design', () => {
    expect(finishBp([50, 750], 1, -0.09)).toEqual({ bp: 617, base: 680 })
    expect(finishBp([50, 750], 1, 0.13)).toEqual({ bp: 750, base: 680 })
    expect(finishBp([50, 750], 1, 0.02).bp).toBe(694)
  })
  it('never goes below the min or above the max', () => {
    expect(finishBp([50, 750], 0, -0.09).bp).toBe(50)
    expect(finishBp([50, 750], 1, 0.5).bp).toBe(750)
    expect(finishBp([1600, 2600], 0, -0.09).bp).toBe(1600)
  })
})

describe('what many catches give (100 000 simulated catches)', () => {
  function simulate(range: readonly [number, number], quality: number) {
    const random = seeded(2026)
    const values = Array.from({ length: 100_000 }, () => finishBp(range, quality, rollLuck(random)).bp).sort((a, b) => a - b)
    // The 0.5th and the 99.5th percentile: 99 out of 100 catches land between them.
    return { low: values[500], median: values[50_000], high: values[99_500], max: values.filter((v) => v === range[1]).length / values.length }
  }

  it('gives a perfect mallard 625 to 750 (99 catches in 100) and the max about once in 25', () => {
    const result = simulate([50, 750], 1)
    expect(result.low).toBeGreaterThanOrEqual(620)
    expect(result.low).toBeLessThanOrEqual(632)
    expect(result.high).toBe(750)
    expect(result.max).toBeGreaterThan(0.03)
    expect(result.max).toBeLessThan(0.05)
  })

  it('never reaches the max without a very good catch', () => {
    expect(simulate([50, 750], 0.93).max).toBe(0)
    expect(simulate([1600, 2600], 0.74).max).toBe(0)
  })

  it('starts a legendary bird above 1600 even for the worst catch, and an epic one above 1100', () => {
    expect(simulate([1600, 2600], 0.15).low).toBeGreaterThanOrEqual(1600)
    expect(simulate([1100, 1900], 0.15).low).toBeGreaterThanOrEqual(1100)
    expect(simulate([1600, 2600], 0).median).toBeGreaterThanOrEqual(1600)
  })
})

describe('the range of a bird', () => {
  it('is its own when species.json has one', () => {
    expect(bpRangeOf({ rarity: 'common', info: info({ bp: [50, 750] }) })).toEqual([50, 750])
  })
  it('falls back to the range of its rarity', () => {
    expect(bpRangeOf({ rarity: 'epic', info: info() })).toEqual(TIER_RANGES.epic)
    expect(bpRangeOf({ rarity: 'legendary' })).toEqual(TIER_RANGES.legendary)
    expect(bpRangeOf({ rarity: 'rare', info: info({ bp: [900, 100] }) })).toEqual(TIER_RANGES.rare)
  })
  it('has floors that rise with the rarity', () => {
    const floors = (['common', 'uncommon', 'rare', 'epic', 'legendary'] as const).map((rarity) => TIER_RANGES[rarity][0])
    expect(floors).toEqual([50, 300, 650, 1100, 1600])
  })
})

describe('the BP of a whole catch', () => {
  const species = { rarity: 'common' as const, info: info({ months: '333333333333', day: 'day', bp: [50, 750] }) }
  const noon = at(5, 12)

  it('gives a perfect live catch 680 plus the luck', () => {
    const points = calculateBirdPoints({ species, method: 'live', confidence: 1, caughtAt: noon, now: noon, random: () => 0.5 })
    expect(points.quality).toBeCloseTo(1, 10)
    expect(points.base).toBe(680)
    expect(points.luck).toBeCloseTo(0.02, 10)
    expect(points.bp).toBe(694)
    expect(points.factors).toEqual({ confidence: 1, clarity: 1, season: 1, timeOfDay: 1, way: 1 })
  })

  it('gives less for a weaker catch', () => {
    const strong = calculateBirdPoints({ species, method: 'live', confidence: 0.95, lead: 0.6, caughtAt: noon, now: noon, random: () => 0.5 })
    const weak = calculateBirdPoints({ species, method: 'photo', confidence: 0.6, lead: 0.05, caughtAt: noon - 3 * 86_400_000, now: noon, random: () => 0.5 })
    expect(weak.bp).toBeLessThan(strong.bp)
    expect(weak.quality).toBeLessThan(strong.quality)
  })

  it('uses a middle clarity for a catch from before BP existed', () => {
    const points = calculateBirdPoints({ species, method: 'sound', confidence: 0.8, caughtAt: noon, now: noon, unknownClarity: true, random: () => 0.5 })
    expect(points.factors.clarity).toBe(BP_CONFIG.neutral.clarity)
  })

  it('uses the clock and the real dice when they are not given', () => {
    const points = calculateBirdPoints({ species, method: 'sound', confidence: 0.9, caughtAt: Date.now() })
    expect(points.bp).toBeGreaterThanOrEqual(50)
    expect(points.bp).toBeLessThanOrEqual(750)
  })

  it('gives two catches that are exactly alike the same quality, and they may differ only by luck', () => {
    const random = seeded(5)
    const a = calculateBirdPoints({ species, method: 'sound', confidence: 0.9, caughtAt: noon, now: noon, random })
    const b = calculateBirdPoints({ species, method: 'sound', confidence: 0.9, caughtAt: noon, now: noon, random })
    expect(a.quality).toBe(b.quality)
    expect(a.base).toBe(b.base)
    expect(a.luck).not.toBe(b.luck)
  })
})

describe('storing and recalculating', () => {
  const species = { rarity: 'common' as const, info: info({ bp: [50, 750] }) }
  const when = at(3, 7)
  const points = calculateBirdPoints({ species, method: 'live', confidence: 0.9, lead: 0.4, caughtAt: when, now: when, random: seeded(9) })

  it('keeps the result, the start, the quality, the luck and the five scores', () => {
    const stored = toStored(points)
    expect(stored.bp).toBe(points.bp)
    expect(stored.bpBase).toBe(points.base)
    expect(stored.bpFactors).toHaveLength(5)
    expect(stored.bpRange).toEqual([50, 750])
    expect(stored.bpLegacy).toBeUndefined()
    expect(factorsOf(stored)).toEqual({
      confidence: 0.8,
      clarity: 0.8,
      season: expect.any(Number),
      timeOfDay: expect.any(Number),
      way: 1,
    })
    expect(toStored(points, true).bpLegacy).toBe(true)
  })

  it('recalculates the same BP from the stored quality and luck against the same range', () => {
    const stored = toStored(points)
    const again = recalculateStored(stored, [50, 750])
    // The quality and the luck are stored with four decimals, so the result can differ by a point from the unrounded one.
    expect(Math.abs(again.bp - stored.bp)).toBeLessThanOrEqual(1)
  })

  it('follows a changed range, keeping the luck', () => {
    const stored = toStored(points)
    const higher = recalculateStored(stored, [100, 1500])
    expect(higher.bp).toBeGreaterThan(stored.bp)
    expect(higher.bp).toBeGreaterThanOrEqual(100)
    expect(higher.bp).toBeLessThanOrEqual(1500)
  })

  it('gives no scores for a catch that has none or has broken ones', () => {
    expect(factorsOf({})).toBeUndefined()
    expect(factorsOf({ bpFactors: [1, 2] })).toBeUndefined()
    expect(factorsOf({ bpFactors: [1, 1, 1, 1, Number.NaN] })).toBeUndefined()
  })
})
