import { describe, expect, it } from 'vitest'
import { DEFAULT_BIRDS_QUERY, birdHref, birdsQueryToParams, birdsQueryToSearch, buildBirdEntries, neighboursInList, parseBirdsQuery, selectBirds } from '../../src/features/birds/list'
import type { CatchRecord, Rarity, Species } from '../../src/domain/types'

// The list of caught birds: every catch is its own bird, sorted by BP, newest, name or rarity, searched, or limited to a species.

const bird = (id: string, czechName: string | null, rarity: Rarity = 'common', english = id): Species => ({
  id,
  dexNumber: 1,
  scientificName: id.replace('-', ' '),
  czechName,
  englishName: english,
  family: null,
  inCzechia: true,
  inEurope: true,
  rarity,
  birdnetIndex: 1,
  wingclipIndex: 1,
  wikiTitle: null,
})

const SPECIES = [bird('parus-major', 'Sýkora koňadra', 'common', 'Great Tit'), bird('turdus-merula', 'Kos černý', 'uncommon', 'Eurasian Blackbird'), bird('bubo-bubo', 'Výr velký', 'epic', 'Eagle-Owl')]

const record = (id: string, speciesId: string, bp: number | undefined, caughtAt: number): CatchRecord => ({ id, speciesId, caughtAt, method: 'sound', confidence: 0.9, ...(bp === undefined ? {} : { bp }) })

const CATCHES = [
  record('a', 'parus-major', 300, 1000),
  record('b', 'parus-major', 300, 3000),
  record('c', 'turdus-merula', 520, 2000),
  record('d', 'bubo-bubo', 1500, 500),
  record('e', 'parus-major', undefined, 4000),
  record('f', 'unknown-bird', 999, 5000),
]
const entries = buildBirdEntries(CATCHES, SPECIES)
const ids = (list: ReturnType<typeof selectBirds>) => list.map((entry) => entry.record.id)

describe('the entries', () => {
  it('leave out a catch of a bird the Dex does not know, and keep every other catch as its own bird', () => {
    expect(entries.map((entry) => entry.record.id)).toEqual(['a', 'b', 'c', 'd', 'e'])
  })
})

describe('sorting', () => {
  it('puts the strongest bird first, a tie by the newer one, and a bird without a BP last', () => {
    expect(ids(selectBirds(entries, { ...DEFAULT_BIRDS_QUERY, sort: 'bp' }))).toEqual(['d', 'c', 'b', 'a', 'e'])
  })

  it('puts the newest first', () => {
    expect(ids(selectBirds(entries, { ...DEFAULT_BIRDS_QUERY, sort: 'newest' }))).toEqual(['e', 'b', 'c', 'a', 'd'])
  })

  it('sorts by the Czech name, birds of one species by BP', () => {
    expect(ids(selectBirds(entries, { ...DEFAULT_BIRDS_QUERY, sort: 'name' }))).toEqual(['c', 'b', 'a', 'e', 'd'])
  })

  it('puts the rarest species first, then the stronger bird', () => {
    expect(ids(selectBirds(entries, { ...DEFAULT_BIRDS_QUERY, sort: 'rarity' }))).toEqual(['d', 'c', 'b', 'a', 'e'])
  })

  it('shows two birds of the same species with the same BP as two birds', () => {
    const twins = selectBirds(entries, { ...DEFAULT_BIRDS_QUERY, species: 'parus-major' })
    expect(twins.filter((entry) => entry.record.bp === 300)).toHaveLength(2)
  })
})

describe('searching and the species filter', () => {
  it('finds a bird by its Czech, Latin or English name, without caring for accents or capitals', () => {
    expect(ids(selectBirds(entries, { ...DEFAULT_BIRDS_QUERY, q: 'sykora' }))).toEqual(['b', 'a', 'e'])
    expect(ids(selectBirds(entries, { ...DEFAULT_BIRDS_QUERY, q: 'BUBO' }))).toEqual(['d'])
    expect(ids(selectBirds(entries, { ...DEFAULT_BIRDS_QUERY, q: 'blackbird' }))).toEqual(['c'])
    expect(selectBirds(entries, { ...DEFAULT_BIRDS_QUERY, q: 'zzz' })).toEqual([])
  })

  it('shows only the birds of one species', () => {
    expect(ids(selectBirds(entries, { ...DEFAULT_BIRDS_QUERY, species: 'turdus-merula' }))).toEqual(['c'])
    expect(selectBirds(entries, { ...DEFAULT_BIRDS_QUERY, species: 'nobody' })).toEqual([])
  })
})

describe('the state in the address', () => {
  it('writes only what differs from the default, and reads it back', () => {
    expect(birdsQueryToSearch(DEFAULT_BIRDS_QUERY)).toBe('')
    const query = { sort: 'name' as const, q: 'kos', species: 'turdus-merula' }
    expect(birdsQueryToSearch(query)).toBe('?sort=name&q=kos&species=turdus-merula')
    expect(parseBirdsQuery(birdsQueryToParams(query))).toEqual(query)
  })

  it('reads a wrong sort as the default', () => {
    expect(parseBirdsQuery(new URLSearchParams('sort=banana')).sort).toBe('bp')
    expect(parseBirdsQuery(new URLSearchParams('')).q).toBe('')
  })

  it('links a bird with the state of the list, and encodes odd ids', () => {
    expect(birdHref('abc', DEFAULT_BIRDS_QUERY)).toBe('/birds/abc')
    expect(birdHref('x:y', { sort: 'newest', q: '' })).toBe('/birds/x%3Ay?sort=newest')
  })
})

describe('neighbours', () => {
  const list = selectBirds(entries, DEFAULT_BIRDS_QUERY)
  it('names the previous and the next bird and the place in the list', () => {
    const middle = neighboursInList(list, 'c')
    expect(middle.previous?.record.id).toBe('d')
    expect(middle.next?.record.id).toBe('b')
    expect(middle.position).toBe(2)
    expect(middle.total).toBe(5)
  })
  it('has no previous bird at the start and no next at the end, and no place for a bird that is not in the list', () => {
    expect(neighboursInList(list, 'd').previous).toBeUndefined()
    expect(neighboursInList(list, 'e').next).toBeUndefined()
    expect(neighboursInList(list, 'zzz')).toEqual({ position: 0, total: 5 })
  })
})
