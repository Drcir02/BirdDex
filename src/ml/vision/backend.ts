// Where the WingCLIP core runs: in a Web Worker (the normal way) or on the main thread (the fallback).
//
// Measured in headless Chromium: ONNX Runtime Web's WebAssembly run blocks the thread it runs on for the whole 400 ms of a
// picture (a 10 ms timer did not fire once during six runs in a row), far above the 150 ms that the screen can lose. So the
// model lives in a worker, and the main thread only draws the picture into a canvas and receives the numbers. The main
// thread version exists for browsers that cannot start a module worker; the screen then freezes for the duration of a run.

import { ModelLoadError } from '../runtime/ort'
import { VisionCore, type CoreDeps, type InitInfo, type VisionFrame, type VisionInit, type VisionRunOptions, type VisionScores } from './core'
import type { VisionRequest, VisionResponse } from './protocol'

export interface VisionBackend {
  readonly kind: 'worker' | 'main'
  /** False once the worker has died or the backend was disposed. */
  readonly alive: boolean
  /** Hands over the model files. The buffers of `init` may be taken over (transferred) by a worker. */
  init(init: VisionInit): Promise<InitInfo>
  /** Scores one picture. The pixel buffer of `frame` may be taken over by a worker. */
  run(frame: VisionFrame, options?: VisionRunOptions): Promise<VisionScores>
  dispose(): Promise<void>
}

/** The worker could not be started at all (no module workers, blocked, script missing). Nothing was sent to it. */
export class WorkerStartError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'WorkerStartError'
  }
}

// ---------- On the main thread ----------

export function createInlineBackend(deps: CoreDeps = {}): VisionBackend {
  let core: VisionCore | undefined
  let alive = true
  return {
    kind: 'main',
    get alive() {
      return alive
    },
    async init(init) {
      await core?.dispose()
      core = await VisionCore.create(init, deps)
      return core.info
    },
    run(frame, options) {
      if (!core) return Promise.reject(new ModelLoadError('The vision core has no model yet'))
      return core.run(frame, options)
    },
    async dispose() {
      alive = false
      const closing = core
      core = undefined
      await closing?.dispose()
    },
  }
}

// ---------- In a worker ----------

/** The part of a Worker that the backend uses (so tests can pass a stand-in). */
export interface WorkerLike {
  onmessage: ((event: MessageEvent<VisionResponse>) => void) | null
  onerror: ((event: Event) => void) | null
  onmessageerror: ((event: MessageEvent) => void) | null
  postMessage(message: VisionRequest, transfer?: Transferable[]): void
  terminate(): void
}

export function createVisionWorker(): WorkerLike {
  // The literal form below is what Vite looks for to bundle worker.ts as its own file.
  return new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' }) as unknown as WorkerLike
}

export interface WorkerBackendOptions {
  createWorker?: () => WorkerLike
  /** How long the worker has to answer the first ping. Starting means downloading and compiling its script. */
  startTimeoutMs?: number
}

interface Pending {
  resolve: (response: VisionResponse) => void
  reject: (error: Error) => void
}

/** Omit that works on each member of a union. */
type WithoutId<T> = T extends unknown ? Omit<T, 'id'> : never

/** Starts the worker and waits until it answers. Throws WorkerStartError if it does not. */
export async function startWorkerBackend(options: WorkerBackendOptions = {}): Promise<VisionBackend> {
  let worker: WorkerLike
  try {
    worker = (options.createWorker ?? createVisionWorker)()
  } catch (error) {
    throw new WorkerStartError('Web Workers are not available', { cause: error })
  }

  let alive = true
  let nextId = 1
  const pending = new Map<number, Pending>()

  const fail = (error: Error) => {
    alive = false
    for (const entry of pending.values()) entry.reject(error)
    pending.clear()
    try {
      worker.terminate()
    } catch {
      // Already gone.
    }
  }

  worker.onmessage = (event) => {
    const response = event.data
    const entry = pending.get(response.id)
    if (!entry) return
    pending.delete(response.id)
    if (response.type === 'error') {
      const error = new Error(response.message)
      error.name = response.name
      entry.reject(error)
    } else {
      entry.resolve(response)
    }
  }
  worker.onerror = () => fail(new WorkerStartError('The vision worker stopped'))
  worker.onmessageerror = () => fail(new WorkerStartError('The vision worker sent something unreadable'))

  function request(message: WithoutId<VisionRequest>, transfer: Transferable[] = []): Promise<VisionResponse> {
    if (!alive) return Promise.reject(new WorkerStartError('The vision worker is not running'))
    const id = nextId++
    return new Promise<VisionResponse>((resolve, reject) => {
      pending.set(id, { resolve, reject })
      try {
        worker.postMessage({ ...message, id } as VisionRequest, transfer)
      } catch (error) {
        pending.delete(id)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  // Wait for a sign of life before any model file is handed over.
  const timeoutMs = options.startTimeoutMs ?? 20_000
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      request({ type: 'ping' }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new WorkerStartError('The vision worker did not start in time')), timeoutMs)
      }),
    ])
  } catch (error) {
    fail(error instanceof Error ? error : new Error(String(error)))
    throw error instanceof WorkerStartError ? error : new WorkerStartError('The vision worker did not start', { cause: error })
  } finally {
    clearTimeout(timer)
  }

  return {
    kind: 'worker',
    get alive() {
      return alive
    },
    async init(init) {
      const response = await request({ type: 'init', init }, [init.graph.buffer, init.weights.buffer, init.classifier.buffer, init.dexRows.buffer])
      if (response.type !== 'ready') throw new ModelLoadError('The vision worker answered something unexpected')
      return response.info
    },
    async run(frame, options) {
      const response = await request({ type: 'run', frame, options }, [frame.data.buffer])
      if (response.type !== 'scores') throw new ModelLoadError('The vision worker answered something unexpected')
      return response.scores
    },
    async dispose() {
      if (!alive) return
      try {
        await request({ type: 'dispose' })
      } catch {
        // The worker is going away anyway.
      }
      alive = false
      pending.clear()
      worker.terminate()
    },
  }
}
