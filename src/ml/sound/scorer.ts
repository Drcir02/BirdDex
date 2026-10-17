// Gets BirdNET ready to score windows, in a worker when the browser can do that and on the page itself otherwise.
//
//   const scorer = await loadScorer(bytes)
//   const scores = await scorer.scores(window)   // 6522 scores between 0 and 1
//   scorer.delete()
//
// The worker is tried first: the page stays smooth and shutting the worker down gives back the model's 350 MB.
// If the worker cannot start (no Worker support, the file cannot be loaded, the model does not compile there, or it
// takes too long) the model is loaded on the page instead, so a scan always works.

import { BirdnetModel } from './birdnet'
import type { WindowScorer, WorkerRequest, WorkerResponse } from './scorerProtocol'

export type { WindowScorer } from './scorerProtocol'

/** How long the worker may take to start and compile the model before the page gives up on it. */
export const WORKER_LOAD_TIMEOUT_MS = 45_000

interface Waiting<T> {
  resolve(value: T): void
  reject(error: Error): void
}

export class WorkerScorer implements WindowScorer {
  readonly mode = 'worker'
  private readonly worker: Worker
  private readonly running = new Map<number, Waiting<Float32Array>>()
  private readonly asking = new Map<number, Waiting<number>>()
  /** Set while the worker is compiling the model. */
  private loading: Waiting<void> | undefined
  private nextId = 1
  private dead: Error | undefined

  private constructor(worker: Worker) {
    this.worker = worker
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => this.receive(event.data)
    // A worker that cannot start or that crashes reports it here; everything waiting for it is told.
    worker.onerror = (event) => this.fail(new Error(event.message || 'The BirdNET worker failed'))
    worker.onmessageerror = () => this.fail(new Error('The BirdNET worker sent something unreadable'))
  }

  /** Starts a worker and has it compile the model. Rejects when that does not work out within the time limit. */
  static async load(bytes: Uint8Array, timeoutMs: number = WORKER_LOAD_TIMEOUT_MS): Promise<WorkerScorer> {
    if (typeof Worker === 'undefined') throw new Error('This browser has no Web Workers')
    const scorer = new WorkerScorer(new Worker(new URL('./birdnet.worker.ts', import.meta.url), { name: 'birdnet' }))
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('The BirdNET worker took too long to start')), timeoutMs)
        scorer.loading = {
          resolve: () => {
            clearTimeout(timer)
            resolve()
          },
          reject: (error) => {
            clearTimeout(timer)
            reject(error)
          },
        }
        // The page keeps its own copy of the file (the model store shares it); the worker gets a copy that is moved.
        const copy = bytes.slice().buffer
        const request: WorkerRequest = { type: 'load', bytes: copy }
        scorer.worker.postMessage(request, [copy])
      })
    } catch (error) {
      scorer.delete()
      throw error
    } finally {
      scorer.loading = undefined
    }
    return scorer
  }

  private receive(message: WorkerResponse): void {
    if (message.type === 'loaded') {
      this.loading?.resolve()
    } else if (message.type === 'scores') {
      const waiting = this.running.get(message.id)
      this.running.delete(message.id)
      waiting?.resolve(message.scores)
    } else if (message.type === 'memory') {
      const waiting = this.asking.get(message.id)
      this.asking.delete(message.id)
      waiting?.resolve(message.wasmBytes)
    } else if (message.id === undefined) {
      this.loading?.reject(new Error(message.message))
    } else {
      const error = new Error(message.message)
      const waiting = this.running.get(message.id) ?? this.asking.get(message.id)
      this.running.delete(message.id)
      this.asking.delete(message.id)
      waiting?.reject(error)
    }
  }

  private fail(error: Error): void {
    this.dead ??= error
    this.loading?.reject(error)
    for (const waiting of this.running.values()) waiting.reject(error)
    this.running.clear()
    for (const waiting of this.asking.values()) waiting.reject(error)
    this.asking.clear()
  }

  geoScores(bytes: Uint8Array, lat: number, lon: number, week: number): Promise<Float32Array> {
    if (this.dead) return Promise.reject(this.dead)
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.running.set(id, { resolve, reject })
      const copy = bytes.slice().buffer // the page keeps its file; the copy is moved
      const request: WorkerRequest = { type: 'geo', id, bytes: copy, lat, lon, week }
      this.worker.postMessage(request, [copy])
    })
  }

  scores(window: Float32Array): Promise<Float32Array> {
    if (this.dead) return Promise.reject(this.dead)
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.running.set(id, { resolve, reject })
      // A copy is moved to the worker, so the caller's window stays usable.
      const copy = window.slice()
      const request: WorkerRequest = { type: 'run', id, window: copy }
      this.worker.postMessage(request, [copy.buffer])
    })
  }

  wasmMemory(): Promise<number> {
    if (this.dead) return Promise.reject(this.dead)
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.asking.set(id, { resolve, reject })
      const request: WorkerRequest = { type: 'memory', id }
      this.worker.postMessage(request)
    })
  }

  delete(): void {
    this.fail(new Error('The BirdNET worker was shut down'))
    try {
      const request: WorkerRequest = { type: 'dispose' }
      this.worker.postMessage(request)
    } catch {
      // The worker is gone already.
    }
    this.worker.terminate() // frees the worker's memory at once, whatever it was doing
  }
}

export interface LoadScorerOptions {
  /** Try a worker first. Default true. */
  worker?: boolean
  /** Called when the worker was tried and did not work, with the reason (just before the model is loaded on the page). */
  onWorkerFailed?: (error: Error) => void
}

/** BirdNET ready to score: in a worker if possible, otherwise on the page. */
export async function loadScorer(bytes: Uint8Array, options: LoadScorerOptions = {}): Promise<WindowScorer> {
  if (options.worker !== false) {
    try {
      return await WorkerScorer.load(bytes)
    } catch (error) {
      const reason = error instanceof Error ? error : new Error(String(error))
      console.warn('BirdNET could not start in a worker, running it on the page instead', reason)
      options.onWorkerFailed?.(reason)
    }
  }
  return BirdnetModel.load(bytes)
}
