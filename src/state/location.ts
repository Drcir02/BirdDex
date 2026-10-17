// Where the phone is, for saving the place of a catch and for the bird-sound location filter.
//
// getCurrentLocation never throws and never waits longer than the caller allows: no permission, no GPS, an old
// browser, a permission prompt nobody answers, all give `undefined`. The caller decides when to ask: the first call
// is what makes the browser show its permission prompt.

import type { GeoPoint } from '../domain/types'

/** A fix is reused for this long, so a scan screen and a result screen asking in turn do not wake the GPS twice. */
export const LOCATION_CACHE_MS = 5 * 60_000

/** After the user said no, do not ask the browser again for this long. */
const DENIED_MS = 5 * 60_000

/** The browser keeps trying this long in the background, even if the caller stopped waiting earlier. */
const BACKGROUND_TIMEOUT_MS = 20_000

const DEFAULT_WAIT_MS = 8000

let cached: { point: GeoPoint; at: number } | undefined
let deniedAt: number | undefined
let inFlight: Promise<GeoPoint | undefined> | undefined

/** The last fix, if it is younger than 5 minutes. Never asks the browser. */
export function getCachedLocation(): GeoPoint | undefined {
  return cached && Date.now() - cached.at < LOCATION_CACHE_MS ? { ...cached.point } : undefined
}

function toPoint(position: GeolocationPosition): GeoPoint | undefined {
  const { latitude, longitude, accuracy } = position.coords
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return undefined
  const point: GeoPoint = { lat: latitude, lon: longitude }
  if (Number.isFinite(accuracy)) point.accuracyM = Math.round(accuracy)
  return point
}

function askBrowser(geolocation: Geolocation): Promise<GeoPoint | undefined> {
  return new Promise((resolve) => {
    try {
      geolocation.getCurrentPosition(
        (position) => {
          const point = toPoint(position)
          if (point) cached = { point, at: Date.now() }
          resolve(point)
        },
        (error) => {
          // 1 = the user (or the system settings) said no.
          if (error.code === 1) deniedAt = Date.now()
          resolve(undefined)
        },
        { enableHighAccuracy: false, timeout: BACKGROUND_TIMEOUT_MS, maximumAge: 60_000 },
      )
    } catch {
      resolve(undefined)
    }
  })
}

/**
 * The phone's position, or undefined when it is not available within `timeoutMs` (default 8 seconds).
 * A fix that arrives after the caller gave up is still remembered for the next call.
 */
export async function getCurrentLocation(options: { timeoutMs?: number } = {}): Promise<GeoPoint | undefined> {
  try {
    const fresh = getCachedLocation()
    if (fresh) return fresh
    if (deniedAt !== undefined && Date.now() - deniedAt < DENIED_MS) return undefined

    const geolocation = typeof navigator === 'undefined' ? undefined : navigator.geolocation
    if (!geolocation) return undefined

    // One request at a time: callers that arrive while the browser is still asking share its answer (and its prompt).
    if (!inFlight) {
      const request: Promise<GeoPoint | undefined> = askBrowser(geolocation).finally(() => {
        if (inFlight === request) inFlight = undefined
      })
      inFlight = request
    }
    const waiting = inFlight
    const timeoutMs = Math.max(0, options.timeoutMs ?? DEFAULT_WAIT_MS)
    let timer: ReturnType<typeof setTimeout> | undefined
    const giveUp = new Promise<undefined>((resolve) => {
      timer = setTimeout(() => resolve(undefined), timeoutMs)
    })
    try {
      const point = await Promise.race([waiting, giveUp])
      return point ? { ...point } : undefined
    } finally {
      clearTimeout(timer)
    }
  } catch {
    return undefined
  }
}

/** For tests: forget the remembered fix and any refusal. */
export function resetLocationForTests(): void {
  cached = undefined
  deniedAt = undefined
  inFlight = undefined
}
