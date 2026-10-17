// An occurrence prior for photos: how plausible is each bird at the place and time of the photo?
//
// WingDex multiplies its species probabilities by a prior built from 48 million iNaturalist sightings. We have nothing like
// it for photos, so the engine works without one. This file is the socket for one that the integrator can plug in later, for
// example BirdNET's location filter, which the sound engine already runs (src/ml/sound/geo.ts):
//
//   setOccurrencePriorProvider(async ({ location, date }) => {
//     const scores = location ? await birdnetGeoScores(location, date) : undefined   // BirdNET output, 0 to 1 per label
//     return scores && { get: (speciesId) => scores[birdnetIndexOf(speciesId)] }
//   })
//
// Weights are relative: only the ratios between species matter, so any scale that grows with plausibility will do.

import type { GeoPoint, Species } from '../../domain/types'
import { SCORING } from './constants'

/** A weight from 0 (not expected here and now) to 1 (certainly expected) for each species, by speciesId. */
export interface OccurrencePrior {
  /** undefined means "no opinion": the species is treated like the most plausible one. A Map<string, number> fits. */
  get(speciesId: string): number | undefined
}

export interface PriorRequest {
  location?: GeoPoint
  date?: Date
}

export type OccurrencePriorProvider = (request: PriorRequest) => OccurrencePrior | undefined | Promise<OccurrencePrior | undefined>

let provider: OccurrencePriorProvider | undefined

/** Registers (or, with undefined, removes) the function that makes a prior for a photo or a live camera session. */
export function setOccurrencePriorProvider(next: OccurrencePriorProvider | undefined): void {
  provider = next
}

export function getOccurrencePriorProvider(): OccurrencePriorProvider | undefined {
  return provider
}

export interface PriorWeightOptions {
  /** score += strength * ln(weight / best weight). Default SCORING.priorStrength. */
  strength?: number
  /** Weights below this count as this. Default SCORING.priorFloor. */
  floor?: number
}

/**
 * The prior as numbers the scoring can add: one value per species (in the order of `species`), 0 for the most plausible
 * species and negative for the others. Returns undefined when the prior has no opinion about any of the species.
 */
export function priorToLogWeights(species: readonly { id: string }[], prior: OccurrencePrior, options: PriorWeightOptions = {}): Float32Array | undefined {
  const strength = options.strength ?? SCORING.priorStrength
  const floor = options.floor ?? SCORING.priorFloor
  const logs = new Float64Array(species.length)
  const known = new Uint8Array(species.length)
  let best = -Infinity
  for (let i = 0; i < species.length; i++) {
    const weight = prior.get(species[i].id)
    if (weight === undefined || !Number.isFinite(weight)) continue
    const value = Math.log(Math.min(1, Math.max(floor, weight)))
    logs[i] = value
    known[i] = 1
    if (value > best) best = value
  }
  if (best === -Infinity) return undefined
  const out = new Float32Array(species.length)
  for (let i = 0; i < species.length; i++) out[i] = known[i] ? strength * (logs[i] - best) : 0
  return out
}

/** Asks the registered provider. A provider that fails must not break identification, so a failure means "no prior". */
export async function resolveLogWeights(species: readonly { id: string }[], request: PriorRequest, options?: PriorWeightOptions): Promise<Float32Array | undefined> {
  if (!provider) return undefined
  try {
    const prior = await provider(request)
    return prior ? priorToLogWeights(species, prior, options) : undefined
  } catch (error) {
    console.warn('The occurrence prior could not be made, identifying without it', error)
    return undefined
  }
}

/**
 * A ready-made prior from the Dex flags: birds of the region get weight 1, the others `outsideWeight`. With 'czechia' a
 * Barrow's Goldeneye (Iceland) no longer outranks the Common Goldeneye in a Czech photo. With 'europe' nothing changes.
 */
export function createRegionPrior(species: readonly Species[], region: 'czechia' | 'europe', outsideWeight = 0.05): OccurrencePrior {
  const weights = new Map<string, number>()
  for (const s of species) weights.set(s.id, (region === 'czechia' ? s.inCzechia : s.inEurope) ? 1 : outsideWeight)
  return weights
}
