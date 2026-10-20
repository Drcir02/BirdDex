// The reference photo service: for a species it finds a picture on the English Wikipedia (the lead image of the bird's
// article), asks Wikimedia Commons who took it and under which licence, and only accepts CC0, public domain, CC BY and
// CC BY-SA. The answer is remembered in memory and in the IndexedDB table photoCache, so every bird is looked up once.
//
// Good manners towards the phone and towards Wikimedia: at most 4 lookups at a time, the newest request first, a few
// tries with growing pauses, no tries at all while the phone is offline, and a pause of a minute after many failures in
// a row. Nothing here ever throws into the rendering of a screen: the hook and the plain function return "no photo".

import { getSpeciesById, loadSpecies } from '../../data/species'
import { getCachedPhoto, putCachedPhoto, type PhotoCacheRecord } from '../../db'
import type { Species } from '../../domain/types'
import { fetchJson, HttpStatusError, type FetchJsonOptions } from './http'
import { createLimiter } from './limiter'
import { PhotoLookupError, type ReferencePhoto } from './types'
import {
  commonsCategoryUrl,
  commonsSearchUrl,
  creditUrl,
  czechSummaryUrl,
  DETAIL_WIDTH,
  fileOfImageUrl,
  filePageUrl,
  parseCommonsFiles,
  parseCredit,
  parseSummary,
  summaryUrl,
  thumbnailAtWidth,
  type CommonsFile,
} from './wikimedia'

const DAY_MS = 24 * 60 * 60 * 1000
/** A found photo is looked up again after this long (the lead picture of an article can change). */
export const HIT_TTL_MS = 60 * DAY_MS
/** "No usable photo" is asked again after this long. */
export const MISS_TTL_MS = 7 * DAY_MS
/** A saved "no photo" older than this (20 October 2026) is forgotten: the lookup has more places to look now. */
export const MISSES_RETRIED_SINCE = Date.UTC(2026, 9, 20)
/** After a failed lookup the same bird is not tried again for this long (unless the phone comes back online). */
export const FAILURE_COOL_DOWN_MS = 20_000
/** This many failed lookups in a row pause the whole service for BREAKER_PAUSE_MS. */
export const BREAKER_THRESHOLD = 6
export const BREAKER_PAUSE_MS = 60_000
export const MAX_CONCURRENT_LOOKUPS = 4

export interface PhotoCache {
  get(speciesId: string): Promise<PhotoCacheRecord | undefined>
  put(record: PhotoCacheRecord): Promise<void>
}

export interface ReferencePhotoServiceOptions {
  fetchImpl?: typeof fetch
  /** Where answers are kept between visits. Default: the photoCache table. */
  cache?: PhotoCache
  /** How to find the species (its Wikipedia title). Default: the loaded Dex data. */
  findSpecies?: (speciesId: string) => Promise<Species | undefined>
  now?: () => number
  sleep?: FetchJsonOptions['sleep']
  random?: FetchJsonOptions['random']
  isOnline?: () => boolean
  concurrency?: number
  retries?: number
  baseDelayMs?: number
}

export interface GetOptions {
  /** Aborting tells the service nobody waits for this answer any more; a lookup that has not started yet is then skipped. */
  signal?: AbortSignal
  /** Ask again even if the last try failed a moment ago. */
  force?: boolean
}

export interface ReferencePhotoService {
  /** The photo, or null when the species has no usable one. Rejects with PhotoLookupError when the answer could not be found out now. */
  get(speciesId: string, options?: GetOptions): Promise<ReferencePhoto | null>
  /** What is already known without waiting: the photo, null for "no photo", undefined for "not looked up yet". */
  peek(speciesId: string): ReferencePhoto | null | undefined
  /** Forgets what is kept in memory (the saved answers stay). For tests. */
  reset(): void
}

const defaultCache: PhotoCache = { get: getCachedPhoto, put: putCachedPhoto }

async function defaultFindSpecies(speciesId: string): Promise<Species | undefined> {
  const list = await loadSpecies()
  return getSpeciesById(speciesId, list)
}

function defaultIsOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false
}

/** A lookup nobody waits for any more was skipped. Internal: callers never see it. */
class SkippedLookup extends Error {
  constructor() {
    super('Nobody waits for this lookup any more')
    this.name = 'SkippedLookup'
  }
}

/** True for the error that get() rejects with when its signal was aborted. */
export const isAbortError = (error: unknown): boolean => error instanceof DOMException && error.name === 'AbortError'

function fromRecord(record: PhotoCacheRecord): ReferencePhoto | null {
  if (record.thumbnailUrl === '') return null
  return {
    speciesId: record.speciesId,
    thumbnailUrl: record.thumbnailUrl,
    imageUrl: thumbnailAtWidth(record.thumbnailUrl, DETAIL_WIDTH),
    author: record.author,
    licence: record.licence,
    link: record.link,
  }
}

function toRecord(speciesId: string, photo: ReferencePhoto | null, fetchedAt: number): PhotoCacheRecord {
  if (!photo) return { speciesId, thumbnailUrl: '', author: '', licence: '', link: '', fetchedAt }
  return { speciesId, thumbnailUrl: photo.thumbnailUrl, author: photo.author, licence: photo.licence, link: photo.link, fetchedAt }
}

export function createReferencePhotoService(options: ReferencePhotoServiceOptions = {}): ReferencePhotoService {
  const cache = options.cache ?? defaultCache
  const findSpecies = options.findSpecies ?? defaultFindSpecies
  const now = options.now ?? Date.now
  const isOnline = options.isOnline ?? defaultIsOnline
  const limiter = createLimiter(options.concurrency ?? MAX_CONCURRENT_LOOKUPS)
  const http: FetchJsonOptions = {
    fetchImpl: options.fetchImpl,
    retries: options.retries,
    baseDelayMs: options.baseDelayMs,
    sleep: options.sleep,
    random: options.random,
  }

  const memory = new Map<string, ReferencePhoto | null>()
  const inflight = new Map<string, { waiters: number; promise: Promise<ReferencePhoto | null> }>()
  const failures = new Map<string, { at: number; error: PhotoLookupError }>()
  let consecutiveFailures = 0
  let pausedUntil = 0

  const remember = (speciesId: string, photo: ReferencePhoto | null) => {
    memory.set(speciesId, photo)
    failures.delete(speciesId)
    return photo
  }

  async function readStored(speciesId: string): Promise<PhotoCacheRecord | undefined> {
    try {
      return await cache.get(speciesId)
    } catch {
      return undefined // a database that cannot be read is no reason to fail
    }
  }

  // A record "from the future" (the phone's clock was wrong) is not trusted either.
  const isFresh = (record: PhotoCacheRecord) => {
    // "No photo" answers from before the Czech Wikipedia and Commons fallbacks existed are asked again once.
    if (record.thumbnailUrl === '' && record.fetchedAt < MISSES_RETRIED_SINCE && now() >= MISSES_RETRIED_SINCE) return false
    const age = now() - record.fetchedAt
    return age > -DAY_MS && age < (record.thumbnailUrl === '' ? MISS_TTL_MS : HIT_TTL_MS)
  }

  async function summaryOf(title: string, urlOf: (title: string) => string = summaryUrl) {
    try {
      return parseSummary(await fetchJson(urlOf(title), http))
    } catch (error) {
      if (error instanceof HttpStatusError) {
        if (error.status === 404) return undefined // no such article under this title
        throw new PhotoLookupError('network', `Wikipedia answered ${error.status}`, { cause: error })
      }
      throw error
    }
  }

  async function creditOf(file: NonNullable<ReturnType<typeof fileOfImageUrl>>) {
    try {
      return parseCredit(await fetchJson(creditUrl(file), http))
    } catch (error) {
      if (error instanceof HttpStatusError) throw new PhotoLookupError('network', `Wikimedia answered ${error.status}`, { cause: error })
      throw error
    }
  }

  const photoOf = (species: Species, thumbnailUrl: string, file: CommonsFile, credit: { author: string; licence: { name: string } }): ReferencePhoto => ({
    speciesId: species.id,
    thumbnailUrl,
    imageUrl: thumbnailAtWidth(thumbnailUrl, DETAIL_WIDTH),
    author: credit.author,
    licence: credit.licence.name,
    link: filePageUrl(file),
  })

  /** A Wikipedia article's picture, when it has one with a licence that may be shown. */
  async function fromArticle(species: Species, title: string, urlOf?: (title: string) => string): Promise<ReferencePhoto | null> {
    const summary = await summaryOf(title, urlOf)
    const thumbnailUrl = summary?.thumbnailUrl ?? summary?.originalUrl
    if (!thumbnailUrl) return null
    const file = fileOfImageUrl(thumbnailUrl) ?? (summary?.originalUrl ? fileOfImageUrl(summary.originalUrl) : undefined)
    if (!file) return null // without a file page there is nobody to credit
    const credit = await creditOf(file)
    return credit ? photoOf(species, thumbnailUrl, file, credit) : null
  }

  /** The best photo among the pictures that Commons itself lists for the species (its category, then a search). */
  async function fromCommons(species: Species, url: string): Promise<ReferencePhoto | null> {
    let json: unknown
    try {
      json = await fetchJson(url, http)
    } catch (error) {
      if (error instanceof HttpStatusError) {
        if (error.status === 404) return null
        throw new PhotoLookupError('network', `Wikimedia answered ${error.status}`, { cause: error })
      }
      throw error
    }
    const best = parseCommonsFiles(json)[0]
    return best ? photoOf(species, best.thumbnailUrl, best.file, best.credit) : null
  }

  /**
   * Looks for a picture in turn: the English article (by its title, then by the scientific name), the Czech article, the
   * Commons category of the species, a Commons search. The first usable photo wins; a picture whose licence is not allowed
   * only means the next place is tried.
   */
  async function findOnline(species: Species): Promise<ReferencePhoto | null> {
    const titles = [...new Set([species.wikiTitle, species.scientificName].filter((title): title is string => !!title))]
    for (const title of titles) {
      const photo = await fromArticle(species, title)
      if (photo) return photo
    }
    if (species.czechName) {
      const photo = await fromArticle(species, species.czechName, czechSummaryUrl)
      if (photo) return photo
    }
    const fromCategory = await fromCommons(species, commonsCategoryUrl(species.scientificName))
    if (fromCategory) return fromCategory
    return fromCommons(species, commonsSearchUrl(species.scientificName))
  }

  async function lookup(speciesId: string, entry: { waiters: number }): Promise<ReferencePhoto | null> {
    const stored = await readStored(speciesId)
    if (stored && isFresh(stored)) return remember(speciesId, fromRecord(stored))

    // An old answer is better than none when the web cannot be reached.
    const orOldAnswer = (error: PhotoLookupError): ReferencePhoto | null => {
      if (!stored) throw error
      return remember(speciesId, fromRecord(stored))
    }

    if (!isOnline()) return orOldAnswer(new PhotoLookupError('offline'))
    if (now() < pausedUntil) return orOldAnswer(new PhotoLookupError('paused'))

    try {
      const species = await findSpecies(speciesId)
      if (!species) return remember(speciesId, null) // not a bird of the Dex: nothing to look up
      const photo = await limiter.run(async () => {
        if (entry.waiters <= 0) throw new SkippedLookup()
        return findOnline(species)
      })
      consecutiveFailures = 0
      cache.put(toRecord(speciesId, photo, now())).catch(() => undefined) // saving is best effort
      return remember(speciesId, photo)
    } catch (error) {
      if (error instanceof SkippedLookup) throw error
      const failure = error instanceof PhotoLookupError ? error : new PhotoLookupError('network', undefined, { cause: error })
      consecutiveFailures += 1
      if (consecutiveFailures >= BREAKER_THRESHOLD) {
        pausedUntil = now() + BREAKER_PAUSE_MS
        consecutiveFailures = 0
      }
      failures.set(speciesId, { at: now(), error: failure })
      return orOldAnswer(failure)
    }
  }

  async function get(speciesId: string, getOptions: GetOptions = {}): Promise<ReferencePhoto | null> {
    const { signal, force } = getOptions
    if (signal?.aborted) throw new DOMException('The lookup was cancelled', 'AbortError')
    if (memory.has(speciesId)) return memory.get(speciesId) ?? null
    const cooling = failures.get(speciesId)
    if (cooling && !force && now() - cooling.at < FAILURE_COOL_DOWN_MS) throw cooling.error

    let entry = inflight.get(speciesId)
    if (!entry) {
      const created = { waiters: 0, promise: undefined as unknown as Promise<ReferencePhoto | null> }
      created.promise = lookup(speciesId, created).finally(() => {
        if (inflight.get(speciesId) === created) inflight.delete(speciesId)
      })
      // Nobody may have joined when this settles; the rejection is reported to whoever awaits it.
      created.promise.catch(() => undefined)
      inflight.set(speciesId, created)
      entry = created
    }
    const joined = entry
    joined.waiters += 1
    let left = false
    const leave = () => {
      if (!left) {
        left = true
        joined.waiters -= 1
      }
    }
    signal?.addEventListener('abort', leave, { once: true })
    try {
      return await joined.promise
    } catch (error) {
      if (error instanceof SkippedLookup && !signal?.aborted) return get(speciesId, getOptions) // somebody wants it after all
      if (error instanceof SkippedLookup) throw new DOMException('The lookup was cancelled', 'AbortError')
      throw error
    } finally {
      signal?.removeEventListener('abort', leave)
      leave()
    }
  }

  return {
    get,
    peek: (speciesId) => memory.get(speciesId),
    reset() {
      memory.clear()
      failures.clear()
      consecutiveFailures = 0
      pausedUntil = 0
    },
  }
}

/** The service the app uses. */
export const referencePhotos: ReferencePhotoService = createReferencePhotoService()

/** For code outside React: the reference photo of a species, or null when there is none. Never throws; a failed lookup also gives null. */
export async function getReferencePhoto(speciesId: string): Promise<ReferencePhoto | null> {
  try {
    return await referencePhotos.get(speciesId)
  } catch {
    return null
  }
}

/** What is known about a species' photo without waiting: the photo, null for "none", undefined for "not looked up yet". */
export function peekReferencePhoto(speciesId: string): ReferencePhoto | null | undefined {
  return referencePhotos.peek(speciesId)
}
