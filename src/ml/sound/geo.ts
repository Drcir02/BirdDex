// BirdNET's location filter ("geo model"): which birds live around here at this time of year.
//
// The model takes [latitude, longitude, week] and returns 6522 numbers between 0 and 1, one per BirdNET output: how
// likely that bird is to be reported there in that week. BirdNET Analyzer keeps the birds at 0.03 or above
// (LOCATION_FILTER_THRESHOLD in its config.py) and throws the rest away. We use the same list but do not throw the
// others away: they count with their score times 0.8 (see weightByLocation in scores.ts). A hard filter would make it
// impossible to catch a rarity, a late migrant, or a bird played from a recording that is out of season, which in a
// bird collecting game is a loss; a clear recording still gets through, a borderline look-alike does not.
// Without a position the whole Dex counts fully.
//
// The answer only changes with the place (to about 10 km) and the week, so it is cached per rounded position and week.
// The model itself (15 MB) is loaded for the calculation and freed again, to keep memory low on phones. It runs next to
// BirdNET (in its worker) when there is one, so that the page does not have to start LiteRT.js for it.

import type { GeoPoint } from '../../domain/types'
import { compileFloatModel } from '../runtime/litert'
import { BIRDNET_OUTPUTS } from './scores'
import { makeShapesStatic } from './staticShapes'

/** BirdNET Analyzer's default: birds below this occurrence score are not on the species list for the place. */
export const GEO_THRESHOLD = 0.03
/** If fewer Dex birds than this are on the list (open sea, a bad position) the location is ignored. */
export const GEO_MIN_SPECIES = 10
/** Positions are rounded to this many degrees (about 11 km) for the cache. */
export const GEO_ROUND_DEGREES = 0.1
const CACHE_LIMIT = 16

/**
 * The "week of the year" BirdNET's location model wants: 1 to 48, four weeks per month (BirdNET Analyzer's own wording
 * for its --week option). BirdNET Analyzer 1.5.1 never converts a date: the person gives the week. This follows eBird,
 * whose data the model was trained on, where each month has four weeks: days 1 to 7, 8 to 14, 15 to 21, and 22 to the
 * end of the month. (The community library birdnetlib rounds a share of the year instead, and can differ by one week.)
 */
export function weekOfYear48(date: Date): number {
  const month = date.getMonth() // 0 to 11, in the phone's own time zone: the season where the person stands
  const day = date.getDate()
  return month * 4 + Math.min(4, Math.floor((day - 1) / 7) + 1)
}

export function isValidPoint(point: GeoPoint | undefined): point is GeoPoint {
  return !!point && Number.isFinite(point.lat) && Number.isFinite(point.lon) && Math.abs(point.lat) <= 90 && Math.abs(point.lon) <= 180
}

/** The cache key for a position and week, or undefined when the position cannot be used. */
export function geoKey(point: GeoPoint | undefined, week: number): string | undefined {
  if (!isValidPoint(point) || !Number.isInteger(week) || week < 1 || week > 48) return undefined
  const round = (degrees: number) => (Math.round(degrees / GEO_ROUND_DEGREES) * GEO_ROUND_DEGREES).toFixed(1)
  return `${round(point.lat)}|${round(point.lon)}|${week}`
}

/** The location model's 6522 scores for a place and week, computed here (the model is loaded, run and freed again). */
export async function computeGeoScores(bytes: Uint8Array, lat: number, lon: number, week: number): Promise<Float32Array> {
  // The file says "any batch size" in every tensor; LiteRT.js wants to be told it is 1 (see staticShapes.ts).
  const model = await compileFloatModel(makeShapesStatic(bytes).bytes)
  try {
    if (model.inputShape.length !== 2 || model.inputShape[1] !== 3 || model.outputLength !== BIRDNET_OUTPUTS) {
      throw new Error(`The location model has an unexpected shape: in [${model.inputShape.join(', ')}], out ${model.outputLength}`)
    }
    return await model.run(Float32Array.of(lat, lon, week))
  } finally {
    model.delete()
  }
}

/** Computes the scores somewhere: on the page by default, or in the worker that already holds BirdNET. */
export type GeoCompute = (bytes: Uint8Array, lat: number, lon: number, week: number) => Promise<Float32Array>

export interface GeoPrior {
  /**
   * The 6522 occurrence scores for a place and week, or undefined when there is no usable place. Rejects when the
   * model cannot run; callers then go on without a filter. `compute` says where to run the model (default: here).
   */
  scores(point: GeoPoint | undefined, date: Date, compute?: GeoCompute): Promise<Float32Array | undefined>
  /** Number of places in the cache (for tests). */
  readonly cached: number
}

/** `loadBytes` gives the model file (from the model store). */
export function createGeoPrior(loadBytes: () => Promise<Uint8Array>): GeoPrior {
  const cache = new Map<string, Float32Array>()
  const running = new Map<string, Promise<Float32Array>>()

  async function compute(run: GeoCompute, point: GeoPoint, week: number): Promise<Float32Array> {
    // The cache key rounds the position; the answer is computed for the rounded position too, so a place always
    // gets the same answer however it was first asked.
    const lat = Math.round(point.lat / GEO_ROUND_DEGREES) * GEO_ROUND_DEGREES
    const lon = Math.round(point.lon / GEO_ROUND_DEGREES) * GEO_ROUND_DEGREES
    return run(await loadBytes(), lat, lon, week)
  }

  return {
    async scores(point, date, run = computeGeoScores) {
      const week = weekOfYear48(date)
      const key = geoKey(point, week)
      if (!key || !point) return undefined
      const hit = cache.get(key)
      if (hit) return hit
      let job = running.get(key)
      if (!job) {
        job = compute(run, point, week).then(
          (scores) => {
            running.delete(key)
            cache.set(key, scores)
            if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value as string)
            return scores
          },
          (error: unknown) => {
            running.delete(key)
            throw error
          },
        )
        running.set(key, job)
      }
      return job
    },
    get cached() {
      return cache.size
    },
  }
}
