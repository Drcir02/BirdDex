// When and where a photo was taken, read from its EXIF block (JPEG only), so a picture from the library is identified
// and saved with its own date and place, not with the phone's place of right now.
// Pure functions on bytes, like imageHeader.ts. Nothing here throws: a missing or damaged block means "unknown".

import type { GeoPoint } from '../../domain/types'
import { HEADER_BYTES } from './imageHeader'

export interface ExifMeta {
  /** Milliseconds since 1970 of the moment the picture was taken (the camera's clock is read as the phone's local time). */
  takenAt?: number
  location?: GeoPoint
}

const TAG_DATETIME = 0x0132
const TAG_EXIF_IFD = 0x8769
const TAG_DATETIME_ORIGINAL = 0x9003
const TAG_GPS_IFD = 0x8825

/** Bytes per value of the TIFF field types (BYTE, ASCII, SHORT, LONG, RATIONAL, UNDEFINED, SLONG, SRATIONAL). */
const TYPE_BYTES: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 }

interface Tiff {
  view: DataView
  start: number
  end: number
  little: boolean
}

interface Entry {
  type: number
  count: number
  /** Offset of the value from the start of the TIFF block. */
  valueAt: number
}

function entriesOf(tiff: Tiff, ifdOffset: number): Map<number, Entry> {
  const { view, start, end, little } = tiff
  const entries = new Map<number, Entry>()
  const ifd = start + ifdOffset
  if (ifdOffset < 8 || ifd + 2 > end) return entries
  const count = view.getUint16(ifd, little)
  for (let i = 0; i < count; i++) {
    const at = ifd + 2 + i * 12
    if (at + 12 > end) break
    const type = view.getUint16(at + 2, little)
    const n = view.getUint32(at + 4, little)
    const size = (TYPE_BYTES[type] ?? 1) * n
    const valueAt = size <= 4 ? at + 8 - start : view.getUint32(at + 8, little)
    entries.set(view.getUint16(at, little), { type, count: n, valueAt })
  }
  return entries
}

function asciiOf(tiff: Tiff, entry: Entry | undefined): string | undefined {
  if (!entry || entry.type !== 2 || entry.count < 1 || entry.count > 64) return undefined
  const from = tiff.start + entry.valueAt
  if (from + entry.count > tiff.end) return undefined
  let text = ''
  for (let i = 0; i < entry.count; i++) {
    const code = tiff.view.getUint8(from + i)
    if (code === 0) break
    text += String.fromCharCode(code)
  }
  return text
}

/** "2026:10:17 09:15:30" in the phone's local time. */
export function parseExifDate(text: string | undefined): number | undefined {
  const match = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(text ?? '')
  if (!match) return undefined
  const [year, month, day, hour, minute, second] = match.slice(1).map(Number) as [number, number, number, number, number, number]
  if (year < 1990 || month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) return undefined
  const time = new Date(year, month - 1, day, hour, minute, second).getTime()
  return Number.isFinite(time) ? time : undefined
}

function degreesOf(tiff: Tiff, entry: Entry | undefined): number | undefined {
  if (!entry || entry.type !== 5 || entry.count !== 3) return undefined
  const from = tiff.start + entry.valueAt
  if (from + 24 > tiff.end) return undefined
  const part = (i: number): number | undefined => {
    const numerator = tiff.view.getUint32(from + i * 8, tiff.little)
    const denominator = tiff.view.getUint32(from + i * 8 + 4, tiff.little)
    return denominator === 0 ? undefined : numerator / denominator
  }
  const degrees = part(0)
  const minutes = part(1)
  const seconds = part(2)
  if (degrees === undefined || minutes === undefined || seconds === undefined) return undefined
  return degrees + minutes / 60 + seconds / 3600
}

function locationOf(tiff: Tiff, gps: Map<number, Entry>): GeoPoint | undefined {
  const latitude = degreesOf(tiff, gps.get(2))
  const longitude = degreesOf(tiff, gps.get(4))
  if (latitude === undefined || longitude === undefined) return undefined
  const lat = asciiOf(tiff, gps.get(1))?.startsWith('S') ? -latitude : latitude
  const lon = asciiOf(tiff, gps.get(3))?.startsWith('W') ? -longitude : longitude
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return undefined
  // Some phones write 0, 0 when they have no position.
  if (lat === 0 && lon === 0) return undefined
  return { lat, lon }
}

function parseTiff(view: DataView, start: number, end: number): ExifMeta {
  if (end - start < 8) return {}
  const order = view.getUint16(start)
  const little = order === 0x4949
  if (!little && order !== 0x4d4d) return {}
  if (view.getUint16(start + 2, little) !== 42) return {}
  const tiff: Tiff = { view, start, end, little }
  const main = entriesOf(tiff, view.getUint32(start + 4, little))
  const meta: ExifMeta = {}
  const exifPointer = main.get(TAG_EXIF_IFD)
  const exif = exifPointer ? entriesOf(tiff, view.getUint32(start + exifPointer.valueAt, little)) : undefined
  meta.takenAt = parseExifDate(asciiOf(tiff, exif?.get(TAG_DATETIME_ORIGINAL))) ?? parseExifDate(asciiOf(tiff, main.get(TAG_DATETIME)))
  const gpsPointer = main.get(TAG_GPS_IFD)
  if (gpsPointer) {
    const location = locationOf(tiff, entriesOf(tiff, view.getUint32(start + gpsPointer.valueAt, little)))
    if (location) meta.location = location
  }
  if (meta.takenAt === undefined) delete meta.takenAt
  return meta
}

/** The date and place in the EXIF block of a JPEG (the first bytes of the file are enough). {} for anything else. */
export function parseExifMeta(bytes: Uint8Array): ExifMeta {
  try {
    if (bytes.length < 12 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return {}
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    let at = 2
    while (at + 4 <= bytes.length) {
      if (bytes[at] !== 0xff) {
        at++
        continue
      }
      const marker = bytes[at + 1] ?? 0
      if (marker === 0xff) {
        at++
        continue
      }
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        at += 2
        continue
      }
      const length = view.getUint16(at + 2)
      if (length < 2 || marker === 0xda) return {}
      if (marker === 0xe1 && at + 10 <= bytes.length && bytes[at + 4] === 0x45 && bytes[at + 5] === 0x78 && bytes[at + 6] === 0x69 && bytes[at + 7] === 0x66) {
        return parseTiff(view, at + 10, Math.min(bytes.length, at + 2 + length))
      }
      at += 2 + length
    }
  } catch {
    // A read past the end: the file is cut short.
  }
  return {}
}

/** Reads the EXIF date and place of a picked file. Never throws. */
export async function readExifMeta(file: Blob): Promise<ExifMeta> {
  try {
    const buffer = await file.slice(0, HEADER_BYTES).arrayBuffer()
    return parseExifMeta(new Uint8Array(buffer))
  } catch {
    return {}
  }
}

/** A picture older than this is not "right now", so the phone's present place does not belong to it. */
export const FRESH_PHOTO_MS = 6 * 60 * 60 * 1000

export interface PhotoContext {
  /** When the bird was seen: the time the photo was taken, or now. */
  at: number
  /** Where: the place in the photo, else the phone's place when the photo is fresh, else nothing. */
  location: GeoPoint | undefined
  /** True when the phone's own place may be used (a fresh photo that carries no place of its own). */
  usePhoneLocation: boolean
}

/** Decides which date and place belong to a photo that was just chosen. */
export function photoContext(exif: ExifMeta, now: number, phone: GeoPoint | undefined): PhotoContext {
  const taken = exif.takenAt !== undefined && exif.takenAt <= now + 24 * 60 * 60 * 1000 ? Math.min(exif.takenAt, now) : undefined
  const fresh = taken === undefined || now - taken < FRESH_PHOTO_MS
  const usePhoneLocation = exif.location === undefined && fresh
  return { at: taken ?? now, location: exif.location ?? (usePhoneLocation ? phone : undefined), usePhoneLocation }
}
