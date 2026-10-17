import { describe, expect, it } from 'vitest'
import type { CatchMethod, CatchRecord, Rarity, Species } from '../../src/domain/types'
import { computeTrainerStats, dayNumber, dayStreak } from '../../src/features/settings/stats'

function bird(id: string, rarity: Rarity, inCzechia: boolean, inEurope = true): Species {
  return {
    id,
    dexNumber: 1,
    scientificName: id,
    czechName: id,
    englishName: id,
    family: null,
    inCzechia,
    inEurope,
    rarity,
    birdnetIndex: 0,
    wingclipIndex: null,
    wikiTitle: null,
  }
}

// Local noon of a day, so that the time zone of the machine never moves it to another date.
const day = (year: number, month: number, date: number, hour = 12) => new Date(year, month - 1, date, hour).getTime()

let counter = 0
function caught(speciesId: string, caughtAt: number, method: CatchMethod = 'photo'): CatchRecord {
  counter += 1
  return { id: `c${counter}`, speciesId, caughtAt, method, confidence: 0.9 }
}

const SPECIES = [
  bird('a', 'common', true),
  bird('b', 'common', true),
  bird('c', 'rare', true),
  bird('d', 'legendary', false),
  bird('e', 'epic', false),
]

describe('dayNumber', () => {
  it('is the same for any time of one calendar day and one more for the next day', () => {
    expect(dayNumber(day(2026, 10, 17, 0))).toBe(dayNumber(day(2026, 10, 17, 23)))
    expect(dayNumber(day(2026, 10, 18))).toBe(dayNumber(day(2026, 10, 17)) + 1)
  })

  it('counts consecutive days across a change of the clock', () => {
    expect(dayNumber(day(2026, 3, 29))).toBe(dayNumber(day(2026, 3, 28)) + 1)
    expect(dayNumber(day(2026, 10, 26))).toBe(dayNumber(day(2026, 10, 25)) + 1)
  })
})

describe('dayStreak', () => {
  const now = day(2026, 10, 17, 18)

  it('is zero without catches', () => {
    expect(dayStreak([], now)).toEqual({ current: 0, best: 0 })
  })

  it('counts several catches on one day as one day', () => {
    expect(dayStreak([day(2026, 10, 17, 8), day(2026, 10, 17, 9), day(2026, 10, 17, 20)], now)).toEqual({ current: 1, best: 1 })
  })

  it('counts consecutive days up to today', () => {
    expect(dayStreak([day(2026, 10, 15), day(2026, 10, 16), day(2026, 10, 17)], now)).toEqual({ current: 3, best: 3 })
  })

  it('keeps the streak alive until the end of the next day, because today may still come', () => {
    expect(dayStreak([day(2026, 10, 15), day(2026, 10, 16)], now)).toEqual({ current: 2, best: 2 })
  })

  it('breaks the streak after a missed day, and remembers the best one', () => {
    const stamps = [day(2026, 10, 1), day(2026, 10, 2), day(2026, 10, 3), day(2026, 10, 4), day(2026, 10, 16), day(2026, 10, 17)]
    expect(dayStreak(stamps, now)).toEqual({ current: 2, best: 4 })
    expect(dayStreak([day(2026, 10, 1), day(2026, 10, 2), day(2026, 10, 14)], now)).toEqual({ current: 0, best: 2 })
  })

  it('does not depend on the order of the catches', () => {
    expect(dayStreak([day(2026, 10, 17), day(2026, 10, 15), day(2026, 10, 16)], now).current).toBe(3)
  })

  it('ignores broken timestamps', () => {
    expect(dayStreak([Number.NaN, day(2026, 10, 17)], now)).toEqual({ current: 1, best: 1 })
  })
})

describe('computeTrainerStats', () => {
  const now = day(2026, 10, 17, 18)

  it('is all zeros for a collection without catches', () => {
    const stats = computeTrainerStats([], SPECIES, now)
    expect(stats.totalCatches).toBe(0)
    expect(stats.speciesCaught).toBe(0)
    expect(stats.czechia).toEqual({ caught: 0, total: 3, fraction: 0 })
    expect(stats.europe).toEqual({ caught: 0, total: 5, fraction: 0 })
    expect(stats.rarest).toBeUndefined()
    expect(stats.firstCatchAt).toBeUndefined()
    expect(stats.streak).toEqual({ current: 0, best: 0 })
    expect(stats.perMethod).toEqual({ sound: 0, photo: 0, live: 0 })
  })

  it('counts catches and species separately (a bird caught twice is one species)', () => {
    const stats = computeTrainerStats([caught('a', day(2026, 10, 1)), caught('a', day(2026, 10, 2)), caught('b', day(2026, 10, 3))], SPECIES, now)
    expect(stats.totalCatches).toBe(3)
    expect(stats.speciesCaught).toBe(2)
  })

  it('works out the Czechia and Europe percentages from the species of those regions', () => {
    const stats = computeTrainerStats([caught('a', day(2026, 10, 1)), caught('d', day(2026, 10, 2))], SPECIES, now)
    expect(stats.czechia.caught).toBe(1)
    expect(stats.czechia.fraction).toBeCloseTo(1 / 3)
    expect(stats.europe.caught).toBe(2)
    expect(stats.europe.fraction).toBeCloseTo(2 / 5)
  })

  it('does not count a bird that is not in the species list as a Dex bird, but still counts the catch', () => {
    const stats = computeTrainerStats([caught('unknown-bird', day(2026, 10, 1))], SPECIES, now)
    expect(stats.totalCatches).toBe(1)
    expect(stats.czechia.caught).toBe(0)
    expect(stats.europe.caught).toBe(0)
    expect(stats.rarest).toBeUndefined()
  })

  it('finds the rarest catch, and of equal rarity the one caught first', () => {
    const first = computeTrainerStats([caught('a', day(2026, 10, 1)), caught('c', day(2026, 10, 2)), caught('e', day(2026, 10, 3))], SPECIES, now)
    expect(first.rarest).toMatchObject({ speciesId: 'e', rarity: 'epic' })
    const tie = computeTrainerStats([caught('b', day(2026, 10, 5)), caught('a', day(2026, 10, 2))], SPECIES, now)
    expect(tie.rarest).toMatchObject({ speciesId: 'a', rarity: 'common' })
    const legendary = computeTrainerStats([caught('d', day(2026, 10, 9)), caught('e', day(2026, 10, 3))], SPECIES, now)
    expect(legendary.rarest).toMatchObject({ speciesId: 'd', rarity: 'legendary' })
  })

  it('knows the first catch whatever the order of the list', () => {
    const stats = computeTrainerStats([caught('a', day(2026, 10, 9)), caught('b', day(2026, 9, 21)), caught('c', day(2026, 10, 2))], SPECIES, now)
    expect(stats.firstCatchAt).toBe(day(2026, 9, 21))
  })

  it('counts the catches of each method', () => {
    const stats = computeTrainerStats(
      [caught('a', 1, 'sound'), caught('a', 2, 'sound'), caught('b', 3, 'photo'), caught('c', 4, 'live'), caught('c', 5, 'live'), caught('c', 6, 'live')],
      SPECIES,
      now,
    )
    expect(stats.perMethod).toEqual({ sound: 2, photo: 1, live: 3 })
  })

  it('has a streak from the catches', () => {
    const stats = computeTrainerStats([caught('a', day(2026, 10, 16)), caught('b', day(2026, 10, 17))], SPECIES, now)
    expect(stats.streak).toEqual({ current: 2, best: 2 })
  })

  it('gives a zero fraction for a region that has no species (no division by zero)', () => {
    const stats = computeTrainerStats([caught('x', 1)], [], now)
    expect(stats.czechia).toEqual({ caught: 0, total: 0, fraction: 0 })
  })
})
