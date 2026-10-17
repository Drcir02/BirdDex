import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Species } from '../../src/domain/types'
import {
  RARITIES,
  SpeciesLoadError,
  birdnetIndices,
  wingclipIndices,
  SPECIES_CACHE_NAME,
  compareCzech,
  displayName,
  fetchSpeciesList,
  filterByRarity,
  filterByRegion,
  formatDexNumber,
  getLoadedSpecies,
  getSpeciesById,
  groupByFamily,
  loadSpecies,
  matchScore,
  normalizeForSearch,
  parseSpecies,
  regionCounts,
  resetSpeciesCache,
  searchSpecies,
  secondaryName,
  sortSpecies,
  speciesByBirdnetIndex,
  speciesByWingclipIndex,
} from '../../src/data/species'

function bird(fields: Partial<Species> & Pick<Species, 'id' | 'dexNumber'>): Species {
  return {
    scientificName: fields.id.replace('-', ' '),
    czechName: null,
    englishName: 'Bird',
    family: null,
    inCzechia: false,
    inEurope: true,
    rarity: 'common',
    birdnetIndex: fields.dexNumber,
    wingclipIndex: null,
    wikiTitle: null,
    ...fields,
  }
}

const GREAT_TIT = bird({
  id: 'parus-major', dexNumber: 30, scientificName: 'Parus major', czechName: 'Sýkora koňadra', englishName: 'Great Tit',
  family: 'Paridae', inCzechia: true, rarity: 'common', birdnetIndex: 4237, wingclipIndex: 7082, wikiTitle: 'Great tit',
})
const BLACK_STORK = bird({
  id: 'ciconia-nigra', dexNumber: 10, scientificName: 'Ciconia nigra', czechName: 'Čáp černý', englishName: 'Black Stork',
  family: 'Ciconiidae', inCzechia: true, rarity: 'rare', birdnetIndex: 1300, wingclipIndex: 2450,
})
const SAND_CRANE = bird({
  id: 'curruca-melanocephala', dexNumber: 20, scientificName: 'Curruca melanocephala', czechName: 'Pěnice bělohrdlá',
  englishName: 'Sardinian Warbler', family: 'Sylviidae', rarity: 'epic', birdnetIndex: 1800, wingclipIndex: 7938,
})
const GULL = bird({
  id: 'chroicocephalus-ridibundus', dexNumber: 15, scientificName: 'Chroicocephalus ridibundus', czechName: 'Racek chechtavý',
  englishName: 'Black-headed Gull', family: 'Laridae', inCzechia: true, rarity: 'common', birdnetIndex: 1400, wingclipIndex: 2158,
})
const CHRASTAL = bird({
  id: 'crex-crex', dexNumber: 5, scientificName: 'Crex crex', czechName: 'Chřástal polní', englishName: 'Corn Crake',
  family: 'Rallidae', inCzechia: true, rarity: 'rare', birdnetIndex: 1500, wingclipIndex: 1728,
})
const CVRCILKA = bird({
  id: 'locustella-naevia', dexNumber: 40, scientificName: 'Locustella naevia', czechName: 'Cvrčilka zelená',
  englishName: 'Common Grasshopper-Warbler', family: 'Locustellidae', inCzechia: true, rarity: 'uncommon', birdnetIndex: 3000,
})
const HRDLICKA = bird({
  id: 'streptopelia-decaocto', dexNumber: 8, scientificName: 'Streptopelia decaocto', czechName: 'Hrdlička zahradní',
  englishName: 'Eurasian Collared-Dove', family: 'Columbidae', inCzechia: true, rarity: 'common', birdnetIndex: 5000, wingclipIndex: 591,
})
const NO_CZECH_NAME = bird({
  id: 'zosterops-test', dexNumber: 50, scientificName: 'Zosterops test', czechName: null, englishName: 'Test White-eye',
  family: null, rarity: 'legendary', birdnetIndex: 6000,
})
const LIST: readonly Species[] = [GREAT_TIT, BLACK_STORK, SAND_CRANE, GULL, CHRASTAL, CVRCILKA, HRDLICKA, NO_CZECH_NAME]

afterEach(() => {
  resetSpeciesCache()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('normalizeForSearch', () => {
  it('drops accents, case and punctuation', () => {
    expect(normalizeForSearch('Sýkora koňadra')).toBe('sykora konadra')
    expect(normalizeForSearch('ČÁP  ČERNÝ')).toBe('cap cerny')
    expect(normalizeForSearch('Black-headed Gull')).toBe('black headed gull')
    expect(normalizeForSearch("Krüper's Nuthatch")).toBe('kruper s nuthatch')
    expect(normalizeForSearch('Řasnatka')).toBe('rasnatka')
  })

  it('treats grey as gray, like BirdNET does, but leaves other words alone', () => {
    expect(normalizeForSearch('Grey Heron')).toBe('gray heron')
    expect(normalizeForSearch('Gray-headed Woodpecker')).toBe('gray headed woodpecker')
    expect(normalizeForSearch('Greylag Goose')).toBe('greylag goose')
    expect(searchSpecies([bird({ id: 'ardea-cinerea', dexNumber: 1, englishName: 'Gray Heron', czechName: 'Volavka popelavá' })], 'grey heron')).toHaveLength(1)
  })

  it('handles letters that have no accent to strip', () => {
    expect(normalizeForSearch('Łyska ø æ ß')).toBe('lyska o ae ss')
  })
})

describe('searchSpecies', () => {
  const names = (query: string) => searchSpecies(LIST, query).map((species) => species.id)

  it('ignores accents in the query and in the names', () => {
    expect(names('sykora')).toEqual(['parus-major'])
    expect(names('SÝKORA')).toEqual(['parus-major'])
    expect(names('konadra')).toEqual(['parus-major'])
    expect(names('cap cerny')).toEqual(['ciconia-nigra'])
    expect(names('Čáp')).toEqual(['ciconia-nigra'])
    expect(names('chrastal')).toEqual(['crex-crex'])
  })

  it('finds by English and scientific name', () => {
    expect(names('great tit')).toEqual(['parus-major'])
    expect(names('black-headed')).toEqual(['chroicocephalus-ridibundus'])
    expect(names('blackheaded')).toEqual([])
    expect(names('curruca')).toEqual(['curruca-melanocephala'])
    expect(names('ZOSTEROPS')).toEqual(['zosterops-test'])
  })

  it('needs every word of the query, in any name', () => {
    expect(names('great major')).toEqual(['parus-major'])
    expect(names('great gull')).toEqual([])
    expect(names('zelena grasshopper')).toEqual(['locustella-naevia'])
  })

  it('puts names that start with the query before names that only contain it', () => {
    const list = [
      bird({ id: 'a', dexNumber: 1, czechName: 'Rákosník velký', scientificName: 'Zz a' }),
      bird({ id: 'b', dexNumber: 2, czechName: 'Sýkora velká', scientificName: 'Zz b' }),
      bird({ id: 'c', dexNumber: 3, czechName: 'Velkozobec', scientificName: 'Zz c' }),
    ]
    expect(searchSpecies(list, 'velk').map((species) => species.id)).toEqual(['c', 'a', 'b'])
    expect(searchSpecies(list, 'elk').map((species) => species.id)).toEqual(['a', 'b', 'c'])
  })

  it('returns nothing for an empty query and respects the limit', () => {
    expect(names('')).toEqual([])
    expect(names('   ')).toEqual([])
    expect(names('...')).toEqual([])
    expect(searchSpecies(LIST, 'a', { limit: 2 })).toHaveLength(2)
  })

  it('matchScore is 0 unless every word matches', () => {
    expect(matchScore(GREAT_TIT, 'sykora')).toBeGreaterThan(0)
    expect(matchScore(GREAT_TIT, 'sykora gull')).toBe(0)
    expect(matchScore(GREAT_TIT, '')).toBe(0)
  })

  it('works for a bird without a Czech name', () => {
    expect(names('test white')).toEqual(['zosterops-test'])
  })
})

describe('sorting', () => {
  it('sorts by Dex number without touching the input', () => {
    const copy = [...LIST]
    expect(sortSpecies(LIST, 'number').map((species) => species.dexNumber)).toEqual([5, 8, 10, 15, 20, 30, 40, 50])
    expect(LIST).toEqual(copy)
  })

  it('sorts by name in Czech alphabet order', () => {
    const order = sortSpecies(LIST, 'name').map(displayName)
    // c comes before č, and "ch" comes after h; a bird with no Czech name sorts by its scientific name.
    expect(order).toEqual([
      'Cvrčilka zelená', 'Čáp černý', 'Hrdlička zahradní', 'Chřástal polní', 'Pěnice bělohrdlá', 'Racek chechtavý', 'Sýkora koňadra', 'Zosterops test',
    ])
    expect(compareCzech('Cvrčilka', 'Čáp')).toBeLessThan(0)
    expect(compareCzech('Chřástal', 'Hrdlička')).toBeGreaterThan(0)
    expect(compareCzech('Chřástal', 'Ibis')).toBeLessThan(0)
  })

  it('sorts by family A to Z with birds that have no family last, then by Dex number', () => {
    const order = sortSpecies(LIST, 'family').map((species) => species.family)
    expect(order).toEqual(['Ciconiidae', 'Columbidae', 'Laridae', 'Locustellidae', 'Paridae', 'Rallidae', 'Sylviidae', null])
    const sameFamily = [bird({ id: 'x', dexNumber: 9, family: 'Paridae' }), bird({ id: 'y', dexNumber: 2, family: 'Paridae' })]
    expect(sortSpecies(sameFamily, 'family').map((species) => species.id)).toEqual(['y', 'x'])
  })

  it('sorts by rarity, common first, and can be reversed', () => {
    expect(sortSpecies(LIST, 'rarity').map((species) => species.rarity)).toEqual(['common', 'common', 'common', 'uncommon', 'rare', 'rare', 'epic', 'legendary'])
    expect(sortSpecies(LIST, 'rarity', { descending: true })[0].rarity).toBe('legendary')
  })

  it('groups by family in Dex order with the unknown family last', () => {
    const groups = groupByFamily(LIST)
    expect(groups.map((group) => group.family)).toEqual(['Rallidae', 'Columbidae', 'Ciconiidae', 'Laridae', 'Sylviidae', 'Paridae', 'Locustellidae', null])
    const mixed = [bird({ id: 'a', dexNumber: 3, family: 'Paridae' }), bird({ id: 'b', dexNumber: 1, family: 'Laridae' }), bird({ id: 'c', dexNumber: 2, family: 'Paridae' })]
    expect(groupByFamily(mixed).map((group) => group.species.map((species) => species.id))).toEqual([['b'], ['c', 'a']])
  })
})

describe('filters and lookups', () => {
  it('filters by region: Europe is everything, Czechia is the Czech birds', () => {
    expect(filterByRegion(LIST, 'europe')).toHaveLength(LIST.length)
    expect(filterByRegion(LIST, 'czechia').map((species) => species.id).sort()).toEqual(
      ['chroicocephalus-ridibundus', 'ciconia-nigra', 'crex-crex', 'locustella-naevia', 'parus-major', 'streptopelia-decaocto'],
    )
    expect(regionCounts(LIST)).toEqual({ czechia: 6, europe: 8 })
  })

  it('filters by rarity, one or several', () => {
    expect(filterByRarity(LIST, 'rare')).toHaveLength(2)
    expect(filterByRarity(LIST, ['epic', 'legendary']).map((species) => species.id)).toEqual(['curruca-melanocephala', 'zosterops-test'])
    expect(RARITIES).toEqual(['common', 'uncommon', 'rare', 'epic', 'legendary'])
  })

  it('finds a bird by id', () => {
    expect(getSpeciesById('parus-major', LIST)).toBe(GREAT_TIT)
    expect(getSpeciesById('nope', LIST)).toBeUndefined()
  })

  it('maps BirdNET positions and WingCLIP rows to birds, leaving out birds WingCLIP does not know', () => {
    expect(speciesByBirdnetIndex(LIST).get(4237)).toBe(GREAT_TIT)
    expect(speciesByBirdnetIndex(LIST).get(-1)).toBeUndefined()
    expect(speciesByBirdnetIndex(LIST).size).toBe(LIST.length)
    expect(speciesByWingclipIndex(LIST).get(7082)).toBe(GREAT_TIT)
    expect(speciesByWingclipIndex(LIST).size).toBe(LIST.length - 2)
    expect(speciesByWingclipIndex(LIST)).toBe(speciesByWingclipIndex(LIST))
  })

  it('lists the BirdNET positions and WingCLIP rows of a region', () => {
    expect(Array.from(birdnetIndices(LIST, 'europe'))).toEqual(LIST.map((species) => species.birdnetIndex))
    expect(Array.from(birdnetIndices(LIST, 'czechia'))).toEqual([4237, 1300, 1400, 1500, 3000, 5000])
    expect(Array.from(wingclipIndices(LIST, 'czechia'))).toEqual([7082, 2450, 2158, 1728, 591])
    expect(wingclipIndices(LIST)).toBeInstanceOf(Int32Array)
    expect(birdnetIndices().length).toBe(0)
  })

  it('answers from the loaded list when no list is given, and is empty before loading', () => {
    expect(getSpeciesById('parus-major')).toBeUndefined()
    expect(speciesByBirdnetIndex().size).toBe(0)
    resetSpeciesCache(LIST)
    expect(getLoadedSpecies()).toBe(LIST)
    expect(getSpeciesById('parus-major')).toBe(GREAT_TIT)
    expect(speciesByBirdnetIndex().get(1300)).toBe(BLACK_STORK)
  })

  it('names: Czech name, or the scientific name alone', () => {
    expect(displayName(GREAT_TIT)).toBe('Sýkora koňadra')
    expect(secondaryName(GREAT_TIT)).toBe('Parus major')
    expect(displayName(NO_CZECH_NAME)).toBe('Zosterops test')
    expect(secondaryName(NO_CZECH_NAME)).toBeNull()
    expect(formatDexNumber(7)).toBe('#007')
    expect(formatDexNumber(123)).toBe('#123')
    expect(formatDexNumber(1234)).toBe('#1234')
  })
})

describe('parseSpecies', () => {
  it('accepts a list and sorts it by Dex number', () => {
    expect(parseSpecies([GREAT_TIT, BLACK_STORK]).map((species) => species.id)).toEqual(['ciconia-nigra', 'parus-major'])
  })

  it('rejects anything that is not a list of birds', () => {
    for (const bad of [null, {}, [], 'x', [{}], [{ ...GREAT_TIT, rarity: 'mythic' }], [{ ...GREAT_TIT, birdnetIndex: '1' }], [{ ...GREAT_TIT, czechName: undefined }]]) {
      expect(() => parseSpecies(bad)).toThrow(SpeciesLoadError)
    }
  })
})

describe('loading', () => {
  const json = (value: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(value), { status: 200, ...init })

  function fakeCacheStorage() {
    const files = new Map<string, Response>()
    const storage = {
      files,
      open: vi.fn(async (name: string) => {
        expect(name).toBe(SPECIES_CACHE_NAME)
        return {
          match: async (url: string) => files.get(url)?.clone(),
          put: async (url: string, response: Response) => {
            files.set(url, response)
          },
        } as unknown as Cache
      }),
    }
    return storage
  }

  it('fetches, checks and sorts the file, and keeps a copy for offline use', async () => {
    const storage = fakeCacheStorage()
    const fetchImpl = vi.fn(async () => json([GREAT_TIT, BLACK_STORK]))
    const list = await fetchSpeciesList({ url: '/data/species.json', fetchImpl, cacheStorage: storage })
    expect(list.map((species) => species.id)).toEqual(['ciconia-nigra', 'parus-major'])
    expect(fetchImpl).toHaveBeenCalledWith('/data/species.json', { cache: 'no-cache' })
    expect(storage.files.has('/data/species.json')).toBe(true)
  })

  it('uses the offline copy when the network is down', async () => {
    const storage = fakeCacheStorage()
    await fetchSpeciesList({ url: '/d.json', fetchImpl: async () => json([GREAT_TIT]), cacheStorage: storage })
    const offline = await fetchSpeciesList({
      url: '/d.json',
      fetchImpl: async () => {
        throw new TypeError('Failed to fetch')
      },
      cacheStorage: storage,
    })
    expect(offline.map((species) => species.id)).toEqual(['parus-major'])
  })

  it('uses the offline copy when the server answers with a page that is not the data', async () => {
    const storage = fakeCacheStorage()
    storage.files.set('/d.json', json([BLACK_STORK]))
    const list = await fetchSpeciesList({ url: '/d.json', fetchImpl: async () => new Response('<html>404</html>', { status: 200 }), cacheStorage: storage })
    expect(list.map((species) => species.id)).toEqual(['ciconia-nigra'])
  })

  it('says why it failed when there is no copy', async () => {
    const down = fetchSpeciesList({ url: '/d.json', fetchImpl: async () => { throw new TypeError('offline') }, cacheStorage: null })
    await expect(down).rejects.toMatchObject({ name: 'SpeciesLoadError', reason: 'network' })
    const missing = fetchSpeciesList({ url: '/d.json', fetchImpl: async () => new Response('no', { status: 404 }), cacheStorage: null })
    await expect(missing).rejects.toMatchObject({ reason: 'http' })
    const html = fetchSpeciesList({ url: '/d.json', fetchImpl: async () => new Response('<html>', { status: 200 }), cacheStorage: null })
    await expect(html).rejects.toMatchObject({ reason: 'malformed' })
    const wrong = fetchSpeciesList({ url: '/d.json', fetchImpl: async () => json([{ id: 'x' }]), cacheStorage: null })
    await expect(wrong).rejects.toMatchObject({ reason: 'malformed' })
  })

  it('still works when the cache cannot be written', async () => {
    const storage = { open: async () => { throw new Error('quota') } }
    const list = await fetchSpeciesList({ url: '/d.json', fetchImpl: async () => json([GREAT_TIT]), cacheStorage: storage })
    expect(list).toHaveLength(1)
  })

  it('loadSpecies fetches once for many callers and remembers the answer', async () => {
    const fetchMock = vi.fn(async () => json([GREAT_TIT, BLACK_STORK]))
    vi.stubGlobal('fetch', fetchMock)
    const [first, second] = await Promise.all([loadSpecies(), loadSpecies()])
    expect(first).toBe(second)
    expect(await loadSpecies()).toBe(first)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(getLoadedSpecies()).toBe(first)
    expect(getSpeciesById('parus-major')).toBe(first.find((species) => species.id === 'parus-major'))
  })

  it('loadSpecies can be tried again after a failure', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError('offline'))
      .mockImplementation(async () => json([GREAT_TIT]))
    vi.stubGlobal('fetch', fetchMock)
    await expect(loadSpecies()).rejects.toBeInstanceOf(SpeciesLoadError)
    expect(getLoadedSpecies()).toBeUndefined()
    expect(await loadSpecies()).toHaveLength(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
