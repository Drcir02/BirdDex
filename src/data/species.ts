// The Dex data: loads public/data/species.json (built by scripts/build-species.py) and offers lookup, filter, search
// and sort helpers. Everything except loadSpecies() is a pure function of a species list, so screens and tests can pass
// any list; when the list is left out, the helpers use the one loadSpecies() has already fetched.

import type { Rarity, Species } from '../domain/types'

export type Region = 'czechia' | 'europe'
export type SortKey = 'number' | 'name' | 'family' | 'rarity'

/** From the easiest bird to the hardest. */
export const RARITIES: readonly Rarity[] = ['common', 'uncommon', 'rare', 'epic', 'legendary']

/** Where the data lives. BASE_URL ends with a slash, and is "/birddex/" on GitHub Pages. */
export const SPECIES_URL = `${import.meta.env.BASE_URL}data/species.json`

/** Cache Storage bucket that keeps a copy of the file, so the Dex still opens with no network. */
export const SPECIES_CACHE_NAME = 'birddex-data-v1'

export class SpeciesLoadError extends Error {
  readonly reason: 'network' | 'http' | 'malformed'
  constructor(reason: SpeciesLoadError['reason'], message: string) {
    super(message)
    this.name = 'SpeciesLoadError'
    this.reason = reason
  }
}

// ---------- Loading ----------

type CacheLike = Pick<CacheStorage, 'open'>

export interface LoadOptions {
  url?: string
  fetchImpl?: typeof fetch
  /** Where to keep the offline copy. Pass null to switch it off. The default is the browser's Cache Storage, if it has one. */
  cacheStorage?: CacheLike | null
}

const RARITY_SET: ReadonlySet<string> = new Set(RARITIES)

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isSpecies(value: unknown): value is Species {
  if (!isObject(value)) return false
  const { id, dexNumber, scientificName, czechName, englishName, family, inCzechia, inEurope, rarity, birdnetIndex, wingclipIndex, wikiTitle } = value
  return (
    typeof id === 'string' &&
    typeof dexNumber === 'number' &&
    typeof scientificName === 'string' &&
    (czechName === null || typeof czechName === 'string') &&
    typeof englishName === 'string' &&
    (family === null || typeof family === 'string') &&
    typeof inCzechia === 'boolean' &&
    typeof inEurope === 'boolean' &&
    typeof rarity === 'string' &&
    RARITY_SET.has(rarity) &&
    typeof birdnetIndex === 'number' &&
    (wingclipIndex === null || typeof wingclipIndex === 'number') &&
    (wikiTitle === null || typeof wikiTitle === 'string')
  )
}

/** Checks the shape of the parsed file and returns it sorted by Dex number. Throws SpeciesLoadError('malformed') otherwise. */
export function parseSpecies(json: unknown): Species[] {
  if (!Array.isArray(json) || json.length === 0) throw new SpeciesLoadError('malformed', 'species.json is not a list of birds')
  const list: Species[] = []
  for (const item of json as unknown[]) {
    if (!isSpecies(item)) throw new SpeciesLoadError('malformed', 'species.json has a bird with missing or wrong fields')
    list.push(item)
  }
  return list.sort((a, b) => a.dexNumber - b.dexNumber)
}

function defaultCacheStorage(): CacheLike | null {
  try {
    return typeof caches === 'undefined' ? null : caches
  } catch {
    return null
  }
}

async function readOfflineCopy(url: string, storage: CacheLike | null): Promise<unknown> {
  if (!storage) return undefined
  try {
    const hit = await (await storage.open(SPECIES_CACHE_NAME)).match(url)
    return hit ? ((await hit.json()) as unknown) : undefined
  } catch {
    return undefined
  }
}

async function writeOfflineCopy(url: string, response: Response, storage: CacheLike | null): Promise<void> {
  if (!storage) return
  try {
    await (await storage.open(SPECIES_CACHE_NAME)).put(url, response)
  } catch {
    // Storage full or blocked: the Dex still works, only the offline copy is missing.
  }
}

/**
 * Fetches and checks the species file once, without remembering it (loadSpecies adds the memory). The network is asked
 * first, with revalidation, so a new deploy shows up at once; when that fails the copy from the last good visit is used.
 */
export async function fetchSpeciesList(options: LoadOptions = {}): Promise<Species[]> {
  const url = options.url ?? SPECIES_URL
  const fetchImpl = options.fetchImpl ?? fetch
  const storage = options.cacheStorage === undefined ? defaultCacheStorage() : options.cacheStorage

  let failure: SpeciesLoadError
  try {
    const response = await fetchImpl(url, { cache: 'no-cache' })
    if (!response.ok) {
      failure = new SpeciesLoadError('http', `species.json answered ${response.status}`)
    } else {
      try {
        const forCache = response.clone()
        const list = parseSpecies((await response.json()) as unknown)
        await writeOfflineCopy(url, forCache, storage)
        return list
      } catch (error) {
        failure = error instanceof SpeciesLoadError ? error : new SpeciesLoadError('malformed', 'species.json could not be read')
      }
    }
  } catch {
    failure = new SpeciesLoadError('network', 'species.json could not be fetched')
  }

  const offline = await readOfflineCopy(url, storage)
  if (offline !== undefined) {
    try {
      return parseSpecies(offline)
    } catch {
      // A broken copy is no help: report the original problem.
    }
  }
  throw failure
}

let loadedList: readonly Species[] | undefined
let loading: Promise<readonly Species[]> | undefined

/** Loads the Dex data once. Later calls get the same list; a failed load can be tried again. */
export function loadSpecies(): Promise<readonly Species[]> {
  if (loadedList) return Promise.resolve(loadedList)
  loading ??= fetchSpeciesList().then(
    (list) => {
      loadedList = list
      return list
    },
    (error: unknown) => {
      loading = undefined
      throw error
    },
  )
  return loading
}

/** The list loadSpecies() has delivered, or undefined while it is still loading. */
export function getLoadedSpecies(): readonly Species[] | undefined {
  return loadedList
}

/** For tests: forget everything, or pretend the list has been loaded. */
export function resetSpeciesCache(list?: readonly Species[]): void {
  loadedList = list
  loading = list ? Promise.resolve(list) : undefined
}

// ---------- Lookup ----------

interface Indexes {
  byId: Map<string, Species>
  byBirdnet: Map<number, Species>
  byWingclip: Map<number, Species>
}

const indexCache = new WeakMap<readonly Species[], Indexes>()
const EMPTY: readonly Species[] = []

function indexesOf(list: readonly Species[]): Indexes {
  let indexes = indexCache.get(list)
  if (!indexes) {
    indexes = { byId: new Map(), byBirdnet: new Map(), byWingclip: new Map() }
    for (const species of list) {
      indexes.byId.set(species.id, species)
      indexes.byBirdnet.set(species.birdnetIndex, species)
      if (species.wingclipIndex !== null) indexes.byWingclip.set(species.wingclipIndex, species)
    }
    indexCache.set(list, indexes)
  }
  return indexes
}

/** One bird by its id ("parus-major"). Without a list it looks in the loaded one, so it answers undefined before loading. */
export function getSpeciesById(id: string, list: readonly Species[] = loadedList ?? EMPTY): Species | undefined {
  return indexesOf(list).byId.get(id)
}

/** Position in BirdNET's 6522 outputs to bird. Only the birds of the Dex are in it. */
export function speciesByBirdnetIndex(list: readonly Species[] = loadedList ?? EMPTY): ReadonlyMap<number, Species> {
  return indexesOf(list).byBirdnet
}

/** Row of the WingCLIP classifier to bird. Birds WingCLIP does not know are not in it. */
export function speciesByWingclipIndex(list: readonly Species[] = loadedList ?? EMPTY): ReadonlyMap<number, Species> {
  return indexesOf(list).byWingclip
}

/** The BirdNET output positions of the birds of a region, in Dex order: what the sound engine keeps from its 6522 scores. */
export function birdnetIndices(list: readonly Species[] = loadedList ?? EMPTY, region: Region = 'europe'): Int32Array {
  return Int32Array.from(list.filter((species) => inRegion(species, region)).map((species) => species.birdnetIndex))
}

/** The WingCLIP classifier rows of the birds of a region, in Dex order, leaving out birds WingCLIP does not know. */
export function wingclipIndices(list: readonly Species[] = loadedList ?? EMPTY, region: Region = 'europe'): Int32Array {
  const rows: number[] = []
  for (const species of list) if (inRegion(species, region) && species.wingclipIndex !== null) rows.push(species.wingclipIndex)
  return Int32Array.from(rows)
}

// ---------- Filters ----------

export function inRegion(species: Species, region: Region): boolean {
  return region === 'czechia' ? species.inCzechia : species.inEurope
}

/** "czechia" gives the Czech birds, "europe" every bird of the Dex (all Czech birds are European too). */
export function filterByRegion(list: readonly Species[], region: Region): Species[] {
  return list.filter((species) => inRegion(species, region))
}

export function filterByRarity(list: readonly Species[], rarity: Rarity | readonly Rarity[]): Species[] {
  const wanted: readonly Rarity[] = typeof rarity === 'string' ? [rarity] : rarity
  return list.filter((species) => wanted.includes(species.rarity))
}

export function regionCounts(list: readonly Species[]): Record<Region, number> {
  return { czechia: filterByRegion(list, 'czechia').length, europe: filterByRegion(list, 'europe').length }
}

// ---------- Names ----------

/** The name the Dex shows: the Czech one, or the scientific name when BirdNET has no Czech name. */
export function displayName(species: Species): string {
  return species.czechName ?? species.scientificName
}

/** The line under the name: the scientific name, or null when the scientific name already is the name. */
export function secondaryName(species: Species): string | null {
  return species.czechName === null ? null : species.scientificName
}

/** "#007" */
export function formatDexNumber(dexNumber: number): string {
  return `#${String(dexNumber).padStart(3, '0')}`
}

// ---------- Search ----------

const SPECIAL_LETTERS: Readonly<Record<string, string>> = { ß: 'ss', æ: 'ae', œ: 'oe', ø: 'o', đ: 'd', ł: 'l', ı: 'i' }

/**
 * Lower case, no accents, no punctuation: "Sýkora koňadra" and "Black-headed Gull" become "sykora konadra" and
 * "black headed gull". Both the text and the query go through it, so "sykora" finds "Sýkora" and the other way round.
 * British "grey" is written "gray" like in BirdNET's names ("Gray Heron").
 */
export function normalizeForSearch(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[ßæœøđłı]/g, (letter) => SPECIAL_LETTERS[letter] ?? letter)
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\bgrey\b/g, 'gray')
    .trim()
}

const searchNameCache = new WeakMap<Species, string[]>()

function searchNames(species: Species): string[] {
  let names = searchNameCache.get(species)
  if (!names) {
    names = [species.englishName, species.scientificName]
    if (species.czechName) names.unshift(species.czechName)
    names = names.map(normalizeForSearch)
    searchNameCache.set(species, names)
  }
  return names
}

/** How well one word fits one name: 3 name starts with it, 2 a word of the name starts with it, 1 it is inside a word, 0 no. */
function wordFit(name: string, word: string): number {
  if (name.startsWith(word)) return 3
  if (name.includes(` ${word}`)) return 2
  return name.includes(word) ? 1 : 0
}

function queryWords(query: string): string[] {
  return normalizeForSearch(query).split(' ').filter(Boolean)
}

function scoreWords(species: Species, words: readonly string[]): number {
  if (words.length === 0) return 0
  const names = searchNames(species)
  let total = 0
  for (const word of words) {
    const best = Math.max(...names.map((name) => wordFit(name, word)))
    if (best === 0) return 0
    total += best
  }
  return total
}

/** 0 when the bird does not match every word of the query, otherwise a higher number for a better match. */
export function matchScore(species: Species, query: string): number {
  return scoreWords(species, queryWords(query))
}

/**
 * Finds birds by Czech, English or scientific name, ignoring accents and case. Every word of the query must match.
 * Best matches first (names that start with the query before names that only contain it), then in Dex order.
 */
export function searchSpecies(list: readonly Species[], query: string, options: { limit?: number } = {}): Species[] {
  const words = queryWords(query)
  const scored: { species: Species; score: number }[] = []
  for (const species of list) {
    const score = scoreWords(species, words)
    if (score > 0) scored.push({ species, score })
  }
  scored.sort((a, b) => b.score - a.score || a.species.dexNumber - b.species.dexNumber)
  const found = scored.map((entry) => entry.species)
  return options.limit === undefined ? found : found.slice(0, options.limit)
}

// ---------- Sorting ----------

/** Czech alphabet order: č after c, ř after r, "ch" after h, and so on. */
export const czechCollator = new Intl.Collator('cs', { sensitivity: 'variant', numeric: true })

export function compareCzech(a: string, b: string): number {
  return czechCollator.compare(a, b)
}

const RARITY_RANK: Readonly<Record<Rarity, number>> = { common: 0, uncommon: 1, rare: 2, epic: 3, legendary: 4 }

export function rarityRank(rarity: Rarity): number {
  return RARITY_RANK[rarity]
}

function byNumber(a: Species, b: Species): number {
  return a.dexNumber - b.dexNumber
}

/**
 * A sorted copy of the list. "number" is the Dex order (taxonomic), "name" the Czech alphabet by the shown name,
 * "family" the families A to Z (birds without a family last) and then Dex order, "rarity" common first.
 */
export function sortSpecies(list: readonly Species[], key: SortKey, options: { descending?: boolean } = {}): Species[] {
  const compare = ((): ((a: Species, b: Species) => number) => {
    switch (key) {
      case 'number':
        return byNumber
      case 'name':
        return (a, b) => compareCzech(displayName(a), displayName(b)) || byNumber(a, b)
      case 'family':
        return (a, b) => {
          if (a.family === b.family) return byNumber(a, b)
          if (a.family === null) return 1
          if (b.family === null) return -1
          return compareCzech(a.family, b.family) || byNumber(a, b)
        }
      case 'rarity':
        return (a, b) => rarityRank(a.rarity) - rarityRank(b.rarity) || byNumber(a, b)
    }
  })()
  const sorted = [...list].sort(compare)
  return options.descending ? sorted.reverse() : sorted
}

export interface FamilyGroup {
  /** Null for birds without a family. */
  family: string | null
  species: Species[]
}

/** Birds grouped by family, the groups in Dex order (the order the families first appear), birds without a family last. */
export function groupByFamily(list: readonly Species[]): FamilyGroup[] {
  const groups = new Map<string | null, Species[]>()
  for (const species of [...list].sort(byNumber)) {
    const group = groups.get(species.family)
    if (group) group.push(species)
    else groups.set(species.family, [species])
  }
  const result = [...groups].map(([family, members]) => ({ family, species: members }))
  return [...result.filter((group) => group.family !== null), ...result.filter((group) => group.family === null)]
}
