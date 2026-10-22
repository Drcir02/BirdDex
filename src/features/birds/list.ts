// The list of caught birds ("Ptáci"): every catch is its own bird. The state of the list (sorting, search, one species) lives in
// the address, so the page of a bird can step to the next and the previous bird of the same list. Pure functions, no React.

import { displayName, normalizeForSearch } from '../../data/species'
import type { CatchRecord, Rarity, Species } from '../../domain/types'

export type BirdSort = 'bp' | 'newest' | 'name' | 'rarity'
export const BIRD_SORTS: readonly BirdSort[] = ['bp', 'newest', 'name', 'rarity']

export interface BirdsQuery {
  sort: BirdSort
  /** The search text as typed. */
  q: string
  /** Only the birds of this species (its id), or undefined for all. */
  species?: string
}

export const DEFAULT_BIRDS_QUERY: BirdsQuery = { sort: 'bp', q: '' }

/** A caught bird with its species. */
export interface BirdEntry {
  record: CatchRecord
  species: Species
}

const RARITY_RANK: Record<Rarity, number> = { common: 0, uncommon: 1, rare: 2, epic: 3, legendary: 4 }

export function parseBirdsQuery(params: URLSearchParams): BirdsQuery {
  const sort = params.get('sort')
  const species = params.get('species')
  return {
    sort: BIRD_SORTS.includes(sort as BirdSort) ? (sort as BirdSort) : DEFAULT_BIRDS_QUERY.sort,
    q: params.get('q') ?? '',
    ...(species ? { species } : {}),
  }
}

/** Only what differs from the default goes into the address. */
export function birdsQueryToParams(query: BirdsQuery): URLSearchParams {
  const params = new URLSearchParams()
  if (query.sort !== DEFAULT_BIRDS_QUERY.sort) params.set('sort', query.sort)
  if (query.q.trim() !== '') params.set('q', query.q)
  if (query.species) params.set('species', query.species)
  return params
}

export function birdsQueryToSearch(query: BirdsQuery): string {
  const text = birdsQueryToParams(query).toString()
  return text ? `?${text}` : ''
}

/** The catches that belong to a bird of the species list (a catch of a species the Dex does not know cannot be shown). */
export function buildBirdEntries(catches: readonly CatchRecord[], species: readonly Species[]): BirdEntry[] {
  const byId = new Map(species.map((bird) => [bird.id, bird] as const))
  const entries: BirdEntry[] = []
  for (const record of catches) {
    const bird = byId.get(record.speciesId)
    if (bird) entries.push({ record, species: bird })
  }
  return entries
}

const byBp = (a: BirdEntry, b: BirdEntry): number => (b.record.bp ?? -1) - (a.record.bp ?? -1)
const byNewest = (a: BirdEntry, b: BirdEntry): number => b.record.caughtAt - a.record.caughtAt
const byId = (a: BirdEntry, b: BirdEntry): number => (a.record.id < b.record.id ? -1 : a.record.id > b.record.id ? 1 : 0)

const COMPARERS: Record<BirdSort, (a: BirdEntry, b: BirdEntry) => number> = {
  bp: (a, b) => byBp(a, b) || byNewest(a, b) || byId(a, b),
  newest: (a, b) => byNewest(a, b) || byBp(a, b) || byId(a, b),
  name: (a, b) => displayName(a.species).localeCompare(displayName(b.species), 'cs') || byBp(a, b) || byNewest(a, b) || byId(a, b),
  rarity: (a, b) => RARITY_RANK[b.species.rarity] - RARITY_RANK[a.species.rarity] || byBp(a, b) || byNewest(a, b) || byId(a, b),
}

function matches(entry: BirdEntry, needle: string): boolean {
  if (needle === '') return true
  const { species } = entry
  return [species.czechName, species.scientificName, species.englishName].some((text) => text !== null && normalizeForSearch(text).includes(needle))
}

/** The birds the list shows: one species or all, matching the search, in the chosen order. */
export function selectBirds(entries: readonly BirdEntry[], query: BirdsQuery): BirdEntry[] {
  const needle = normalizeForSearch(query.q)
  return entries.filter((entry) => (!query.species || entry.species.id === query.species) && matches(entry, needle)).sort(COMPARERS[query.sort])
}

/** The address of one bird's page, carrying the state of the list. */
export function birdHref(catchId: string, query: BirdsQuery): string {
  return `/birds/${encodeURIComponent(catchId)}${birdsQueryToSearch(query)}`
}

/** The neighbours of a bird in the list, and its place. */
export function neighboursInList(list: readonly BirdEntry[], catchId: string): { previous?: BirdEntry; next?: BirdEntry; position: number; total: number } {
  const index = list.findIndex((entry) => entry.record.id === catchId)
  if (index < 0) return { position: 0, total: list.length }
  return { previous: list[index - 1], next: list[index + 1], position: index + 1, total: list.length }
}
