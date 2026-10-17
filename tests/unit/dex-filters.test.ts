import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { displayName, parseSpecies } from '../../src/data/species'
import type { Species } from '../../src/domain/types'
import {
  DEFAULT_QUERY,
  dexQueryToParams,
  dexQueryToSearch,
  hasActiveFilters,
  neighboursOf,
  parseDexQuery,
  progressStage,
  regionProgress,
  selectSpecies,
  speciesHref,
  type DexQuery,
} from '../../src/features/dex/filters'

const real = parseSpecies(JSON.parse(readFileSync('public/data/species.json', 'utf8')) as unknown)

function make(id: string, patch: Partial<Species> = {}): Species {
  return {
    id,
    dexNumber: 1,
    scientificName: id.replace('-', ' ').replace(/^./, (c) => c.toUpperCase()),
    czechName: null,
    englishName: id,
    family: 'Paridae',
    inCzechia: true,
    inEurope: true,
    rarity: 'common',
    birdnetIndex: 1,
    wingclipIndex: 1,
    wikiTitle: null,
    ...patch,
  }
}

const query = (patch: Partial<DexQuery> = {}): DexQuery => ({ ...DEFAULT_QUERY, ...patch })
const none = () => false

describe('the Dex address', () => {
  it('reads the state from the query, with Czechia, all birds and the Dex order as defaults', () => {
    expect(parseDexQuery(new URLSearchParams(''))).toEqual({ region: 'czechia', status: 'all', sort: 'number', q: '' })
    expect(parseDexQuery(new URLSearchParams('region=europe&status=missing&sort=rarity&q=sykora'))).toEqual({
      region: 'europe',
      status: 'missing',
      sort: 'rarity',
      q: 'sykora',
    })
  })

  it('falls back to the defaults for anything unknown, so a hand-made address cannot break the screen', () => {
    expect(parseDexQuery(new URLSearchParams('region=mars&status=all&sort=family&q='))).toEqual(DEFAULT_QUERY)
    expect(parseDexQuery(new URLSearchParams('region=&status=%00&sort=NUMBER')).sort).toBe('number')
  })

  it('cuts a very long search', () => {
    expect(parseDexQuery(new URLSearchParams(`q=${'a'.repeat(500)}`)).q).toHaveLength(60)
  })

  it('writes only what differs from the default', () => {
    expect(dexQueryToSearch(DEFAULT_QUERY)).toBe('')
    expect(dexQueryToSearch(query({ region: 'europe' }))).toBe('?region=europe')
    expect(dexQueryToSearch(query({ status: 'caught', sort: 'name', q: 'sýkora koňadra' }))).toBe('?status=caught&sort=name&q=s%C3%BDkora+ko%C5%88adra')
  })

  it('trims the search in the address but not what the person typed', () => {
    expect(dexQueryToParams(query({ q: '  sykora ' })).get('q')).toBe('sykora')
    expect(dexQueryToParams(query({ q: '   ' })).has('q')).toBe(false)
  })

  it('round-trips every state', () => {
    for (const region of ['czechia', 'europe'] as const) {
      for (const status of ['all', 'caught', 'missing'] as const) {
        for (const sort of ['number', 'name', 'rarity'] as const) {
          const state = query({ region, status, sort, q: 'čáp bílý' })
          expect(parseDexQuery(dexQueryToParams(state))).toEqual(state)
        }
      }
    }
  })

  it('knows whether a filter or a search is active (the region and the sort are not filters)', () => {
    expect(hasActiveFilters(DEFAULT_QUERY)).toBe(false)
    expect(hasActiveFilters(query({ region: 'europe', sort: 'name' }))).toBe(false)
    expect(hasActiveFilters(query({ status: 'caught' }))).toBe(true)
    expect(hasActiveFilters(query({ q: 'sykora' }))).toBe(true)
    expect(hasActiveFilters(query({ q: '  ' }))).toBe(false)
  })

  it('builds the address of a bird that carries the list state', () => {
    expect(speciesHref('parus-major', DEFAULT_QUERY)).toBe('/species/parus-major')
    expect(speciesHref('parus-major', query({ region: 'europe', status: 'caught' }))).toBe('/species/parus-major?region=europe&status=caught')
  })
})

describe('selectSpecies on the real Dex', () => {
  it('shows the 276 Czech birds by default and all 423 for Europe, in Dex order', () => {
    const czechia = selectSpecies(real, DEFAULT_QUERY, none)
    const europe = selectSpecies(real, query({ region: 'europe' }), none)
    expect(czechia).toHaveLength(276)
    expect(europe).toHaveLength(423)
    expect(czechia.every((species) => species.inCzechia)).toBe(true)
    expect(europe.map((species) => species.dexNumber)).toEqual([...europe.map((species) => species.dexNumber)].sort((a, b) => a - b))
  })

  it('splits the list into caught and missing, which together are the whole list', () => {
    const caughtIds = new Set(['parus-major', 'turdus-merula', 'bubo-bubo', 'alca-torda'])
    const isCaught = (id: string) => caughtIds.has(id)
    const caught = selectSpecies(real, query({ status: 'caught' }), isCaught)
    const missing = selectSpecies(real, query({ status: 'missing' }), isCaught)
    // Alca torda lives in Europe but not in Czechia, so it is not in the Czech list.
    expect(caught.map((species) => species.id).sort()).toEqual(['bubo-bubo', 'parus-major', 'turdus-merula'])
    expect(caught.length + missing.length).toBe(276)
    expect(selectSpecies(real, query({ status: 'caught', region: 'europe' }), isCaught)).toHaveLength(4)
  })

  it('finds birds by Czech, scientific and English name, ignoring accents and case', () => {
    const ids = (text: string) => selectSpecies(real, query({ region: 'europe', q: text }), none).map((species) => species.id)
    expect(ids('sykora konadra')).toContain('parus-major')
    expect(ids('SÝKORA KOŇADRA')[0]).toBe('parus-major')
    expect(ids('parus major')).toContain('parus-major')
    expect(ids('great tit')).toContain('parus-major')
    expect(ids('kos cerny')).toContain('turdus-merula')
    expect(ids('zzzzqx')).toEqual([])
  })

  it('searches inside the chosen region and status only', () => {
    const isCaught = (id: string) => id === 'parus-major'
    expect(selectSpecies(real, query({ q: 'sykora', status: 'caught' }), isCaught).map((species) => species.id)).toEqual(['parus-major'])
    expect(selectSpecies(real, query({ q: 'sykora', status: 'missing' }), isCaught).map((species) => species.id)).not.toContain('parus-major')
    // The Razorbill is a bird of Europe, not of Czechia.
    expect(selectSpecies(real, query({ q: 'alka' }), none).map((species) => species.id)).not.toContain('alca-torda')
    expect(selectSpecies(real, query({ q: 'alka', region: 'europe' }), none).map((species) => species.id)).toContain('alca-torda')
  })

  it('puts the best matches first while searching with the default order, and obeys another sort', () => {
    const byRelevance = selectSpecies(real, query({ q: 'sykora', region: 'europe' }), none)
    expect(displayName(byRelevance[0]).toLowerCase().startsWith('sýkora')).toBe(true)
    const byName = selectSpecies(real, query({ q: 'sykora', region: 'europe', sort: 'name' }), none).map(displayName)
    expect(byName).toEqual([...byName].sort((a, b) => a.localeCompare(b, 'cs')))
  })

  it('treats a search of only punctuation as no search', () => {
    expect(selectSpecies(real, query({ q: '  ?! ' }), none)).toHaveLength(276)
  })

  it('sorts by name in Czech alphabet order (Č after C, Ch after H) and by rarity from common to legendary', () => {
    const names = selectSpecies(real, query({ region: 'europe', sort: 'name' }), none).map(displayName)
    expect(names).toEqual([...names].sort((a, b) => new Intl.Collator('cs').compare(a, b)))
    const rarities = selectSpecies(real, query({ region: 'europe', sort: 'rarity' }), none).map((species) => species.rarity)
    const rank = { common: 0, uncommon: 1, rare: 2, epic: 3, legendary: 4 }
    expect(rarities.map((rarity) => rank[rarity])).toEqual([...rarities.map((rarity) => rank[rarity])].sort((a, b) => a - b))
    expect(rarities[0]).toBe('common')
    expect(rarities.at(-1)).toBe('legendary')
  })
})

describe('selectSpecies on small lists', () => {
  const list = [
    make('a-a', { dexNumber: 1, czechName: 'Čáp', rarity: 'rare' }),
    make('b-b', { dexNumber: 2, czechName: 'Cvrčilka', rarity: 'common', inCzechia: false }),
    make('c-c', { dexNumber: 3, czechName: 'Chocholouš', rarity: 'epic' }),
    make('d-d', { dexNumber: 4, czechName: 'Husa', rarity: 'common' }),
  ]

  it('orders by the Czech alphabet', () => {
    expect(selectSpecies(list, query({ region: 'europe', sort: 'name' }), none).map(displayName)).toEqual(['Cvrčilka', 'Čáp', 'Husa', 'Chocholouš'])
  })

  it('keeps a stable Dex order for equal rarities', () => {
    expect(selectSpecies(list, query({ region: 'europe', sort: 'rarity' }), none).map((species) => species.id)).toEqual(['b-b', 'd-d', 'a-a', 'c-c'])
  })

  it('works with an empty list', () => {
    expect(selectSpecies([], DEFAULT_QUERY, none)).toEqual([])
  })
})

describe('progress', () => {
  it('counts the caught birds of the region', () => {
    const isCaught = (id: string) => ['parus-major', 'alca-torda'].includes(id)
    expect(regionProgress(real, 'czechia', isCaught)).toMatchObject({ caught: 1, total: 276 })
    expect(regionProgress(real, 'europe', isCaught)).toMatchObject({ caught: 2, total: 423 })
    expect(regionProgress(real, 'czechia', isCaught).fraction).toBeCloseTo(1 / 276, 6)
  })

  it('gives zero for an empty region instead of dividing by zero', () => {
    expect(regionProgress([], 'czechia', none)).toEqual({ caught: 0, total: 0, fraction: 0 })
  })

  it.each([
    [0, 276, 'none'],
    [1, 276, 'start'],
    [27, 276, 'start'],
    [28, 276, 'growing'],
    [110, 276, 'growing'],
    [111, 276, 'half'],
    [206, 276, 'half'],
    [207, 276, 'almost'],
    [275, 276, 'almost'],
    [276, 276, 'complete'],
    [0, 0, 'none'],
  ])('says "%i of %i" is stage %s', (caught, total, stage) => {
    expect(progressStage({ caught, total })).toBe(stage)
  })
})

describe('neighboursOf', () => {
  const list = [make('a'), make('b'), make('c')]

  it('gives the bird before and after, and the position', () => {
    expect(neighboursOf(list, 'b')).toMatchObject({ previous: { id: 'a' }, next: { id: 'c' }, position: 2, total: 3 })
  })

  it('has nothing before the first or after the last', () => {
    expect(neighboursOf(list, 'a').previous).toBeUndefined()
    expect(neighboursOf(list, 'c').next).toBeUndefined()
  })

  it('has no neighbours for a bird that is not in the list', () => {
    expect(neighboursOf(list, 'x')).toEqual({ previous: undefined, next: undefined, position: 0, total: 3 })
  })
})
