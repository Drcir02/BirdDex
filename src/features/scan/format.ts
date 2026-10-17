// Small formatting helpers of the scan screens. All pure, all unit-tested.

import type { GeoPoint } from '../../domain/types'
import { formatNumber, t } from '../../i18n'

/** 7300 ms becomes "0:07", 65 000 ms becomes "1:05". Negative or broken values count as zero. */
export function formatElapsed(ms: number): string {
  const total = Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1000) : 0
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

/** Whole megabytes (1 MB = 1 000 000 bytes, as file sizes are quoted), for "31 z 90 MB". */
export function wholeMegabytes(bytes: number): number {
  return Number.isFinite(bytes) && bytes > 0 ? Math.round(bytes / 1_000_000) : 0
}

/** A friendly rounded size for "asi 90 MB": the nearest 5 MB, never zero. */
export function approxMegabytes(bytes: number): number {
  if (!Number.isFinite(bytes) || bytes <= 0) return 0
  return Math.max(5, Math.round(bytes / 1_000_000 / 5) * 5)
}

/** "50,08° S, 14,43° V": two decimals are about a kilometre, which is plenty to show and not too exact to read out. */
export function formatCoordinates(point: Pick<GeoPoint, 'lat' | 'lon'>): string {
  const lat = `${formatNumber(Math.abs(Math.round(point.lat * 100) / 100))}° ${point.lat >= 0 ? t('result.meta.north') : t('result.meta.south')}`
  const lon = `${formatNumber(Math.abs(Math.round(point.lon * 100) / 100))}° ${point.lon >= 0 ? t('result.meta.east') : t('result.meta.west')}`
  return t('result.meta.coordinates', { lat, lon })
}

export type PlaceDescription =
  | { kind: 'name'; text: string }
  | { kind: 'coordinates'; text: string }
  | { kind: 'unknown'; text: string }

/** What the result screen says about the place: its name when it is known, otherwise the coordinates, otherwise "unknown". */
export function describePlace(location: GeoPoint | undefined, placeName?: string): PlaceDescription {
  const name = placeName?.trim()
  if (name) return { kind: 'name', text: name }
  if (location && Number.isFinite(location.lat) && Number.isFinite(location.lon)) return { kind: 'coordinates', text: formatCoordinates(location) }
  return { kind: 'unknown', text: t('result.meta.unknownPlace') }
}
