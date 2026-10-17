// The state of the Dex list (region, status, sort, search) and how it turns into a list of birds. Pure functions, so the
// screen only has to call them and tests can check every rule. The state lives in the address (`/#/?region=europe&q=sykora`),
// so the back button of the phone brings the list back exactly as it was left.

import { filterByRegion, normalizeForSearch, searchSpecies, sortSpecies, type Region } from '../../data/species'
import type { Species } from '../../domain/types'

export type StatusFilter = 'all' | 'caught' | 'missing'
export type DexSort = 'number' | 'name' | 'rarity'

export interface DexQuery {
  region: Region
  status: StatusFilter
  sort: DexSort
  /** What was typed in the search box (it is trimmed when it goes into the address). */
  q: string
}

export const REGIONS: readonly Region[] = ['czechia', 'europe']
export const STATUSES: readonly StatusFilter[] = ['all', 'caught', 'missing']
export const SORTS: readonly DexSort[] = ['number', 'name', 'rarity']

/** The person lives in Czechia, so the Czech birds come first. */
export const DEFAULT_QUERY: DexQuery = { region: 'czechia', status: 'all', sort: 'number', q: '' }

export const MAX_SEARCH_LENGTH = 60

function pick<T extends string>(value: string | null, allowed: readonly T[], fallback: T): T {
  return allowed.find((option) => option === value) ?? fallback
}

/** Reads the state from the address. Anything unknown or damaged falls back to the default, so a hand-edited address cannot break the screen. */
export function parseDexQuery(params: URLSearchParams): DexQuery {
  return {
    region: pick(params.get('region'), REGIONS, DEFAULT_QUERY.region),
    status: pick(params.get('status'), STATUSES, DEFAULT_QUERY.status),
    sort: pick(params.get('sort'), SORTS, DEFAULT_QUERY.sort),
    q: (params.get('q') ?? '').slice(0, MAX_SEARCH_LENGTH),
  }
}

/** Only what differs from the default goes into the address, so the usual address stays short. */
export function dexQueryToParams(query: DexQuery): URLSearchParams {
  const params = new URLSearchParams()
  if (query.region !== DEFAULT_QUERY.region) params.set('region', query.region)
  if (query.status !== DEFAULT_QUERY.status) params.set('status', query.status)
  if (query.sort !== DEFAULT_QUERY.sort) params.set('sort', query.sort)
  const q = query.q.trim().slice(0, MAX_SEARCH_LENGTH)
  if (q !== '') params.set('q', q)
  return params
}

/** `?region=europe` or an empty string, ready to put behind a path. */
export function dexQueryToSearch(query: DexQuery): string {
  const text = dexQueryToParams(query).toString()
  return text === '' ? '' : `?${text}`
}

export function hasActiveFilters(query: DexQuery): boolean {
  return query.status !== DEFAULT_QUERY.status || normalizeForSearch(query.q) !== ''
}

export type CaughtLookup = (speciesId: string) => boolean

/**
 * The birds to show, in order: the region, then caught or missing, then the search, then the sort.
 * While searching with the default sort the best matches come first (a name that starts with the word beats one that
 * only contains it); choosing another sort puts the matches in that order instead.
 */
export function selectSpecies(list: readonly Species[], query: DexQuery, isCaught: CaughtLookup): Species[] {
  let pool = filterByRegion(list, query.region)
  if (query.status !== 'all') {
    const wanted = query.status === 'caught'
    pool = pool.filter((species) => isCaught(species.id) === wanted)
  }
  if (normalizeForSearch(query.q) !== '') {
    const matches = searchSpecies(pool, query.q)
    return query.sort === 'number' ? matches : sortSpecies(matches, query.sort)
  }
  return sortSpecies(pool, query.sort)
}

export interface Progress {
  caught: number
  total: number
  /** 0 to 1; 0 for an empty region. */
  fraction: number
}

/** How many birds of a region are caught: the number the progress ring shows. */
export function regionProgress(list: readonly Species[], region: Region, isCaught: CaughtLookup): Progress {
  const inRegion = filterByRegion(list, region)
  const caught = inRegion.reduce((count, species) => count + (isCaught(species.id) ? 1 : 0), 0)
  return { caught, total: inRegion.length, fraction: inRegion.length === 0 ? 0 : caught / inRegion.length }
}

export type ProgressStage = 'none' | 'start' | 'growing' | 'half' | 'almost' | 'complete'

/** Which cheering line goes with the progress. */
export function progressStage({ caught, total }: Pick<Progress, 'caught' | 'total'>): ProgressStage {
  if (total <= 0 || caught <= 0) return 'none'
  if (caught >= total) return 'complete'
  const fraction = caught / total
  if (fraction < 0.1) return 'start'
  if (fraction < 0.4) return 'growing'
  if (fraction < 0.75) return 'half'
  return 'almost'
}

/** What the Dex puts into the history entry of a bird it opens: the Back button of the bird screen may then simply go back. */
export const FROM_DEX = { fromDex: true } as const

export function cameFromDex(state: unknown): boolean {
  return typeof state === 'object' && state !== null && (state as { fromDex?: unknown }).fromDex === true
}

/**
 * The address of a bird's detail screen that also carries the state of the list it was opened from, so the screen can
 * go back to that list and offer "previous" and "next" within it.
 */
export function speciesHref(speciesId: string, query: DexQuery): string {
  return `/species/${encodeURIComponent(speciesId)}${dexQueryToSearch(query)}`
}

export interface Neighbours {
  previous: Species | undefined
  next: Species | undefined
  /** Position in the list, 1-based; 0 when the bird is not in the list. */
  position: number
  total: number
}

/** The birds before and after one bird in the list. A bird that is not in the list has none. */
export function neighboursOf(list: readonly Species[], speciesId: string): Neighbours {
  const index = list.findIndex((species) => species.id === speciesId)
  if (index < 0) return { previous: undefined, next: undefined, position: 0, total: list.length }
  return { previous: list[index - 1], next: list[index + 1], position: index + 1, total: list.length }
}
