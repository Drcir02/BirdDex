// The messages between the page and the BirdNET worker (birdnet.worker.ts), and what both sides agree on.

export type WorkerRequest =
  /** Compile BirdNET from these bytes. The buffer is moved to the worker, not copied. */
  | { type: 'load'; bytes: ArrayBuffer }
  /** Score one window of 144000 samples. `id` comes back with the answer. The buffer is moved. */
  | { type: 'run'; id: number; window: Float32Array }
  /** Run BirdNET's location model: the file, the place and the week. The answer comes back as 'scores'. The buffer is moved. */
  | { type: 'geo'; id: number; bytes: ArrayBuffer; lat: number; lon: number; week: number }
  /** Report how much WebAssembly memory the worker uses (for the developer page and measurements). */
  | { type: 'memory'; id: number }
  /** Free the model and shut the worker down. */
  | { type: 'dispose' }

export type WorkerResponse =
  | { type: 'loaded' }
  /** The answer to a 'run' (BirdNET's scores) or a 'geo' request (the location model's scores). */
  | { type: 'scores'; id: number; scores: Float32Array }
  | { type: 'memory'; id: number; wasmBytes: number }
  /** `id` is set when a run failed, and missing when the load failed. */
  | { type: 'failed'; id?: number; message: string }

/** Something that turns a window of audio into BirdNET scores: the model itself, or a worker that holds the model. */
export interface WindowScorer {
  /** Where the model runs: on the page itself or in a worker. */
  readonly mode: 'main' | 'worker'
  /** Scores (0 to 1) for one 3 second window of 48 kHz mono audio. The window is not changed or kept. */
  scores(window: Float32Array): Promise<Float32Array>
  /**
   * Runs the location model next to BirdNET, in the same place (a worker has LiteRT.js running already, and the page then
   * never has to start it, which saves about 110 MB there). Missing when the model runs on the page: use geo.ts directly.
   */
  geoScores?(bytes: Uint8Array, lat: number, lon: number, week: number): Promise<Float32Array>
  /** Frees the model (for a worker, shuts it down, which gives all of its memory back). */
  delete(): void
  /** Bytes of WebAssembly memory in use by the runtime that holds the model (for measurements). */
  wasmMemory(): Promise<number>
}
