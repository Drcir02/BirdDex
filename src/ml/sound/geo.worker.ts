// BirdNET's location model in a short-lived Web Worker, for the photo and live camera (src/ml/vision/geoPrior.ts).
//
// The sound engine runs the same model inside its own BirdNET worker. The photo side has no such worker, and starting
// LiteRT.js on the page would add about 110 MB of WebAssembly memory that can never be given back. So the page starts this
// worker for one calculation (a second or less) and shuts it down, which returns all of it. Classic worker, like
// birdnet.worker.ts: LiteRT.js loads its glue with importScripts().

import { computeGeoScores } from './geo'

export interface GeoWorkerRequest {
  bytes: ArrayBuffer
  lat: number
  lon: number
  week: number
}

export type GeoWorkerResponse = { type: 'scores'; scores: Float32Array } | { type: 'failed'; message: string }

interface WorkerScope {
  onmessage: ((event: MessageEvent<GeoWorkerRequest>) => void) | null
  postMessage(message: GeoWorkerResponse, transfer?: Transferable[]): void
}
const scope = self as unknown as WorkerScope

scope.onmessage = (event) => {
  const { bytes, lat, lon, week } = event.data
  computeGeoScores(new Uint8Array(bytes), lat, lon, week).then(
    (scores) => scope.postMessage({ type: 'scores', scores }, [scores.buffer]),
    (error: unknown) => scope.postMessage({ type: 'failed', message: error instanceof Error ? `${error.name}: ${error.message}` : String(error) }),
  )
}
