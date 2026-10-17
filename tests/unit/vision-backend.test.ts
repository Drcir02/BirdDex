import { describe, expect, it, vi } from 'vitest'
import { ModelLoadError } from '../../src/ml/runtime/ort'
import { createInlineBackend, startWorkerBackend, WorkerStartError, type WorkerLike } from '../../src/ml/vision/backend'
import type { InitInfo, VisionFrame, VisionInit, VisionScores } from '../../src/ml/vision/core'
import type { VisionRequest, VisionResponse } from '../../src/ml/vision/protocol'

const info: InitInfo = { build: 'wasm', ortVersion: 'test', initMs: 5, dexSize: 2 }
const scores: VisionScores = {
  pBird: 0.9,
  pRaw: 0.8,
  probs: Float32Array.from([0.7, 0.2]),
  outsideMass: 0.1,
  bestSimilarity: 0.6,
  bestDexSimilarity: 0.6,
  blank: false,
  timings: { preprocessMs: 1, inferMs: 2, scoreMs: 3 },
}

function init(): VisionInit {
  return { graph: new Uint8Array(8), weights: new Uint8Array(16), classifier: new Uint8Array(24), dexRows: Int32Array.from([1, 2]) }
}

function frame(): VisionFrame {
  return { data: new Uint8ClampedArray(16), width: 2, height: 2, channels: 4 }
}

/** A stand-in worker that answers the protocol from a script, asynchronously like a real one. */
class FakeWorker implements WorkerLike {
  onmessage: ((event: MessageEvent<VisionResponse>) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  onmessageerror: ((event: MessageEvent) => void) | null = null
  terminated = false
  received: { message: VisionRequest; transfer: Transferable[] }[] = []
  /** What to do with a request: return a response, or undefined to stay silent. */
  script: (message: VisionRequest) => VisionResponse | undefined = (message) => {
    switch (message.type) {
      case 'ping':
        return { type: 'pong', id: message.id }
      case 'init':
        return { type: 'ready', id: message.id, info }
      case 'run':
        return { type: 'scores', id: message.id, scores }
      case 'dispose':
        return { type: 'disposed', id: message.id }
    }
  }

  postMessage(message: VisionRequest, transfer: Transferable[] = []): void {
    this.received.push({ message, transfer })
    const response = this.script(message)
    if (response) queueMicrotask(() => this.onmessage?.({ data: response } as MessageEvent<VisionResponse>))
  }

  terminate(): void {
    this.terminated = true
  }
}

describe('the worker backend', () => {
  it('waits for the worker to answer before it hands over anything', async () => {
    const worker = new FakeWorker()
    const backend = await startWorkerBackend({ createWorker: () => worker })
    expect(backend.kind).toBe('worker')
    expect(backend.alive).toBe(true)
    expect(worker.received.map((r) => r.message.type)).toEqual(['ping'])
  })

  it('transfers the model files and the pixels instead of copying them', async () => {
    const worker = new FakeWorker()
    const backend = await startWorkerBackend({ createWorker: () => worker })
    const files = init()
    expect(await backend.init(files)).toEqual(info)
    const frameToSend = frame()
    expect(await backend.run(frameToSend)).toBe(scores)
    const [, initCall, runCall] = worker.received
    expect(initCall.transfer).toEqual([files.graph.buffer, files.weights.buffer, files.classifier.buffer, files.dexRows.buffer])
    expect(runCall.transfer).toEqual([frameToSend.data.buffer])
  })

  it('gives every request its own id and matches the answers to them', async () => {
    const worker = new FakeWorker()
    // answer the second run before the first
    const held: VisionRequest[] = []
    worker.script = (message) => {
      if (message.type === 'ping') return { type: 'pong', id: message.id }
      if (message.type === 'run') {
        held.push(message)
        if (held.length === 2) {
          const [first, second] = held
          queueMicrotask(() => {
            worker.onmessage?.({ data: { type: 'scores', id: second.id, scores: { ...scores, pBird: 0.2 } } } as MessageEvent<VisionResponse>)
            worker.onmessage?.({ data: { type: 'scores', id: first.id, scores: { ...scores, pBird: 0.1 } } } as MessageEvent<VisionResponse>)
          })
        }
      }
      return undefined
    }
    const backend = await startWorkerBackend({ createWorker: () => worker })
    const [a, b] = await Promise.all([backend.run(frame()), backend.run(frame())])
    expect(a.pBird).toBe(0.1)
    expect(b.pBird).toBe(0.2)
  })

  it('hands an error of the worker on with its name and message', async () => {
    const worker = new FakeWorker()
    const normal = worker.script
    worker.script = (message) => (message.type === 'init' ? { type: 'error', id: message.id, name: 'ModelLoadError', message: 'no such file' } : normal(message))
    const backend = await startWorkerBackend({ createWorker: () => worker })
    await expect(backend.init(init())).rejects.toMatchObject({ name: 'ModelLoadError', message: 'no such file' })
    expect(backend.alive).toBe(true)
  })

  it('reports a worker that cannot be created, without sending anything', async () => {
    await expect(
      startWorkerBackend({
        createWorker: () => {
          throw new Error('Worker is not defined')
        },
      }),
    ).rejects.toBeInstanceOf(WorkerStartError)
  })

  it('reports a worker that does not answer in time and stops it', async () => {
    vi.useFakeTimers()
    try {
      const worker = new FakeWorker()
      worker.script = () => undefined
      const started = startWorkerBackend({ createWorker: () => worker, startTimeoutMs: 1000 })
      const failure = expect(started).rejects.toBeInstanceOf(WorkerStartError)
      await vi.advanceTimersByTimeAsync(1001)
      await failure
      expect(worker.terminated).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('reports a worker whose script fails to load', async () => {
    const worker = new FakeWorker()
    worker.script = () => {
      queueMicrotask(() => worker.onerror?.(new Event('error')))
      return undefined
    }
    await expect(startWorkerBackend({ createWorker: () => worker })).rejects.toBeInstanceOf(WorkerStartError)
    expect(worker.terminated).toBe(true)
  })

  it('fails every waiting request when the worker dies, and says it is not alive any more', async () => {
    const worker = new FakeWorker()
    const normal = worker.script
    worker.script = (message) => {
      if (message.type === 'run') {
        queueMicrotask(() => worker.onerror?.(new Event('error')))
        return undefined
      }
      return normal(message)
    }
    const backend = await startWorkerBackend({ createWorker: () => worker })
    await expect(backend.run(frame())).rejects.toBeInstanceOf(WorkerStartError)
    expect(backend.alive).toBe(false)
    await expect(backend.run(frame())).rejects.toBeInstanceOf(WorkerStartError)
    expect(worker.terminated).toBe(true)
  })

  it('asks the worker to free the model, then stops it', async () => {
    const worker = new FakeWorker()
    const backend = await startWorkerBackend({ createWorker: () => worker })
    await backend.dispose()
    expect(worker.received.map((r) => r.message.type)).toEqual(['ping', 'dispose'])
    expect(worker.terminated).toBe(true)
    expect(backend.alive).toBe(false)
    await backend.dispose() // twice is fine
  })
})

describe('the main thread backend', () => {
  it('has no model before init, and says so', async () => {
    const backend = createInlineBackend()
    expect(backend.kind).toBe('main')
    await expect(backend.run(frame())).rejects.toBeInstanceOf(ModelLoadError)
  })

  it('refuses a model that does not fit and stays usable for another try', async () => {
    const backend = createInlineBackend({ speciesRows: 3 })
    await expect(backend.init(init())).rejects.toBeInstanceOf(ModelLoadError)
    expect(backend.alive).toBe(true)
  })

  it('is not alive after dispose', async () => {
    const backend = createInlineBackend()
    await backend.dispose()
    expect(backend.alive).toBe(false)
  })
})
