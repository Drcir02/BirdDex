// Small helpers that turn data into the words and addresses the Dex screens show. No React here.

import type { CatchMethod, CatchRecord, GeoPoint, Rarity } from '../../domain/types'
import { LOCALE } from '../../i18n'
import type { IconName } from '../../ui/icons'

const coordinate = new Intl.NumberFormat(LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false })

/** "50,08° s. š., 14,44° v. d." (north or south latitude, east or west longitude), rounded to about a kilometre. */
export function formatCoordinates(point: GeoPoint): string {
  const lat = `${coordinate.format(Math.abs(point.lat))}° ${point.lat < 0 ? 'j. š.' : 's. š.'}`
  const lon = `${coordinate.format(Math.abs(point.lon))}° ${point.lon < 0 ? 'z. d.' : 'v. d.'}`
  return `${lat}, ${lon}`
}

export function isValidPoint(point: GeoPoint | undefined): point is GeoPoint {
  return !!point && Number.isFinite(point.lat) && Number.isFinite(point.lon) && Math.abs(point.lat) <= 90 && Math.abs(point.lon) <= 180
}

/** A link that opens the place on OpenStreetMap, in any browser and on any phone. */
export function mapUrl(point: GeoPoint): string {
  const lat = point.lat.toFixed(5)
  const lon = point.lon.toFixed(5)
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=15/${lat}/${lon}`
}

export type PlaceLabel =
  | { kind: 'name'; text: string; point?: GeoPoint }
  | { kind: 'coordinates'; text: string; point: GeoPoint }
  | { kind: 'none' }

/** Where a catch happened: the place name when there is one, otherwise rounded coordinates, otherwise nothing. */
export function placeOf(record: Pick<CatchRecord, 'placeName' | 'location'>): PlaceLabel {
  const point = isValidPoint(record.location) ? record.location : undefined
  const name = record.placeName?.trim()
  if (name) return point ? { kind: 'name', text: name, point } : { kind: 'name', text: name }
  if (point) return { kind: 'coordinates', text: formatCoordinates(point), point }
  return { kind: 'none' }
}

/** "0:04", "1:05". */
export function formatClock(seconds: number): string {
  const whole = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}

const STARS: Readonly<Record<Rarity, number>> = { common: 1, uncommon: 2, rare: 3, epic: 4, legendary: 5 }

/** One star for a common bird up to five for a legendary one. */
export function starsFor(rarity: Rarity): number {
  return STARS[rarity]
}

export const METHOD_ICON: Readonly<Record<CatchMethod, IconName>> = { sound: 'microphone', photo: 'photo', live: 'live' }

/** Methods that save a picture; a sound catch saves a recording. */
export function savesImage(method: CatchMethod): boolean {
  return method !== 'sound'
}
