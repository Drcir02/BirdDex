// The name of the place of a catch ("Praha", "Hostivice"), looked up when the phone is online. Optional and best effort:
// without a name the catch simply shows its coordinates.
//
// Privacy: only a coarse position leaves the phone (rounded to two decimals, about a kilometre), and only at the moment
// the person confirms a catch (resolvePlaceName is called from the confirm handler of the result screen, never earlier). The service is OpenStreetMap's Nominatim (data (c) OpenStreetMap contributors, ODbL), asked in Czech.
// It allows light use from an app like this one; the usage policy asks for one request at a time, which one catch is.

import type { GeoPoint } from '../../domain/types'

export const PLACE_LOOKUP_URL = 'https://nominatim.openstreetmap.org/reverse'

/** The question for the service. The position is rounded on purpose. */
export function placeLookupUrl(point: Pick<GeoPoint, 'lat' | 'lon'>): string {
  const round = (value: number) => (Math.round(value * 100) / 100).toFixed(2)
  const query = new URLSearchParams({ format: 'jsonv2', lat: round(point.lat), lon: round(point.lon), zoom: '12', addressdetails: '1', 'accept-language': 'cs' })
  return `${PLACE_LOOKUP_URL}?${query.toString()}`
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

/** Smallest to biggest: the name of the village, town or city is what a person says when asked "where was that?". */
const ADDRESS_FIELDS = ['village', 'hamlet', 'town', 'city', 'municipality', 'suburb', 'city_district', 'county'] as const

const MAX_NAME_LENGTH = 80

/** Reads the answer of the service. Returns undefined when it names no place. */
export function parsePlaceName(json: unknown): string | undefined {
  if (!isRecord(json)) return undefined
  const address = isRecord(json.address) ? json.address : undefined
  const candidates: unknown[] = address ? ADDRESS_FIELDS.map((field) => address[field]) : []
  candidates.push(json.name)
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue
    const name = candidate.replace(/\s+/g, ' ').trim()
    if (name !== '') return name.length > MAX_NAME_LENGTH ? `${name.slice(0, MAX_NAME_LENGTH - 1)}…` : name
  }
  return undefined
}

export interface LookupOptions {
  fetchImpl?: typeof fetch
  /** Give up after this long. Default 4 seconds. */
  timeoutMs?: number
  /** Cancels the lookup (the screen went away). */
  signal?: AbortSignal
}

/** Asks for the name of the place. Never throws: no network, a slow or unhappy server, an odd answer all give undefined. */
export async function lookupPlaceName(point: Pick<GeoPoint, 'lat' | 'lon'>, options: LookupOptions = {}): Promise<string | undefined> {
  if (!Number.isFinite(point.lat) || !Number.isFinite(point.lon)) return undefined
  const fetchImpl = options.fetchImpl ?? (typeof fetch === 'function' ? fetch : undefined)
  if (!fetchImpl) return undefined
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 4000)
  const onAbort = () => controller.abort()
  options.signal?.addEventListener('abort', onAbort)
  try {
    if (options.signal?.aborted) return undefined
    const response = await fetchImpl(placeLookupUrl(point), { signal: controller.signal, headers: { Accept: 'application/json' } })
    if (!response.ok) return undefined
    return parsePlaceName((await response.json()) as unknown)
  } catch {
    return undefined
  } finally {
    clearTimeout(timer)
    options.signal?.removeEventListener('abort', onAbort)
  }
}

// ---------- A small memory, so a result screen that opens twice asks once ----------

const known = new Map<string, string | null>()

const keyOf = (point: Pick<GeoPoint, 'lat' | 'lon'>): string => `${point.lat.toFixed(2)},${point.lon.toFixed(2)}`

/** The name found earlier for this place (null: looked up and none found), or undefined when nothing is known yet. */
export function rememberedPlaceName(point: Pick<GeoPoint, 'lat' | 'lon'>): string | null | undefined {
  return known.get(keyOf(point))
}

export function rememberPlaceName(point: Pick<GeoPoint, 'lat' | 'lon'>, name: string | undefined): void {
  known.set(keyOf(point), name ?? null)
}

/** For tests. */
export function forgetPlaceNames(): void {
  known.clear()
}

/**
 * The name of the place for a catch that is being saved right now: the remembered one, else one question to the service
 * (skipped offline). Never throws; undefined means "no name", and the catch then shows its coordinates.
 */
export async function resolvePlaceName(point: Pick<GeoPoint, 'lat' | 'lon'> | undefined, options: LookupOptions = {}): Promise<string | undefined> {
  if (!point) return undefined
  const remembered = rememberedPlaceName(point)
  if (remembered !== undefined) return remembered ?? undefined
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return undefined
  const name = await lookupPlaceName(point, { timeoutMs: 3000, ...options })
  rememberPlaceName(point, name)
  return name
}
