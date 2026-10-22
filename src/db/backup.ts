// Backup and restore as one file. The file is a zip (made with fflate):
//   manifest.json   what this is: format, app version, date, and the list of saved photos and clips
//   catches.json    every catch (a JSON list of CatchRecord)
//   media/<id>.<ext>  the photos and clips, as they were saved
//
// Restoring merges: a catch that already exists (same id) is left alone, the others are added. Nothing is
// written until the whole file has been checked, so a damaged or foreign file changes nothing.

import { strFromU8, strToU8, unzipSync, Zip, ZipDeflate, ZipPassThrough, type UnzipFileInfo } from 'fflate'
import { getLoadedSpecies, loadSpecies } from '../data/species'
import type { CatchMethod, CatchRecord, GeoPoint, MediaRecord } from '../domain/types'
import { getDb } from './database'
import { isQuotaExceededError } from './errors'

export const BACKUP_FORMAT = 'birddex-backup'
export const BACKUP_FORMAT_VERSION = 1

export type BackupErrorCode =
  /** Not a zip file at all, or a damaged one. */
  | 'not-a-zip'
  /** A zip, but not made by BirdDex. */
  | 'not-a-backup'
  /** Made by a newer BirdDex than this one. */
  | 'too-new'
  /** A BirdDex backup whose content is broken. */
  | 'malformed'
  /** The phone ran out of room while restoring. `report` tells what was saved before that. */
  | 'storage-full'

export class BackupError extends Error {
  readonly code: BackupErrorCode
  /** Only for 'storage-full': what had been restored when the room ran out. */
  readonly report?: ImportReport

  constructor(code: BackupErrorCode, message: string, options?: { cause?: unknown; report?: ImportReport }) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'BackupError'
    this.code = code
    this.report = options?.report
  }
}

export interface ImportReport {
  /** Catches in the file. */
  total: number
  /** New catches that were saved. */
  added: number
  /** Catches that were already here (same id) and stayed as they were. */
  skipped: number
  /** Photos and clips saved along with the new catches. */
  mediaAdded: number
  /** New catches saved without their photo or clip, because the file did not have it. */
  mediaMissing: number
  /**
   * Catches of birds that are not in this version's Dex (an id that was renamed or removed by a Dex update). They are left out:
   * the Dex could neither show nor delete them, and they would push "caught of 423" over the total. Only set when there are some.
   */
  unknownSpecies?: number
}

interface BackupMediaEntry {
  id: string
  kind: 'image' | 'audio'
  mime: string
  createdAt: number
  durationS?: number
  /** Path of the file inside the zip. */
  file: string
  bytes: number
}

interface BackupManifest {
  format: typeof BACKUP_FORMAT
  formatVersion: number
  appVersion: string
  /** ISO date and time. */
  exportedAt: string
  counts: { catches: number; media: number }
  media: BackupMediaEntry[]
}

const MANIFEST_FILE = 'manifest.json'
const CATCHES_FILE = 'catches.json'

// Generous limits that still stop a hostile or broken file from exhausting the phone's memory.
const MAX_JSON_BYTES = 64 * 1024 * 1024
const MAX_MEDIA_BYTES = 256 * 1024 * 1024
const MAX_CATCHES = 200_000
/**
 * The largest backup file that is read. The whole zip is held in memory (and each photo again while it is unpacked), which a
 * phone tab survives for a few hundred catches (a backup of 2000 catches with 150 KB photos is 308 MB, and that took 5 s and a
 * lot of memory on a desktop) but not for a huge file picked by mistake. Anything bigger gets the calm "not a backup" message.
 */
export const MAX_BACKUP_FILE_BYTES = 300 * 1024 * 1024
/** How long importing waits for the Dex list (to check the species) before it goes on without checking. */
const SPECIES_WAIT_MS = 4000
const METHODS: readonly CatchMethod[] = ['sound', 'photo', 'live']

const appVersion = (): string => (typeof __APP_VERSION__ === 'undefined' ? 'dev' : __APP_VERSION__)

async function blobToBytes(blob: Blob): Promise<Uint8Array> {
  if (typeof blob.arrayBuffer === 'function') return new Uint8Array(await blob.arrayBuffer())
  return new Uint8Array(await new Response(blob).arrayBuffer())
}

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/heic': 'heic',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/wave': 'wav',
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/aac': 'aac',
}

export function extensionForMime(mime: string): string {
  return EXTENSIONS[mime.split(';')[0].trim().toLowerCase()] ?? 'bin'
}

/** Already-compressed formats are stored as they are; compressing them again would only cost time. */
const alreadyCompressed = (mime: string) => /^(image\/(jpeg|png|webp|avif|heic)|audio\/(mpeg|mp4|aac|ogg|webm))/i.test(mime)

/** For example "birddex-backup-2026-10-17.zip". */
export function backupFileName(date: Date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `birddex-backup-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.zip`
}

// ---------- Export ----------

/** Packs every catch with its photo or clip into one zip file. `onProgress(done, total)` is called after every catch. */
export async function exportBackup(options: { now?: Date; onProgress?: (done: number, total: number) => void } = {}): Promise<Blob> {
  const db = getDb()
  const catches = await db.catches.orderBy('caughtAt').toArray()

  const chunks: Uint8Array[] = []
  let zipError: Error | null = null
  const zip = new Zip((error, chunk) => {
    if (error) zipError = error
    else chunks.push(chunk)
  })
  const addFile = (name: string, data: Uint8Array, compress: boolean) => {
    const file = compress ? new ZipDeflate(name, { level: 6 }) : new ZipPassThrough(name)
    zip.add(file)
    file.push(data, true)
  }

  const mediaEntries: BackupMediaEntry[] = []
  const savedMedia = new Set<string>()
  const usedNames = new Set<string>()
  const exported: CatchRecord[] = []

  // One photo or clip at a time, so the phone never holds them all in memory at once.
  for (const record of catches) {
    const copy: CatchRecord = { ...record }
    if (record.mediaId && !savedMedia.has(record.mediaId)) {
      const media = await db.media.get(record.mediaId)
      if (media) {
        const base = media.id.replace(/[^A-Za-z0-9._-]/g, '_')
        let name = `media/${base}.${extensionForMime(media.mime)}`
        for (let n = 2; usedNames.has(name); n++) name = `media/${base}-${n}.${extensionForMime(media.mime)}`
        usedNames.add(name)
        const bytes = await blobToBytes(media.blob)
        addFile(name, bytes, !alreadyCompressed(media.mime))
        const entry: BackupMediaEntry = {
          id: media.id,
          kind: media.kind,
          mime: media.mime,
          createdAt: media.createdAt,
          file: name,
          bytes: bytes.byteLength,
        }
        if (media.durationS !== undefined) entry.durationS = media.durationS
        mediaEntries.push(entry)
        savedMedia.add(media.id)
      }
    }
    // A catch whose photo or clip has gone missing is exported without the reference, so the backup stays consistent.
    if (record.mediaId && !savedMedia.has(record.mediaId)) delete copy.mediaId
    exported.push(copy)
    options.onProgress?.(exported.length, catches.length)
  }

  const manifest: BackupManifest = {
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    appVersion: appVersion(),
    exportedAt: (options.now ?? new Date()).toISOString(),
    counts: { catches: exported.length, media: mediaEntries.length },
    media: mediaEntries,
  }
  addFile(CATCHES_FILE, strToU8(JSON.stringify(exported, null, 1)), true)
  addFile(MANIFEST_FILE, strToU8(JSON.stringify(manifest, null, 1)), true)
  zip.end()

  if (zipError) throw zipError
  return new Blob(chunks as BlobPart[], { type: 'application/zip' })
}

// ---------- Import ----------

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const malformed = (message: string) => new BackupError('malformed', message)

function requireString(source: Record<string, unknown>, key: string, where: string, maxLength = 2000): string {
  const value = source[key]
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength) throw malformed(`${where}: "${key}" must be a short text`)
  return value
}

function optionalString(source: Record<string, unknown>, key: string, where: string, maxLength = 20_000): string | undefined {
  const value = source[key]
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string' || value.length > maxLength) throw malformed(`${where}: "${key}" must be a text`)
  return value
}

function requireNumber(source: Record<string, unknown>, key: string, where: string, min: number, max: number): number {
  const value = source[key]
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw malformed(`${where}: "${key}" must be a number from ${min} to ${max}`)
  }
  return value
}

function parseLocation(value: unknown, where: string): GeoPoint | undefined {
  if (value === undefined || value === null) return undefined
  if (!isRecord(value)) throw malformed(`${where}: "location" must be an object`)
  const point: GeoPoint = {
    lat: requireNumber(value, 'lat', `${where}.location`, -90, 90),
    lon: requireNumber(value, 'lon', `${where}.location`, -180, 180),
  }
  if (value.accuracyM !== undefined && value.accuracyM !== null) {
    point.accuracyM = requireNumber(value, 'accuracyM', `${where}.location`, 0, 1e9)
  }
  return point
}

/** Checks one catch from the file and keeps only the fields BirdDex knows. */
export function parseCatchRecord(value: unknown, where = 'catch'): CatchRecord {
  if (!isRecord(value)) throw malformed(`${where} must be an object`)
  const method = value.method
  if (typeof method !== 'string' || !METHODS.includes(method as CatchMethod)) throw malformed(`${where}: "method" must be sound, photo or live`)
  const record: CatchRecord = {
    id: requireString(value, 'id', where, 200),
    speciesId: requireString(value, 'speciesId', where, 200),
    caughtAt: requireNumber(value, 'caughtAt', where, 0, 8.64e15),
    method: method as CatchMethod,
    confidence: requireNumber(value, 'confidence', where, 0, 1),
  }
  const location = parseLocation(value.location, where)
  if (location) record.location = location
  const placeName = optionalString(value, 'placeName', where, 500)
  if (placeName) record.placeName = placeName
  const note = optionalString(value, 'note', where)
  if (note) record.note = note
  const mediaId = optionalString(value, 'mediaId', where, 200)
  if (mediaId) record.mediaId = mediaId
  copyBirdPoints(value, record)
  return record
}

const inRange = (value: unknown, min: number, max: number): value is number => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max

/**
 * The BirdPoints of a catch, when the file has them. A backup from before BP has none, and a field that does not look right is
 * left out (the app then works the BP out again) rather than refusing the whole backup.
 */
function copyBirdPoints(source: Record<string, unknown>, record: CatchRecord): void {
  const { bp, bpBase, bpQ, bpLuck, bpRange, bpFactors, bpLegacy } = source
  if (!inRange(bp, 0, 1e6) || !inRange(bpQ, 0, 1) || !inRange(bpLuck, -1, 1)) return
  record.bp = Math.round(bp)
  record.bpQ = bpQ
  record.bpLuck = bpLuck
  if (inRange(bpBase, 0, 1e6)) record.bpBase = Math.round(bpBase)
  if (Array.isArray(bpRange) && bpRange.length === 2 && inRange(bpRange[0], 0, 1e6) && inRange(bpRange[1], 0, 1e6) && bpRange[0] < bpRange[1]) record.bpRange = [bpRange[0], bpRange[1]]
  if (Array.isArray(bpFactors) && bpFactors.length === 5 && bpFactors.every((factor) => inRange(factor, 0, 1))) record.bpFactors = [...(bpFactors as number[])]
  if (bpLegacy === true) record.bpLegacy = true
}

function parseMediaEntry(value: unknown, where: string): BackupMediaEntry {
  if (!isRecord(value)) throw malformed(`${where} must be an object`)
  const kind = value.kind
  if (kind !== 'image' && kind !== 'audio') throw malformed(`${where}: "kind" must be image or audio`)
  const file = requireString(value, 'file', where, 300)
  if (!/^media\/[A-Za-z0-9._-]+$/.test(file) || file.includes('..')) throw malformed(`${where}: "file" is not a safe path`)
  const entry: BackupMediaEntry = {
    id: requireString(value, 'id', where, 200),
    kind,
    mime: requireString(value, 'mime', where, 200),
    createdAt: requireNumber(value, 'createdAt', where, 0, 8.64e15),
    file,
    bytes: requireNumber(value, 'bytes', where, 0, MAX_MEDIA_BYTES),
  }
  if (value.durationS !== undefined && value.durationS !== null) entry.durationS = requireNumber(value, 'durationS', where, 0, 1e6)
  return entry
}

function parseJson(bytes: Uint8Array, what: string): unknown {
  try {
    return JSON.parse(strFromU8(bytes))
  } catch (error) {
    throw new BackupError('malformed', `${what} is not valid JSON`, { cause: error })
  }
}

/** Reads the names and sizes of the files in the zip without unpacking any of them. */
function listZip(zipBytes: Uint8Array): Map<string, UnzipFileInfo> {
  const found = new Map<string, UnzipFileInfo>()
  try {
    unzipSync(zipBytes, {
      filter: (info) => {
        found.set(info.name, info)
        return false
      },
    })
  } catch (error) {
    throw new BackupError('not-a-zip', 'This is not a zip file, or it is damaged', { cause: error })
  }
  return found
}

/** Unpacks one file. Returns undefined when it is not there or cannot be unpacked. */
function unpack(zipBytes: Uint8Array, directory: Map<string, UnzipFileInfo>, name: string, maxBytes: number): Uint8Array | undefined {
  const info = directory.get(name)
  if (!info || info.originalSize > maxBytes) return undefined
  try {
    return unzipSync(zipBytes, { filter: (candidate) => candidate.name === name })[name]
  } catch {
    return undefined
  }
}

/** The ids of the Dex, or undefined when the list cannot be had quickly (offline on the very first visit): then nothing is checked. */
async function dexSpeciesIds(): Promise<ReadonlySet<string> | undefined> {
  try {
    const loaded = getLoadedSpecies()
    if (loaded) return new Set(loaded.map((species) => species.id))
    let timer: ReturnType<typeof setTimeout> | undefined
    const list = await Promise.race([
      loadSpecies(),
      new Promise<undefined>((resolve) => {
        timer = setTimeout(() => resolve(undefined), SPECIES_WAIT_MS)
      }),
    ])
    if (timer !== undefined) clearTimeout(timer)
    return list ? new Set(list.map((species) => species.id)) : undefined
  } catch {
    return undefined
  }
}

/**
 * Restores catches from a backup file. Merges with what is already on the phone: existing catches (same id) stay as
 * they are. Throws a BackupError for a file that is not a good BirdDex backup; in that case nothing has been changed.
 */
export async function importBackup(
  file: Blob,
  options: {
    onProgress?: (done: number, total: number) => void
    /** The ids of the birds in the Dex; catches of other birds are skipped. Default: the Dex list of the app. `null` checks nothing. */
    knownSpeciesIds?: ReadonlySet<string> | null
  } = {},
): Promise<ImportReport> {
  if (file.size > MAX_BACKUP_FILE_BYTES) {
    throw new BackupError('not-a-zip', `The file is ${Math.round(file.size / 1048576)} MB, far more than a BirdDex backup holds`)
  }
  let zipBytes: Uint8Array
  try {
    zipBytes = await blobToBytes(file)
  } catch (error) {
    throw new BackupError('not-a-zip', 'The file could not be read', { cause: error })
  }
  const directory = listZip(zipBytes)

  // ----- Check everything before touching the database -----
  if (!directory.has(MANIFEST_FILE)) throw new BackupError('not-a-backup', 'This zip file was not made by BirdDex')
  const manifestBytes = unpack(zipBytes, directory, MANIFEST_FILE, MAX_JSON_BYTES)
  if (!manifestBytes) throw malformed('The manifest cannot be read')
  const manifestJson = parseJson(manifestBytes, MANIFEST_FILE)
  if (!isRecord(manifestJson) || manifestJson.format !== BACKUP_FORMAT) throw new BackupError('not-a-backup', 'This zip file was not made by BirdDex')
  const version = manifestJson.formatVersion
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) throw malformed('The backup has no valid format version')
  if (version > BACKUP_FORMAT_VERSION) throw new BackupError('too-new', 'This backup was made by a newer version of BirdDex')

  const mediaList = manifestJson.media
  if (!Array.isArray(mediaList)) throw malformed('The manifest has no list of photos and clips')
  const mediaById = new Map<string, BackupMediaEntry>()
  mediaList.forEach((item, index) => {
    const entry = parseMediaEntry(item, `media[${index}]`)
    mediaById.set(entry.id, entry)
  })

  const catchesBytes = unpack(zipBytes, directory, CATCHES_FILE, MAX_JSON_BYTES)
  if (!catchesBytes) throw malformed('catches.json is missing or cannot be read')
  const catchesJson = parseJson(catchesBytes, CATCHES_FILE)
  if (!Array.isArray(catchesJson)) throw malformed('catches.json must be a list')
  if (catchesJson.length > MAX_CATCHES) throw malformed('catches.json has too many entries')
  const records = catchesJson.map((item, index) => parseCatchRecord(item, `catches[${index}]`))
  const seen = new Set<string>()
  for (const record of records) {
    if (seen.has(record.id)) throw malformed(`catches.json lists the id ${record.id} twice`)
    seen.add(record.id)
  }

  const known = options.knownSpeciesIds === undefined ? await dexSpeciesIds() : options.knownSpeciesIds

  // ----- Merge, one catch at a time (each with its media in one transaction) -----
  const db = getDb()
  const report: ImportReport = { total: records.length, added: 0, skipped: 0, mediaAdded: 0, mediaMissing: 0 }
  const ordered = [...records].sort((a, b) => a.caughtAt - b.caughtAt)
  let done = 0
  try {
    for (const record of ordered) {
      if (known && !known.has(record.speciesId)) {
        report.unknownSpecies = (report.unknownSpecies ?? 0) + 1
      } else if (await db.catches.get(record.id)) {
        report.skipped++
      } else {
        let media: MediaRecord | undefined
        if (record.mediaId && !(await db.media.get(record.mediaId))) {
          const entry = mediaById.get(record.mediaId)
          const bytes = entry && unpack(zipBytes, directory, entry.file, MAX_MEDIA_BYTES)
          if (entry && bytes && bytes.byteLength === entry.bytes) {
            media = { id: entry.id, kind: entry.kind, mime: entry.mime, blob: new Blob([bytes as BlobPart], { type: entry.mime }), createdAt: entry.createdAt }
            if (entry.durationS !== undefined) media.durationS = entry.durationS
          } else {
            delete record.mediaId
            report.mediaMissing++
          }
        }
        await db.transaction('rw', db.catches, db.media, async () => {
          if (media) await db.media.add(media)
          await db.catches.add(record)
        })
        report.added++
        if (media) report.mediaAdded++
      }
      options.onProgress?.(++done, ordered.length)
    }
  } catch (error) {
    if (isQuotaExceededError(error)) {
      throw new BackupError('storage-full', 'The phone has no room left to restore everything', { cause: error, report })
    }
    throw error
  }
  return report
}
