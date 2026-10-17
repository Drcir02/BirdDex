import 'fake-indexeddb/auto'
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  addCatch,
  BirdDexDatabase,
  catchesBySpecies,
  clearPhotoCache,
  countCatches,
  deleteAllCatches,
  deleteCatch,
  getCachedPhoto,
  getCatch,
  getDb,
  getMedia,
  listCatches,
  newId,
  putCachedPhoto,
  SCHEMA_VERSIONS,
  StorageFullError,
  summarizeCatches,
  updateCatchNote,
} from '../../src/db'
import type { CatchRecord } from '../../src/domain/types'

const bytesOf = async (blob: Blob) => Array.from(new Uint8Array(await blob.arrayBuffer()))
const jpeg = () => new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])], { type: 'image/jpeg' })
const wav = () => new Blob([new Uint8Array([0x52, 0x49, 0x46, 0x46, 9, 8, 7])], { type: 'audio/wav' })

beforeEach(async () => {
  await deleteAllCatches()
  await clearPhotoCache()
})

describe('addCatch', () => {
  it('saves the catch together with its photo', async () => {
    const saved = await addCatch(
      { speciesId: 'parus-major', method: 'photo', confidence: 0.91, caughtAt: 1_700_000_000_000, location: { lat: 50.08, lon: 14.43, accuracyM: 12 }, placeName: 'Praha' },
      { kind: 'image', blob: jpeg() },
    )
    expect(saved).toMatchObject({ speciesId: 'parus-major', method: 'photo', confidence: 0.91, caughtAt: 1_700_000_000_000, placeName: 'Praha' })
    expect(saved.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(saved.mediaId).toBeTruthy()

    expect(await getCatch(saved.id)).toEqual(saved)
    const media = await getMedia(saved.mediaId as string)
    expect(media).toMatchObject({ id: saved.mediaId, kind: 'image', mime: 'image/jpeg' })
    expect(await bytesOf((media as NonNullable<typeof media>).blob)).toEqual([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])
  })

  it('saves an audio clip with its length', async () => {
    const saved = await addCatch({ speciesId: 'turdus-merula', method: 'sound', confidence: 0.8 }, { kind: 'audio', blob: wav(), durationS: 4.5 })
    const media = await getMedia(saved.mediaId as string)
    expect(media).toMatchObject({ kind: 'audio', mime: 'audio/wav', durationS: 4.5 })
    expect(await bytesOf((media as NonNullable<typeof media>).blob)).toEqual([0x52, 0x49, 0x46, 0x46, 9, 8, 7])
  })

  it('takes the type from the blob, or a sensible default when the blob has none', async () => {
    const a = await addCatch({ speciesId: 'a', method: 'photo', confidence: 0.7 }, { kind: 'image', blob: new Blob([new Uint8Array([1])]) })
    const b = await addCatch({ speciesId: 'b', method: 'sound', confidence: 0.7 }, { kind: 'audio', blob: new Blob([new Uint8Array([1])]) })
    const c = await addCatch({ speciesId: 'c', method: 'photo', confidence: 0.7 }, { kind: 'image', blob: new Blob([new Uint8Array([1])], { type: 'image/png' }), mime: 'image/webp' })
    expect((await getMedia(a.mediaId as string))?.mime).toBe('image/jpeg')
    expect((await getMedia(b.mediaId as string))?.mime).toBe('audio/wav')
    expect((await getMedia(c.mediaId as string))?.mime).toBe('image/webp')
  })

  it('works without any media, fills in the date, and keeps the confidence between 0 and 1', async () => {
    const before = Date.now()
    const saved = await addCatch({ speciesId: 'erithacus-rubecula', method: 'live', confidence: 1.7 })
    expect(saved.mediaId).toBeUndefined()
    expect(saved.confidence).toBe(1)
    expect(saved.caughtAt).toBeGreaterThanOrEqual(before)
    expect((await addCatch({ speciesId: 'x', method: 'sound', confidence: -3 })).confidence).toBe(0)
    expect((await addCatch({ speciesId: 'x', method: 'sound', confidence: Number.NaN })).confidence).toBe(0)
  })

  it('refuses a catch without a species', async () => {
    await expect(addCatch({ speciesId: '', method: 'sound', confidence: 0.9 })).rejects.toThrow(TypeError)
  })

  it('does not keep the photo when the catch itself cannot be saved (all or nothing)', async () => {
    const db = getDb()
    const spy = vi.spyOn(db.catches, 'add').mockRejectedValueOnce(new Error('disk error'))
    await expect(addCatch({ speciesId: 'parus-major', method: 'photo', confidence: 0.9 }, { kind: 'image', blob: jpeg() })).rejects.toThrow('disk error')
    spy.mockRestore()
    expect(await db.media.count()).toBe(0)
    expect(await countCatches()).toBe(0)
  })

  it('saves once when the same catch id arrives twice (a double tap), and returns the first catch', async () => {
    const first = await addCatch({ id: 'tap-1', speciesId: 'parus-major', method: 'photo', confidence: 0.9 }, { kind: 'image', blob: jpeg() })
    const second = await addCatch({ id: 'tap-1', speciesId: 'turdus-merula', method: 'photo', confidence: 0.5 }, { kind: 'image', blob: jpeg() })
    expect(second).toEqual(first)
    expect(second.speciesId).toBe('parus-major')
    expect(await countCatches()).toBe(1)
    expect(await getDb().media.count()).toBe(1)
    // Two taps at the very same moment also save one catch.
    const results = await Promise.all([1, 2].map(() => addCatch({ id: 'tap-2', speciesId: 'a', method: 'sound', confidence: 0.9 })))
    expect(results[0].id).toBe(results[1].id)
    expect(await countCatches()).toBe(2)
  })

  it('makes a new id for every catch that does not bring one', async () => {
    const a = await addCatch({ speciesId: 'parus-major', method: 'sound', confidence: 0.9 })
    const b = await addCatch({ speciesId: 'parus-major', method: 'sound', confidence: 0.9 })
    expect(a.id).not.toBe(b.id)
    expect(await countCatches()).toBe(2)
  })

  it('reports a full phone as a StorageFullError and keeps nothing', async () => {
    const db = getDb()
    const spy = vi.spyOn(db.catches, 'add').mockRejectedValueOnce(new DOMException('no room', 'QuotaExceededError'))
    await expect(addCatch({ speciesId: 'parus-major', method: 'photo', confidence: 0.9 }, { kind: 'image', blob: jpeg() })).rejects.toBeInstanceOf(StorageFullError)
    spy.mockRestore()
    expect(await db.media.count()).toBe(0)
    expect(await countCatches()).toBe(0)
  })

  it('does not store the caller\'s location object itself', async () => {
    const location = { lat: 1, lon: 2 }
    const saved = await addCatch({ speciesId: 'a', method: 'sound', confidence: 0.9, location })
    location.lat = 99
    expect(saved.location).toEqual({ lat: 1, lon: 2 })
  })
})

describe('listing catches', () => {
  const seed = async () => {
    await addCatch({ speciesId: 'parus-major', method: 'photo', confidence: 0.9, caughtAt: 1000 })
    await addCatch({ speciesId: 'turdus-merula', method: 'sound', confidence: 0.8, caughtAt: 3000 })
    await addCatch({ speciesId: 'parus-major', method: 'sound', confidence: 0.75, caughtAt: 2000 })
    await addCatch({ speciesId: 'parus-major-x', method: 'sound', confidence: 0.75, caughtAt: 2500 })
  }

  it('lists everything, newest first', async () => {
    await seed()
    expect((await listCatches()).map((record) => record.caughtAt)).toEqual([3000, 2500, 2000, 1000])
    expect(await countCatches()).toBe(4)
  })

  it('pages with limit and offset', async () => {
    await seed()
    expect((await listCatches({ limit: 2 })).map((record) => record.caughtAt)).toEqual([3000, 2500])
    expect((await listCatches({ limit: 2, offset: 2 })).map((record) => record.caughtAt)).toEqual([2000, 1000])
    expect((await listCatches({ offset: 3 })).map((record) => record.caughtAt)).toEqual([1000])
  })

  it('lists the catches of one species, newest first, and not those of a similar name', async () => {
    await seed()
    const tits = await catchesBySpecies('parus-major')
    expect(tits.map((record) => record.caughtAt)).toEqual([2000, 1000])
    expect(tits.every((record) => record.speciesId === 'parus-major')).toBe(true)
    expect(await catchesBySpecies('never-caught')).toEqual([])
  })

  it('is empty on a new phone', async () => {
    expect(await listCatches()).toEqual([])
    expect(await catchesBySpecies('parus-major')).toEqual([])
    expect(await countCatches()).toBe(0)
  })
})

describe('deleteCatch', () => {
  it('deletes the catch and the photo that belonged to it', async () => {
    const saved = await addCatch({ speciesId: 'parus-major', method: 'photo', confidence: 0.9 }, { kind: 'image', blob: jpeg() })
    expect(await deleteCatch(saved.id)).toBe(true)
    expect(await getCatch(saved.id)).toBeUndefined()
    expect(await getMedia(saved.mediaId as string)).toBeUndefined()
    expect(await getDb().media.count()).toBe(0)
  })

  it('keeps a photo that another catch still uses', async () => {
    const first = await addCatch({ speciesId: 'parus-major', method: 'photo', confidence: 0.9 }, { kind: 'image', blob: jpeg() })
    const second = await addCatch({ speciesId: 'parus-major', method: 'photo', confidence: 0.9, caughtAt: Date.now() + 1 })
    await getDb().catches.update(second.id, { mediaId: first.mediaId })
    expect(await deleteCatch(first.id)).toBe(true)
    expect(await getMedia(first.mediaId as string)).toBeDefined()
    expect(await deleteCatch(second.id)).toBe(true)
    expect(await getMedia(first.mediaId as string)).toBeUndefined()
  })

  it('leaves other catches alone and says so when there was nothing to delete', async () => {
    const keep = await addCatch({ speciesId: 'a', method: 'sound', confidence: 0.9 }, { kind: 'audio', blob: wav() })
    expect(await deleteCatch('no-such-id')).toBe(false)
    expect(await getCatch(keep.id)).toBeDefined()
    expect(await getMedia(keep.mediaId as string)).toBeDefined()
  })

  it('deleteAllCatches clears catches and media but keeps the reference photo cache', async () => {
    await addCatch({ speciesId: 'a', method: 'photo', confidence: 0.9 }, { kind: 'image', blob: jpeg() })
    await putCachedPhoto({ speciesId: 'a', thumbnailUrl: 'https://example.org/a.jpg', author: 'X', licence: 'CC BY 4.0', link: 'https://example.org/a', fetchedAt: 1 })
    await deleteAllCatches()
    expect(await countCatches()).toBe(0)
    expect(await getDb().media.count()).toBe(0)
    expect(await getCachedPhoto('a')).toBeDefined()
  })
})

describe('updateCatchNote', () => {
  it('sets and clears a note', async () => {
    const saved = await addCatch({ speciesId: 'a', method: 'sound', confidence: 0.9 })
    expect(await updateCatchNote(saved.id, 'Na zahradě u třešně')).toBe(true)
    expect((await getCatch(saved.id))?.note).toBe('Na zahradě u třešně')
    expect(await updateCatchNote(saved.id, undefined)).toBe(true)
    expect(await getCatch(saved.id)).not.toHaveProperty('note')
    expect(await updateCatchNote('missing', 'x')).toBe(false)
  })
})

describe('reference photo cache', () => {
  it('stores, replaces and clears photo credits', async () => {
    const record = { speciesId: 'parus-major', thumbnailUrl: 'https://upload.example/a.jpg', author: 'Jan Novák', licence: 'CC BY-SA 4.0', link: 'https://commons.example/File:a.jpg', fetchedAt: 123 }
    await putCachedPhoto(record)
    expect(await getCachedPhoto('parus-major')).toEqual(record)
    await putCachedPhoto({ ...record, author: 'Eva Svobodová', thumbnail: jpeg() })
    const replaced = await getCachedPhoto('parus-major')
    expect(replaced?.author).toBe('Eva Svobodová')
    expect(await bytesOf(replaced?.thumbnail as Blob)).toEqual([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])
    expect(await getCachedPhoto('unknown')).toBeUndefined()
    await clearPhotoCache()
    expect(await getCachedPhoto('parus-major')).toBeUndefined()
  })
})

describe('summarizeCatches', () => {
  const record = (id: string, speciesId: string, caughtAt: number, method: CatchRecord['method'], mediaId?: string): CatchRecord => ({
    id,
    speciesId,
    caughtAt,
    method,
    confidence: 0.9,
    ...(mediaId ? { mediaId } : {}),
  })

  it('is empty without catches', () => {
    expect(summarizeCatches([]).size).toBe(0)
  })

  it('counts catches and finds the first and last date per species', () => {
    const summary = summarizeCatches([record('1', 'a', 300, 'sound'), record('2', 'b', 100, 'sound'), record('3', 'a', 100, 'photo'), record('4', 'a', 200, 'live')])
    expect(summary.size).toBe(2)
    expect(summary.get('a')).toMatchObject({ speciesId: 'a', count: 3, firstCaughtAt: 100, lastCaughtAt: 300 })
    expect(summary.get('b')).toMatchObject({ count: 1, firstCaughtAt: 100, lastCaughtAt: 100 })
    expect(summary.get('b')?.mediaId).toBeUndefined()
  })

  it('shows the newest photo, even when a newer sound clip exists', () => {
    const summary = summarizeCatches([
      record('1', 'a', 100, 'photo', 'old-photo'),
      record('2', 'a', 200, 'live', 'new-photo'),
      record('3', 'a', 300, 'sound', 'clip'),
    ])
    expect(summary.get('a')).toMatchObject({ mediaId: 'new-photo', mediaKind: 'image' })
  })

  it('falls back to the newest clip when there is no photo', () => {
    const summary = summarizeCatches([record('1', 'a', 100, 'sound', 'clip-1'), record('2', 'a', 200, 'sound', 'clip-2'), record('3', 'a', 300, 'sound')])
    expect(summary.get('a')).toMatchObject({ mediaId: 'clip-2', mediaKind: 'audio' })
  })

  it('does not depend on the order of the input', () => {
    const catches = [record('1', 'a', 100, 'photo', 'p1'), record('2', 'a', 200, 'photo', 'p2'), record('3', 'a', 150, 'sound', 'c')]
    expect(summarizeCatches([...catches].reverse())).toEqual(summarizeCatches(catches))
  })
})

describe('database schema', () => {
  it('has a strictly increasing list of versions starting at 1', () => {
    expect(SCHEMA_VERSIONS[0].version).toBe(1)
    SCHEMA_VERSIONS.forEach((entry, index) => {
      if (index > 0) expect(entry.version).toBeGreaterThan(SCHEMA_VERSIONS[index - 1].version)
    })
  })

  it('upgrades an old database in place and runs the migration on existing rows', async () => {
    // A private IndexedDB factory so this database exists nowhere else.
    const options = { indexedDB: new IDBFactory(), IDBKeyRange }
    const v1 = SCHEMA_VERSIONS[0]
    const old = new BirdDexDatabase('migration-test', [v1], options)
    await old.catches.add({ id: 'c1', speciesId: 'parus-major', caughtAt: 10, method: 'sound', confidence: 0.9 })
    await old.catches.add({ id: 'c2', speciesId: 'turdus-merula', caughtAt: 20, method: 'photo', confidence: 0.7 })
    old.close()

    const upgrade = vi.fn(async (transaction: Parameters<NonNullable<(typeof v1)['upgrade']>>[0]) => {
      await transaction.table('catches').toCollection().modify((row: CatchRecord & { note?: string }) => {
        row.note = `migrated ${row.speciesId}`
      })
    })
    const next = new BirdDexDatabase(
      'migration-test',
      [v1, { version: 2, stores: { catches: 'id, speciesId, caughtAt, [speciesId+caughtAt], mediaId, method', trips: 'id' }, upgrade }],
      options,
    )
    expect(await next.catches.count()).toBe(2)
    expect(upgrade).toHaveBeenCalledTimes(1)
    expect((await next.catches.get('c1'))?.note).toBe('migrated parus-major')
    // The new index and the new table work.
    expect((await next.catches.where('method').equals('photo').toArray()).map((row) => row.id)).toEqual(['c2'])
    await next.table('trips').add({ id: 't1' })
    expect(await next.table('trips').count()).toBe(1)
    next.close()
  })

  it('applies versions in order even when they are listed out of order', async () => {
    const options = { indexedDB: new IDBFactory(), IDBKeyRange }
    const [v1] = SCHEMA_VERSIONS
    const db = new BirdDexDatabase('order-test', [{ version: 2, stores: { extra: 'id' } }, v1], options)
    await db.catches.add({ id: 'c', speciesId: 's', caughtAt: 1, method: 'sound', confidence: 1 })
    await db.table('extra').add({ id: 'e' })
    expect(await db.catches.count()).toBe(1)
    db.close()
  })
})

describe('newId', () => {
  it('makes unique ids shaped like a UUID', () => {
    const ids = new Set(Array.from({ length: 200 }, () => newId()))
    expect(ids.size).toBe(200)
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })

  it('still works on a page without randomUUID (an unsecured address)', () => {
    const real = globalThis.crypto
    vi.stubGlobal('crypto', { getRandomValues: real.getRandomValues.bind(real) })
    try {
      expect(newId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    } finally {
      vi.unstubAllGlobals()
    }
    vi.stubGlobal('crypto', undefined)
    try {
      expect(newId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
