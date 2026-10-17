// BirdNET's location model as the occurrence prior of the photo engine and the live camera.
//
// What it does: for the place and week of the photo it asks BirdNET's location model how likely each bird is to be reported
// there, and hands the numbers to the scoring as an OccurrencePrior (prior.ts). A Common Goldeneye in a Czech photo no longer
// competes with Barrow's Goldeneye from Iceland, and a goose from a Chinese rice field is not forced into "Pink-footed Goose".
// Measured on the fixture photos with a Prague position (docs/notes/integration.md): Goldeneye 0.63 to 0.88 (October) or 0.74
// (May), foreign geese 0.67 to 0.15, gulls from Seattle 0.39 to 0.28 or 0.11, an American woodpecker 0.48 to 0.25, and the right
// birds that are not especially common in Prague stay put (Cormorant 0.75 to 0.77, Kingfisher 0.985 to 0.98). Without a position
// there is no prior.
//
// The scores are used capped (PRESENT_SCORE): a bird that BirdNET's location model gives 0.2 or more counts as fully expected, only
// the birds below that are held back. Used as they are, a Cormorant in Prague in May (a score far below the Great Tit's) fell from
// 0.75 to 0.47 and the correct answer could no longer be caught, because the softmax also holds birds that have no opinion
// (outside the Dex), which are never held back; with the cap it keeps 0.77.
//
// Rules of the road:
// - It never downloads anything. The 15 MB location model is used when it is on the phone already (the "bird brain" download
//   of the hub fetches it for the sound engine); if not, the photo is identified without a prior, like before.
// - It never breaks an identification: any failure (no worker, a model that will not compile) means "no prior" (prior.ts catches it).
// - The calculation runs in a worker of its own that is shut down afterwards, so the page keeps no extra memory.
// - One answer per place (0.1 degree) and week is remembered for the session (the live camera asks once per session).

import { loadSpecies } from '../../data/species'
import type { GeoPoint } from '../../domain/types'
import { areModelsCached, getModelBytes, MODEL_FILE_IDS } from '../runtime/modelStore'
import { computeGeoScores, createGeoPrior, type GeoCompute, type GeoPrior } from '../sound/geo'
import type { GeoWorkerRequest, GeoWorkerResponse } from '../sound/geo.worker'
import { getOccurrencePriorProvider, setOccurrencePriorProvider, type OccurrencePrior, type OccurrencePriorProvider, type PriorRequest } from './prior'

/** Longest wait for the worker; the calculation takes well under a second on a laptop. */
export const GEO_WORKER_TIMEOUT_MS = 30_000

/** Runs the location model in a worker of its own and shuts the worker down afterwards. Without Worker support it runs on the page. */
export const computeGeoInWorker: GeoCompute = (bytes, lat, lon, week) => {
  if (typeof Worker === 'undefined') return computeGeoScores(bytes, lat, lon, week)
  return new Promise<Float32Array>((resolve, reject) => {
    const worker = new Worker(new URL('../sound/geo.worker.ts', import.meta.url), { name: 'birdnet-geo' })
    const finish = () => {
      clearTimeout(timer)
      worker.terminate()
    }
    const timer = setTimeout(() => {
      finish()
      reject(new Error('The location model took too long'))
    }, GEO_WORKER_TIMEOUT_MS)
    worker.onmessage = (event: MessageEvent<GeoWorkerResponse>) => {
      finish()
      if (event.data.type === 'scores') resolve(event.data.scores)
      else reject(new Error(event.data.message))
    }
    worker.onerror = (event) => {
      finish()
      reject(new Error(event.message || 'The location worker failed'))
    }
    const copy = bytes.slice().buffer // the model store keeps its bytes; the copy is moved
    const request: GeoWorkerRequest = { bytes: copy, lat, lon, week }
    worker.postMessage(request, [copy])
  })
}

export interface GeoPriorDeps {
  /** Is the location model on the phone? (Default: the model store.) */
  isAvailable(): Promise<boolean>
  /** The model file. */
  loadBytes(): Promise<Uint8Array>
  /** Species with their BirdNET output position. */
  birdnetIndexOf(): Promise<ReadonlyMap<string, number>>
  compute: GeoCompute
}

const defaultDeps: GeoPriorDeps = {
  isAvailable: () => areModelsCached([MODEL_FILE_IDS.birdnetGeo]).catch(() => false),
  loadBytes: () => getModelBytes(MODEL_FILE_IDS.birdnetGeo),
  birdnetIndexOf: async () => new Map((await loadSpecies()).map((species) => [species.id, species.birdnetIndex] as const)),
  compute: computeGeoInWorker,
}

/** A location score at or above this counts as "this bird is expected here" (weight 1); below it the weight falls in proportion. */
export const PRESENT_SCORE = 0.2

/** A prior from BirdNET's 6522 location scores: a bird's weight is the score of its output, capped at PRESENT_SCORE and scaled to 1. */
export function priorFromGeoScores(scores: ArrayLike<number>, indexOf: ReadonlyMap<string, number>): OccurrencePrior {
  return {
    get(speciesId) {
      const index = indexOf.get(speciesId)
      return index === undefined ? undefined : Math.min(1, scores[index] / PRESENT_SCORE)
    },
  }
}

export function createGeoPriorProvider(deps: Partial<GeoPriorDeps> = {}): OccurrencePriorProvider {
  const all: GeoPriorDeps = { ...defaultDeps, ...deps }
  const geo: GeoPrior = createGeoPrior(() => all.loadBytes())
  return async ({ location, date }: PriorRequest) => {
    if (!location || !(await all.isAvailable())) return undefined
    const scores = await geo.scores(location as GeoPoint, date ?? new Date(), all.compute)
    return scores ? priorFromGeoScores(scores, await all.birdnetIndexOf()) : undefined
  }
}

let installed = false

/**
 * Makes BirdNET's location model the prior of every photo and live camera identification. Safe to call again and again;
 * a provider that somebody else registered (the developer page tries other priors) is left alone.
 */
export function installGeoPrior(): void {
  if (installed || getOccurrencePriorProvider()) return
  installed = true
  setOccurrencePriorProvider(createGeoPriorProvider())
}
