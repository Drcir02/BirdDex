import { describe, expect, it } from 'vitest'
import { isTranslationKey } from '../../src/i18n'
import { COUNTRIES_SHOWN, MONTH_KEYS, countriesText, monthLevels, nowLevel, seasonRuns, seasonText, shyLabel, tipText } from '../../src/features/dex/findingInfo'
import type { SpeciesInfo } from '../../src/domain/types'

// The words of the "when and where to find it" block, worked out from a bird's `info`.

const info = (patch: Partial<SpeciesInfo> = {}): SpeciesInfo => ({ months: '333333333333', place: 'water', shy: 2, day: 'day', tip: 'waterfowl', ...patch })

describe('the months of a bird', () => {
  it('reads twelve levels, and twelve zeros from a broken string', () => {
    expect(monthLevels('012330000321')).toEqual([0, 1, 2, 3, 3, 0, 0, 0, 0, 3, 2, 1])
    expect(monthLevels('')).toEqual(Array(12).fill(0))
    expect(monthLevels('9xx')).toEqual(Array(12).fill(0))
  })

  it('finds the stretches of the year, also across the turn of the year', () => {
    expect(seasonRuns(monthLevels('333333333333'))).toBeUndefined()
    expect(seasonRuns(monthLevels('332100000233'))).toEqual([{ from: 9, to: 2 }])
    expect(seasonRuns(monthLevels('000023333000'))).toEqual([{ from: 4, to: 8 }])
    expect(seasonRuns(monthLevels('000002000000'))).toEqual([{ from: 5, to: 5 }])
  })

  it('names two stretches for a bird that passes twice a year', () => {
    expect(seasonRuns(monthLevels('000230002300'))).toEqual([
      { from: 3, to: 4 },
      { from: 8, to: 9 },
    ])
  })

  it('counts the months of level 1 only when no month is surer', () => {
    expect(seasonRuns(monthLevels('001100000000'))).toEqual([{ from: 2, to: 3 }])
    expect(seasonRuns(monthLevels('001100000200'))).toEqual([{ from: 9, to: 9 }])
  })

  it('writes the season in Czech', () => {
    expect(seasonText('333333333333')).toBe('celý rok')
    expect(seasonText('332100000233')).toBe('od října do března')
    expect(seasonText('000023333000')).toBe('od května do září')
    expect(seasonText('000002000000')).toBe('v červnu')
    expect(seasonText('000230002300')).toBe('od dubna do května a od září do října')
    expect(seasonText('300000000003')).toBe('od prosince do ledna')
  })

  it('has a letter and both month forms for every month', () => {
    for (const key of MONTH_KEYS) {
      for (const group of ['monthLetter', 'monthFrom', 'monthIn']) expect(isTranslationKey(`dex.info.${group}.${key}`), `${group}.${key}`).toBe(true)
    }
    expect(MONTH_KEYS).toHaveLength(12)
  })

  it('tells if this month is the time to look', () => {
    const months = '332100000233'
    expect(nowLevel(months, new Date(2026, 0, 15))).toBe(2)
    expect(nowLevel(months, new Date(2026, 3, 15))).toBe(1)
    expect(nowLevel(months, new Date(2026, 6, 15))).toBe(0)
    expect(nowLevel(months, new Date(2026, 9, 31))).toBe(2)
  })
})

describe('shyness, countries and tips', () => {
  it('has a line for every level of shyness', () => {
    expect([1, 2, 3].map((level) => shyLabel(level as 1 | 2 | 3))).toEqual(['Nechá se zblízka', 'Opatrný, chce to ticho', 'Plachý nebo daleko, chce to zoom'])
  })

  it('names the countries in Czech, and says "and more" past the limit', () => {
    expect(countriesText(undefined)).toBe('')
    expect(countriesText([])).toBe('')
    expect(countriesText(['ES', 'PT', 'IT'])).toBe('Španělsko, Portugalsko, Itálie')
    const many = ['ES', 'PT', 'IT', 'GR', 'FR', 'TR', 'AL', 'HR']
    expect(many.length).toBeGreaterThan(COUNTRIES_SHOWN)
    expect(countriesText(many)).toBe('Španělsko, Portugalsko, Itálie, Řecko, Francie, Turecko a další')
  })

  it('shows an unknown country code as it is', () => {
    expect(countriesText(['ZZ'])).toBe('ZZ')
  })

  it('finds the text of a tip, and nothing for a tip the app does not know', () => {
    expect(tipText(info({ tip: 'owls' }))).toContain('soumraku')
    expect(tipText(info({ tip: 'no-such-group' }))).toBeUndefined()
  })
})
