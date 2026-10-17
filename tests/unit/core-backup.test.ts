import 'fake-indexeddb/auto'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  addCatch,
  BACKUP_FORMAT,
  backupFileName,
  BackupError,
  countCatches,
  deleteAllCatches,
  exportBackup,
  getCatch,
  getDb,
  getMedia,
  importBackup,
  listCatches,
} from '../../src/db'
import type { BackupErrorCode } from '../../src/db'
import { extensionForMime, MAX_BACKUP_FILE_BYTES, parseCatchRecord } from '../../src/db/backup'

const bytesOf = async (blob: Blob) => new Uint8Array(await blob.arrayBuffer())
const pattern = (length: number, seed: number) => Uint8Array.from({ length }, (_, i) => (i * 31 + seed) & 0xff)

const photoBytes = pattern(5000, 1)
const clipBytes = pattern(9000, 2)

async function seed() {
  const photo = await addCatch(
    { speciesId: 'parus-major', method: 'photo', confidence: 0.91, caughtAt: 1_700_000_000_000, location: { lat: 50.08, lon: 14.43, accuracyM: 12 }, placeName: 'Praha', note: 'Na krmítku' },
    { kind: 'image', blob: new Blob([photoBytes], { type: 'image/jpeg' }) },
  )
  const clip = await addCatch(
    { speciesId: 'turdus-merula', method: 'sound', confidence: 0.83, caughtAt: 1_700_000_100_000, location: { lat: 49.2, lon: 16.6 } },
    { kind: 'audio', blob: new Blob([clipBytes], { type: 'audio/wav' }), durationS: 6.5 },
  )
  const live = await addCatch({ speciesId: 'parus-major', method: 'live', confidence: 0.66, caughtAt: 1_700_000_200_000 })
  return { photo, clip, live }
}

/** Builds a backup file by hand, for the tests that need a damaged one. */
function craft(parts: { manifest?: unknown; catches?: unknown; files?: Record<string, Uint8Array>; rawCatches?: string }) {
  const entries: Record<string, Uint8Array> = { ...parts.files }
  if (parts.manifest !== undefined) entries['manifest.json'] = strToU8(JSON.stringify(parts.manifest))
  if (parts.rawCatches !== undefined) entries['catches.json'] = strToU8(parts.rawCatches)
  else if (parts.catches !== undefined) entries['catches.json'] = strToU8(JSON.stringify(parts.catches))
  return new Blob([zipSync(entries) as BlobPart], { type: 'application/zip' })
}

const goodManifest = (media: unknown[] = []) => ({
  format: BACKUP_FORMAT,
  formatVersion: 1,
  appVersion: '0.0.1',
  exportedAt: '2026-10-17T05:00:00.000Z',
  counts: { catches: 0, media: media.length },
  media,
})
const goodCatch = (overrides: Record<string, unknown> = {}) => ({ id: 'c1', speciesId: 'parus-major', caughtAt: 1000, method: 'sound', confidence: 0.9, ...overrides })

async function rejectsWith(blob: Blob, code: BackupErrorCode) {
  const before = await countCatches()
  const error = await importBackup(blob).then(
    () => undefined,
    (e: unknown) => e,
  )
  expect(error).toBeInstanceOf(BackupError)
  expect((error as BackupError).code).toBe(code)
  // A rejected file must change nothing.
  expect(await countCatches()).toBe(before)
  return error as BackupError
}

beforeEach(async () => {
  await deleteAllCatches()
})

describe('exportBackup', () => {
  it('makes a zip with a manifest, the catches and the media files', async () => {
    const { photo, clip } = await seed()
    const blob = await exportBackup({ now: new Date('2026-10-17T05:00:00.000Z') })
    expect(blob.type).toBe('application/zip')
    const bytes = await bytesOf(blob)
    expect(String.fromCharCode(bytes[0], bytes[1])).toBe('PK')

    const files = unzipSync(bytes)
    const names = Object.keys(files).sort()
    expect(names).toEqual(['catches.json', 'manifest.json', `media/${photo.mediaId}.jpg`, `media/${clip.mediaId}.wav`].sort())

    const manifest = JSON.parse(strFromU8(files['manifest.json']))
    expect(manifest).toMatchObject({ format: 'birddex-backup', formatVersion: 1, appVersion: 'test', exportedAt: '2026-10-17T05:00:00.000Z', counts: { catches: 3, media: 2 } })
    expect(manifest.media).toHaveLength(2)
    expect(manifest.media.find((entry: { id: string }) => entry.id === clip.mediaId)).toMatchObject({ kind: 'audio', mime: 'audio/wav', durationS: 6.5, bytes: clipBytes.length })

    const catches = JSON.parse(strFromU8(files['catches.json']))
    expect(catches.map((c: { id: string }) => c.id)).toEqual([photo.id, clip.id, expect.any(String)])
    expect(files[`media/${photo.mediaId}.jpg`]).toEqual(photoBytes)
    expect(files[`media/${clip.mediaId}.wav`]).toEqual(clipBytes)
  })

  it('reports progress after every catch', async () => {
    await seed()
    const progress = vi.fn()
    await exportBackup({ onProgress: progress })
    expect(progress.mock.calls).toEqual([
      [1, 3],
      [2, 3],
      [3, 3],
    ])
  })

  it('works on an empty database', async () => {
    const files = unzipSync(await bytesOf(await exportBackup()))
    expect(Object.keys(files).sort()).toEqual(['catches.json', 'manifest.json'])
    expect(JSON.parse(strFromU8(files['catches.json']))).toEqual([])
    expect(JSON.parse(strFromU8(files['manifest.json'])).counts).toEqual({ catches: 0, media: 0 })
  })

  it('leaves out the reference to a photo that has gone missing, so the backup stays consistent', async () => {
    const { photo } = await seed()
    await getDb().media.delete(photo.mediaId as string)
    const files = unzipSync(await bytesOf(await exportBackup()))
    const catches = JSON.parse(strFromU8(files['catches.json'])) as { id: string; mediaId?: string }[]
    expect(catches.find((c) => c.id === photo.id)).not.toHaveProperty('mediaId')
    expect(Object.keys(files).some((name) => name.includes(photo.mediaId as string))).toBe(false)
  })

  it('writes a photo shared by two catches once', async () => {
    const { photo } = await seed()
    const second = await addCatch({ speciesId: 'parus-major', method: 'photo', confidence: 0.8, caughtAt: 1_700_000_300_000 })
    await getDb().catches.update(second.id, { mediaId: photo.mediaId })
    const files = unzipSync(await bytesOf(await exportBackup()))
    expect(Object.keys(files).filter((name) => name.startsWith('media/'))).toHaveLength(2)
    const restored = await importAfterWipe(await exportBackup())
    expect(restored.mediaAdded).toBe(2)
    expect((await getCatch(second.id))?.mediaId).toBe(photo.mediaId)
  })
})

async function importAfterWipe(blob: Blob) {
  await deleteAllCatches()
  return importBackup(blob)
}

describe('importBackup round trip', () => {
  it('restores catches, photos and clips exactly, on a phone that lost everything', async () => {
    const before = await seed()
    const originals = await listCatches()
    const blob = await exportBackup()

    await deleteAllCatches()
    expect(await countCatches()).toBe(0)

    const report = await importBackup(blob)
    expect(report).toEqual({ total: 3, added: 3, skipped: 0, mediaAdded: 2, mediaMissing: 0 })
    expect(await listCatches()).toEqual(originals)

    const photo = await getMedia(before.photo.mediaId as string)
    expect(photo).toMatchObject({ kind: 'image', mime: 'image/jpeg' })
    expect(await bytesOf((photo as NonNullable<typeof photo>).blob)).toEqual(photoBytes)
    const clip = await getMedia(before.clip.mediaId as string)
    expect(clip).toMatchObject({ kind: 'audio', mime: 'audio/wav', durationS: 6.5 })
    expect(await bytesOf((clip as NonNullable<typeof clip>).blob)).toEqual(clipBytes)
    expect((clip as NonNullable<typeof clip>).blob.type).toBe('audio/wav')
  })

  it('keeps the photo\'s original save date', async () => {
    const { photo } = await seed()
    const created = (await getMedia(photo.mediaId as string))?.createdAt
    const blob = await exportBackup()
    await deleteAllCatches()
    await importBackup(blob)
    expect((await getMedia(photo.mediaId as string))?.createdAt).toBe(created)
  })

  it('survives a bigger Dex with many photos', async () => {
    for (let i = 0; i < 60; i++) {
      await addCatch(
        { speciesId: `species-${i % 20}`, method: i % 3 === 0 ? 'sound' : 'photo', confidence: 0.7 + (i % 30) / 100, caughtAt: 1_700_000_000_000 + i * 60_000 },
        i % 3 === 0
          ? { kind: 'audio', blob: new Blob([pattern(3000 + i, i)], { type: 'audio/wav' }), durationS: 3 }
          : { kind: 'image', blob: new Blob([pattern(4000 + i, i)], { type: 'image/jpeg' }) },
      )
    }
    const originals = await listCatches()
    const blob = await exportBackup()
    await deleteAllCatches()
    const report = await importBackup(blob)
    expect(report).toMatchObject({ total: 60, added: 60, skipped: 0, mediaAdded: 60, mediaMissing: 0 })
    expect(await listCatches()).toEqual(originals)
    for (const record of originals) {
      const media = await getMedia(record.mediaId as string)
      const index = Number(/\d+/.exec(record.speciesId)?.[0])
      expect(media?.blob.size).toBeGreaterThan(2999)
      expect(index).toBeGreaterThanOrEqual(0)
    }
  })

  it('reports progress after every catch', async () => {
    await seed()
    const blob = await exportBackup()
    await deleteAllCatches()
    const progress = vi.fn()
    await importBackup(blob, { onProgress: progress })
    expect(progress.mock.calls).toEqual([
      [1, 3],
      [2, 3],
      [3, 3],
    ])
  })
})

describe('importBackup merges by id', () => {
  it('adds nothing the second time, and nothing is duplicated', async () => {
    await seed()
    const blob = await exportBackup()
    const report = await importBackup(blob)
    expect(report).toEqual({ total: 3, added: 0, skipped: 3, mediaAdded: 0, mediaMissing: 0 })
    expect(await countCatches()).toBe(3)
    expect(await getDb().media.count()).toBe(2)
  })

  it('adds only the catches that are missing', async () => {
    const { clip } = await seed()
    const blob = await exportBackup()
    // The phone lost one catch, and got a new one that is not in the backup.
    const { deleteCatch } = await import('../../src/db')
    await deleteCatch(clip.id)
    const extra = await addCatch({ speciesId: 'sylvia-atricapilla', method: 'sound', confidence: 0.9 })
    const report = await importBackup(blob)
    expect(report).toEqual({ total: 3, added: 1, skipped: 2, mediaAdded: 1, mediaMissing: 0 })
    expect(await countCatches()).toBe(4)
    expect(await getCatch(clip.id)).toBeDefined()
    expect(await getCatch(extra.id)).toBeDefined()
    expect(await getMedia(clip.mediaId as string)).toBeDefined()
  })

  it('does not overwrite a catch that is already on the phone', async () => {
    const { photo } = await seed()
    const blob = await exportBackup()
    await getDb().catches.update(photo.id, { note: 'Změněno po záloze' })
    await importBackup(blob)
    expect((await getCatch(photo.id))?.note).toBe('Změněno po záloze')
  })
})

describe('importBackup rejects bad files without changing anything', () => {
  it('rejects something that is not a zip', async () => {
    await seed()
    await rejectsWith(new Blob(['hello, I am a text file']), 'not-a-zip')
    await rejectsWith(new Blob([new Uint8Array(0)]), 'not-a-zip')
    await rejectsWith(new Blob([pattern(2000, 5)]), 'not-a-zip')
    await rejectsWith(new Blob([JSON.stringify([goodCatch()])], { type: 'application/json' }), 'not-a-zip')
  })

  it('rejects a file far bigger than any backup before reading a byte of it (a huge file chosen by mistake must not kill the tab)', async () => {
    await seed()
    const huge = new Blob(['x'])
    Object.defineProperty(huge, 'size', { value: MAX_BACKUP_FILE_BYTES + 1 })
    const read = vi.spyOn(huge, 'arrayBuffer')
    const error = await rejectsWith(huge, 'not-a-zip')
    expect(error.message).toMatch(/MB/)
    expect(read).not.toHaveBeenCalled()
    // exactly at the limit is still read (and rejected here only because it is not a zip)
    const atLimit = new Blob(['x'])
    Object.defineProperty(atLimit, 'size', { value: MAX_BACKUP_FILE_BYTES })
    await rejectsWith(atLimit, 'not-a-zip')
    expect(MAX_BACKUP_FILE_BYTES).toBeGreaterThanOrEqual(256 * 1024 * 1024) // a backup of a big collection still fits
  })

  it('rejects a damaged zip', async () => {
    await seed()
    const bytes = await bytesOf(await exportBackup())
    await rejectsWith(new Blob([bytes.slice(0, Math.floor(bytes.length / 2))]), 'not-a-zip')
  })

  it('rejects a zip that BirdDex did not make', async () => {
    await rejectsWith(craft({ files: { 'readme.txt': strToU8('hi') } }), 'not-a-backup')
    await rejectsWith(craft({ manifest: { format: 'something-else', formatVersion: 1 }, catches: [] }), 'not-a-backup')
    await rejectsWith(craft({ manifest: [1, 2, 3], catches: [] }), 'not-a-backup')
  })

  it('rejects a backup from a newer version of the app, and one with no usable version', async () => {
    await rejectsWith(craft({ manifest: { ...goodManifest(), formatVersion: 99 }, catches: [] }), 'too-new')
    await rejectsWith(craft({ manifest: { ...goodManifest(), formatVersion: 'one' }, catches: [] }), 'malformed')
    await rejectsWith(craft({ manifest: { ...goodManifest(), formatVersion: 0 }, catches: [] }), 'malformed')
    await rejectsWith(craft({ manifest: { ...goodManifest(), formatVersion: 1.5 }, catches: [] }), 'malformed')
  })

  it('rejects a backup whose lists are missing or broken', async () => {
    await rejectsWith(craft({ manifest: goodManifest() }), 'malformed')
    await rejectsWith(craft({ manifest: goodManifest(), rawCatches: '{not json' }), 'malformed')
    await rejectsWith(craft({ manifest: goodManifest(), catches: { id: 'c1' } }), 'malformed')
    await rejectsWith(craft({ manifest: { ...goodManifest(), media: 'none' }, catches: [] }), 'malformed')
    await rejectsWith(craft({ manifest: { format: BACKUP_FORMAT, formatVersion: 1 }, catches: [] }), 'malformed')
  })

  it.each([
    ['no id', goodCatch({ id: undefined })],
    ['empty id', goodCatch({ id: '' })],
    ['no species', goodCatch({ speciesId: undefined })],
    ['unknown method', goodCatch({ method: 'telepathy' })],
    ['confidence above 1', goodCatch({ confidence: 1.5 })],
    ['confidence below 0', goodCatch({ confidence: -0.1 })],
    ['confidence as text', goodCatch({ confidence: '0.9' })],
    ['date as text', goodCatch({ caughtAt: 'yesterday' })],
    ['negative date', goodCatch({ caughtAt: -5 })],
    ['impossible latitude', goodCatch({ location: { lat: 91, lon: 14 } })],
    ['location without longitude', goodCatch({ location: { lat: 50 } })],
    ['location as text', goodCatch({ location: 'Praha' })],
    ['note as number', goodCatch({ note: 5 })],
    ['not an object', 'a catch'],
    ['null', null],
  ])('rejects a catch with %s', async (_label, bad) => {
    await seed()
    const error = await rejectsWith(craft({ manifest: goodManifest(), catches: [goodCatch({ id: 'fine' }), bad] }), 'malformed')
    expect(error.message).toContain('catches[1]')
  })

  it('rejects two catches with the same id', async () => {
    await rejectsWith(craft({ manifest: goodManifest(), catches: [goodCatch(), goodCatch()] }), 'malformed')
  })

  it('rejects media entries that could point outside the zip', async () => {
    for (const file of ['../evil.jpg', '/etc/passwd', 'media/../x.jpg', 'other/x.jpg', 'media/sub/x.jpg']) {
      const media = [{ id: 'm', kind: 'image', mime: 'image/jpeg', createdAt: 1, file, bytes: 3 }]
      await rejectsWith(craft({ manifest: goodManifest(media), catches: [goodCatch({ mediaId: 'm' })] }), 'malformed')
    }
    await rejectsWith(craft({ manifest: goodManifest([{ id: 'm', kind: 'video', mime: 'x', createdAt: 1, file: 'media/m.bin', bytes: 3 }]), catches: [] }), 'malformed')
  })
})

describe('importBackup and birds that are not in the Dex', () => {
  const blob = () =>
    craft({
      manifest: goodManifest(),
      catches: [
        goodCatch({ id: 'a', speciesId: 'parus-major', caughtAt: 10 }),
        goodCatch({ id: 'b', speciesId: 'does-not-exist', caughtAt: 20 }),
        goodCatch({ id: 'c', speciesId: 'old-renamed-id', caughtAt: 30 }),
        goodCatch({ id: 'd', speciesId: 'turdus-merula', caughtAt: 40 }),
      ],
    })

  it('leaves out catches of unknown birds and says how many, so "caught of 423" cannot exceed the total', async () => {
    const report = await importBackup(blob(), { knownSpeciesIds: new Set(['parus-major', 'turdus-merula']) })
    expect(report).toEqual({ total: 4, added: 2, skipped: 0, mediaAdded: 0, mediaMissing: 0, unknownSpecies: 2 })
    expect((await listCatches()).map((c) => c.id).sort()).toEqual(['a', 'd'])
    expect(await getCatch('b')).toBeUndefined()
  })

  it('does not count unknown birds as skipped duplicates, and still reports progress for them', async () => {
    const steps: number[] = []
    await importBackup(blob(), { knownSpeciesIds: new Set(['parus-major']), onProgress: (done) => steps.push(done) })
    expect(steps).toEqual([1, 2, 3, 4])
  })

  it('checks nothing when told not to, and sets no field when every bird is known', async () => {
    const all = await importBackup(blob(), { knownSpeciesIds: null })
    expect(all).toEqual({ total: 4, added: 4, skipped: 0, mediaAdded: 0, mediaMissing: 0 })
    await deleteAllCatches()
    const known = await importBackup(blob(), { knownSpeciesIds: new Set(['parus-major', 'does-not-exist', 'old-renamed-id', 'turdus-merula']) })
    expect('unknownSpecies' in known).toBe(false)
  })

  it('goes on without checking when the Dex list cannot be had (offline on the first visit)', async () => {
    // no fetch for /data/species.json works in this test: the default check is skipped, the import still works
    const report = await importBackup(blob())
    expect(report.added).toBe(4)
  })

  it('uses the Dex list the app already loaded', async () => {
    const { resetSpeciesCache } = await import('../../src/data/species')
    const species = (id: string) => ({ id, dexNumber: 1, scientificName: id, czechName: null, englishName: id, family: null, inCzechia: true, inEurope: true, rarity: 'common' as const, birdnetIndex: 0, wingclipIndex: null, wikiTitle: null })
    resetSpeciesCache([species('parus-major'), species('turdus-merula')])
    try {
      const report = await importBackup(blob())
      expect(report).toMatchObject({ added: 2, unknownSpecies: 2 })
    } finally {
      resetSpeciesCache()
    }
  })
})

describe('importBackup and missing pieces', () => {
  it('still restores a catch when its photo is not in the file, and says so', async () => {
    const media = [{ id: 'm1', kind: 'image', mime: 'image/jpeg', createdAt: 5, file: 'media/m1.jpg', bytes: 4 }]
    const blob = craft({ manifest: goodManifest(media), catches: [goodCatch({ id: 'c1', mediaId: 'm1' }), goodCatch({ id: 'c2', mediaId: 'ghost' })] })
    const report = await importBackup(blob)
    expect(report).toEqual({ total: 2, added: 2, skipped: 0, mediaAdded: 0, mediaMissing: 2 })
    expect(await getCatch('c1')).not.toHaveProperty('mediaId')
    expect(await getCatch('c2')).not.toHaveProperty('mediaId')
  })

  it('treats a photo whose size differs from the manifest as damaged', async () => {
    const media = [{ id: 'm1', kind: 'image', mime: 'image/jpeg', createdAt: 5, file: 'media/m1.jpg', bytes: 99 }]
    const blob = craft({ manifest: goodManifest(media), catches: [goodCatch({ mediaId: 'm1' })], files: { 'media/m1.jpg': new Uint8Array([1, 2, 3, 4]) } })
    expect(await importBackup(blob)).toMatchObject({ added: 1, mediaAdded: 0, mediaMissing: 1 })
    expect(await getDb().media.count()).toBe(0)
  })

  it('restores a photo that the manifest lists and the zip holds', async () => {
    const media = [{ id: 'm1', kind: 'image', mime: 'image/png', createdAt: 5, file: 'media/m1.png', bytes: 4 }]
    const blob = craft({ manifest: goodManifest(media), catches: [goodCatch({ mediaId: 'm1' })], files: { 'media/m1.png': new Uint8Array([1, 2, 3, 4]) } })
    expect(await importBackup(blob)).toMatchObject({ added: 1, mediaAdded: 1, mediaMissing: 0 })
    const saved = await getMedia('m1')
    expect(saved).toMatchObject({ kind: 'image', mime: 'image/png', createdAt: 5 })
    expect(Array.from(await bytesOf((saved as NonNullable<typeof saved>).blob))).toEqual([1, 2, 3, 4])
  })

  it('shares the photo of a catch that is already here instead of writing it twice', async () => {
    const { photo } = await seed()
    const blob = await exportBackup()
    const { deleteCatch } = await import('../../src/db')
    // Same media id stays because the other catch still uses it.
    const second = await addCatch({ speciesId: 'parus-major', method: 'photo', confidence: 0.8, caughtAt: 5 })
    await getDb().catches.update(second.id, { mediaId: photo.mediaId })
    await deleteCatch(photo.id)
    expect(await getMedia(photo.mediaId as string)).toBeDefined()
    const report = await importBackup(blob)
    expect(report.added).toBe(1)
    expect(report.mediaAdded).toBe(0)
    expect((await getCatch(photo.id))?.mediaId).toBe(photo.mediaId)
  })

  it('keeps only the fields BirdDex knows', async () => {
    // Written as raw text: only JSON.parse turns "__proto__" into an ordinary own property.
    const rawCatches =
      '[{"id":"c1","speciesId":"parus-major","caughtAt":1000,"method":"sound","confidence":0.9,' +
      '"evil":"<script>","__proto__":{"polluted":true},"location":{"lat":1,"lon":2,"extra":3}}]'
    await importBackup(craft({ manifest: goodManifest(), rawCatches }))
    const saved = await getCatch('c1')
    expect(saved).toEqual({ id: 'c1', speciesId: 'parus-major', caughtAt: 1000, method: 'sound', confidence: 0.9, location: { lat: 1, lon: 2 } })
    expect(Object.keys(saved as object).sort()).toEqual(['caughtAt', 'confidence', 'id', 'location', 'method', 'speciesId'])
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })

  it('stops with storage-full when the phone has no room, and tells what was restored so far', async () => {
    const blob = craft({ manifest: goodManifest(), catches: [goodCatch({ id: 'a', caughtAt: 1 }), goodCatch({ id: 'b', caughtAt: 2 }), goodCatch({ id: 'c', caughtAt: 3 })] })
    const db = getDb()
    const original = db.catches.add.bind(db.catches)
    let calls = 0
    const spy = vi.spyOn(db.catches, 'add').mockImplementation(((...args: Parameters<typeof original>) => {
      if (++calls === 2) return Promise.reject(new DOMException('no room', 'QuotaExceededError'))
      return original(...args)
    }) as typeof original)
    const error = await importBackup(blob).then(
      () => undefined,
      (e: unknown) => e,
    )
    spy.mockRestore()
    expect(error).toBeInstanceOf(BackupError)
    expect((error as BackupError).code).toBe('storage-full')
    expect((error as BackupError).report).toMatchObject({ total: 3, added: 1 })
    // Running the restore again continues where it stopped, because existing ids are skipped.
    expect(await importBackup(blob)).toMatchObject({ total: 3, added: 2, skipped: 1 })
    expect(await countCatches()).toBe(3)
  })
})

describe('parseCatchRecord', () => {
  it('accepts a complete record and an empty location accuracy', () => {
    const record = parseCatchRecord({ ...goodCatch(), location: { lat: 50, lon: 14, accuracyM: null }, placeName: 'Brno', note: 'x', mediaId: 'm' })
    expect(record).toEqual({ ...goodCatch(), location: { lat: 50, lon: 14 }, placeName: 'Brno', note: 'x', mediaId: 'm' })
  })
})

describe('file names', () => {
  it('names the backup after the date', () => {
    expect(backupFileName(new Date(2026, 9, 7))).toBe('birddex-backup-2026-10-07.zip')
    expect(backupFileName(new Date(2027, 0, 31))).toBe('birddex-backup-2027-01-31.zip')
  })

  it('picks an extension from the media type', () => {
    expect(extensionForMime('image/jpeg')).toBe('jpg')
    expect(extensionForMime('audio/wav; codecs=1')).toBe('wav')
    expect(extensionForMime('AUDIO/MP4')).toBe('m4a')
    expect(extensionForMime('application/x-unknown')).toBe('bin')
  })
})
