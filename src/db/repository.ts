// Reading and writing catches, their photos and clips, and the cached reference photos.
// Screens use these functions and never touch the tables directly.

import type { CatchMethod, CatchRecord, GeoPoint, MediaRecord } from '../domain/types'
import { requestPersistentStorage } from '../state/storage'
import { getDb, type PhotoCacheRecord } from './database'
import { isQuotaExceededError, StorageFullError } from './errors'
import { newId } from './ids'

export interface NewCatch {
  speciesId: string
  method: CatchMethod
  /** 0 to 1. Values outside are clamped. */
  confidence: number
  /** Milliseconds since 1970. Defaults to now. */
  caughtAt?: number
  location?: GeoPoint
  placeName?: string
  note?: string
  /**
   * Normally a fresh id is made. Pass the same id for the same catch (for example `getPendingCatchId()` from
   * src/state/pending.ts) to make a double tap on the Catch button harmless: the second call saves nothing and
   * returns the catch that was saved the first time.
   */
  id?: string
}

export interface NewMedia {
  kind: 'image' | 'audio'
  blob: Blob
  /** Defaults to the blob's own type. */
  mime?: string
  /** Audio clips only. */
  durationS?: number
}

const clamp01 = (value: number) => (Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0)

/** Passes errors on, except that "no room left" becomes a StorageFullError the screens know. */
async function guard<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    if (isQuotaExceededError(error)) throw new StorageFullError(undefined, { cause: error })
    throw error
  }
}

/**
 * Saves a catch together with its photo or clip, all or nothing: if anything fails, nothing is kept.
 * Returns the saved record (with its new id and the id of the saved media).
 * If a catch with the given `id` already exists, nothing is written and that catch is returned.
 */
export async function addCatch(input: NewCatch, media?: NewMedia): Promise<CatchRecord> {
  if (!input.speciesId) throw new TypeError('addCatch needs a speciesId')
  const db = getDb()
  const now = Date.now()
  const record: CatchRecord = {
    id: input.id ?? newId(),
    speciesId: input.speciesId,
    caughtAt: Number.isFinite(input.caughtAt) ? (input.caughtAt as number) : now,
    method: input.method,
    confidence: clamp01(input.confidence),
  }
  if (input.location) record.location = { ...input.location }
  if (input.placeName) record.placeName = input.placeName
  if (input.note) record.note = input.note

  return guard(async () => {
    let result = record
    await db.transaction('rw', db.catches, db.media, async () => {
      if (input.id) {
        const existing = await db.catches.get(input.id)
        if (existing) {
          result = existing
          return
        }
      }
      if (media) {
        const saved: MediaRecord = {
          id: newId(),
          kind: media.kind,
          mime: media.mime || media.blob.type || (media.kind === 'image' ? 'image/jpeg' : 'audio/wav'),
          blob: media.blob,
          createdAt: now,
        }
        if (media.durationS !== undefined && Number.isFinite(media.durationS)) saved.durationS = media.durationS
        await db.media.add(saved)
        record.mediaId = saved.id
      }
      await db.catches.add(record)
    })
    // The first catch is the moment the data becomes worth protecting. Not awaited: it must never delay or fail a catch.
    void requestPersistentStorage()
    return result
  })
}

export function getCatch(id: string): Promise<CatchRecord | undefined> {
  return getDb().catches.get(id)
}

/** Every catch, newest first. */
export function listCatches(options: { limit?: number; offset?: number } = {}): Promise<CatchRecord[]> {
  let query = getDb().catches.orderBy('caughtAt').reverse()
  if (options.offset) query = query.offset(options.offset)
  if (options.limit !== undefined) query = query.limit(options.limit)
  return query.toArray()
}

/** The catches of one species, newest first. */
export function catchesBySpecies(speciesId: string): Promise<CatchRecord[]> {
  return getDb()
    .catches.where('[speciesId+caughtAt]')
    .between([speciesId, -Infinity], [speciesId, Infinity])
    .reverse()
    .toArray()
}

export function countCatches(): Promise<number> {
  return getDb().catches.count()
}

/**
 * Deletes a catch and its photo or clip, unless another catch still uses that media.
 * Returns false when there was no such catch.
 */
export function deleteCatch(id: string): Promise<boolean> {
  const db = getDb()
  return db.transaction('rw', db.catches, db.media, async () => {
    const existing = await db.catches.get(id)
    if (!existing) return false
    await db.catches.delete(id)
    if (existing.mediaId && (await db.catches.where('mediaId').equals(existing.mediaId).count()) === 0) {
      await db.media.delete(existing.mediaId)
    }
    return true
  })
}

/** Sets or clears the note of a catch. Returns false when there was no such catch. */
export async function updateCatchNote(id: string, note: string | undefined): Promise<boolean> {
  const db = getDb()
  const existing = await db.catches.get(id)
  if (!existing) return false
  const next: CatchRecord = { ...existing }
  if (note) next.note = note
  else delete next.note
  await guard(() => db.catches.put(next))
  return true
}

/** Removes every catch and every saved photo and clip. The reference photo cache stays. */
export function deleteAllCatches(): Promise<void> {
  const db = getDb()
  return db.transaction('rw', db.catches, db.media, async () => {
    await db.catches.clear()
    await db.media.clear()
  })
}

/** The photo or clip saved with a catch. */
export function getMedia(id: string): Promise<MediaRecord | undefined> {
  return getDb().media.get(id)
}

// ---------- Reference photo cache ----------

export function getCachedPhoto(speciesId: string): Promise<PhotoCacheRecord | undefined> {
  return getDb().photoCache.get(speciesId)
}

export function putCachedPhoto(record: PhotoCacheRecord): Promise<void> {
  return guard(async () => {
    await getDb().photoCache.put(record)
  })
}

export function clearPhotoCache(): Promise<void> {
  return getDb().photoCache.clear()
}
