import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkerRequest, WorkerResponse } from '../../src/ml/sound/scorerProtocol'

// The worker is replaced by a fake that records what the page sends and answers like the real one (or misbehaves on
// purpose), so the protocol and the fallback to the page can be tested without a browser.

const model = vi.hoisted(() => ({ load: undefined as undefined | ((bytes: Uint8Array) => Promise<unknown>) }))
vi.mock('../../src/ml/sound/birdnet', () => ({ BirdnetModel: { load: vi.fn((bytes: Uint8Array) => model.load!(bytes)) } }))

import { BirdnetModel } from '../../src/ml/sound/birdnet'
import { loadScorer, WORKER_LOAD_TIMEOUT_MS, WorkerScorer } from '../../src/ml/sound/scorer'

type Behaviour = (worker: FakeWorker, message: WorkerRequest) => void

class FakeWorker {
  static instances: FakeWorker[] = []
  static behaviour: Behaviour = () => undefined
  onmessage: ((event: { data: WorkerResponse }) => void) | null = null
  onerror: ((event: { message: string }) => void) | null = null
  onmessageerror: (() => void) | null = null
  posted: Array<{ message: WorkerRequest; transfer: Transferable[] }> = []
  terminated = false
  constructor(
    readonly url: URL,
    readonly options?: { name?: string },
  ) {
    FakeWorker.instances.push(this)
  }
  postMessage(message: WorkerRequest, transfer: Transferable[] = []) {
    this.posted.push({ message, transfer })
    // Like a real worker, answer later, not inside postMessage.
    queueMicrotask(() => FakeWorker.behaviour(this, message))
  }
  terminate() {
    this.terminated = true
  }
  reply(data: WorkerResponse) {
    this.onmessage?.({ data })
  }
}

const bytes = () => Uint8Array.from({ length: 64 }, (_, i) => i)

const answerLikeTheRealWorker: Behaviour = (worker, message) => {
  if (message.type === 'load') worker.reply({ type: 'loaded' })
  if (message.type === 'run') worker.reply({ type: 'scores', id: message.id, scores: Float32Array.from({ length: 6522 }, (_, i) => (i === 6 ? 0.9 : 0)) })
}

beforeEach(() => {
  FakeWorker.instances = []
  FakeWorker.behaviour = answerLikeTheRealWorker
  vi.stubGlobal('Worker', FakeWorker)
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  vi.mocked(BirdnetModel.load).mockClear()
  model.load = async () => ({ mode: 'main', scores: vi.fn(), delete: vi.fn() })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('WorkerScorer.load', () => {
  it('starts a worker called "birdnet" and has it load the model from a copy of the file that is moved', async () => {
    const file = bytes()
    const scorer = await WorkerScorer.load(file)
    expect(scorer.mode).toBe('worker')
    const [worker] = FakeWorker.instances
    expect(worker.options?.name).toBe('birdnet')
    expect(worker.url.pathname.endsWith('birdnet.worker.ts')).toBe(true)
    const [{ message, transfer }] = worker.posted
    expect(message.type).toBe('load')
    expect(transfer).toHaveLength(1)
    expect(transfer[0]).toBe((message as { bytes: ArrayBuffer }).bytes)
    expect(new Uint8Array((message as { bytes: ArrayBuffer }).bytes)).toEqual(file) // the same bytes...
    expect((message as { bytes: ArrayBuffer }).bytes).not.toBe(file.buffer) // ...in a copy: the model store keeps its own
    expect(file.byteLength).toBe(64) // and our file was not detached
    scorer.delete()
  })

  it('fails with the worker\'s own message when the model does not compile there, and shuts the worker down', async () => {
    FakeWorker.behaviour = (worker, message) => {
      if (message.type === 'load') worker.reply({ type: 'failed', message: 'ModelLoadError: no SIMD' })
    }
    await expect(WorkerScorer.load(bytes())).rejects.toThrow('no SIMD')
    expect(FakeWorker.instances[0].terminated).toBe(true)
  })

  it('fails when the worker file cannot be loaded or crashes while starting', async () => {
    FakeWorker.behaviour = (worker) => worker.onerror?.({ message: 'Script error: 404' })
    await expect(WorkerScorer.load(bytes())).rejects.toThrow('404')
    expect(FakeWorker.instances[0].terminated).toBe(true)
  })

  it('gives up when the worker is silent for too long', async () => {
    vi.useFakeTimers()
    FakeWorker.behaviour = () => undefined // never answers
    const loading = WorkerScorer.load(bytes(), 5_000)
    const outcome = loading.catch((error: Error) => error)
    await vi.advanceTimersByTimeAsync(5_001)
    expect(await outcome).toMatchObject({ message: 'The BirdNET worker took too long to start' })
    expect(FakeWorker.instances[0].terminated).toBe(true)
    expect(WORKER_LOAD_TIMEOUT_MS).toBe(45_000)
  })

  it('fails at once when the browser has no workers', async () => {
    vi.stubGlobal('Worker', undefined)
    await expect(WorkerScorer.load(bytes())).rejects.toThrow('no Web Workers')
  })
})

describe('WorkerScorer.scores', () => {
  it('sends a copy of the window (the caller keeps its own) and returns the scores', async () => {
    const scorer = await WorkerScorer.load(bytes())
    const window = new Float32Array(144000).fill(0.25)
    const scores = await scorer.scores(window)
    expect(scores[6]).toBeCloseTo(0.9, 6)
    expect(window.length).toBe(144000) // not detached by the move
    const [, run] = FakeWorker.instances[0].posted
    expect(run.message.type).toBe('run')
    expect((run.message as { window: Float32Array }).window).not.toBe(window)
    expect((run.message as { window: Float32Array }).window[0]).toBe(0.25)
    expect(run.transfer).toHaveLength(1)
    scorer.delete()
  })

  it('matches answers to questions by number, even when they come back in another order', async () => {
    const answers: Array<() => void> = []
    FakeWorker.behaviour = (worker, message) => {
      if (message.type === 'load') worker.reply({ type: 'loaded' })
      if (message.type === 'run') answers.push(() => worker.reply({ type: 'scores', id: message.id, scores: Float32Array.of(message.id) }))
    }
    const scorer = await WorkerScorer.load(bytes())
    const first = scorer.scores(new Float32Array(4))
    const second = scorer.scores(new Float32Array(4))
    await Promise.resolve()
    await Promise.resolve()
    answers.reverse().forEach((answer) => answer())
    expect((await first)[0]).toBe(1)
    expect((await second)[0]).toBe(2)
  })

  it('rejects only the window that failed', async () => {
    FakeWorker.behaviour = (worker, message) => {
      if (message.type === 'load') worker.reply({ type: 'loaded' })
      if (message.type === 'run') worker.reply(message.id === 1 ? { type: 'failed', id: 1, message: 'out of memory' } : { type: 'scores', id: message.id, scores: Float32Array.of(7) })
    }
    const scorer = await WorkerScorer.load(bytes())
    await expect(scorer.scores(new Float32Array(4))).rejects.toThrow('out of memory')
    expect((await scorer.scores(new Float32Array(4)))[0]).toBe(7)
  })

  it('tells everything that is waiting when the worker dies, and refuses new work', async () => {
    FakeWorker.behaviour = (worker, message) => {
      if (message.type === 'load') worker.reply({ type: 'loaded' })
    }
    const scorer = await WorkerScorer.load(bytes())
    const waiting = scorer.scores(new Float32Array(4)).catch((error: Error) => error)
    await Promise.resolve()
    FakeWorker.instances[0].onerror?.({ message: 'the worker crashed' })
    expect(await waiting).toMatchObject({ message: 'the worker crashed' })
    await expect(scorer.scores(new Float32Array(4))).rejects.toThrow('crashed')
  })
})

describe('WorkerScorer.geoScores', () => {
  it('sends the location model file, the place and the week, and returns the scores', async () => {
    FakeWorker.behaviour = (worker, message) => {
      if (message.type === 'load') worker.reply({ type: 'loaded' })
      if (message.type === 'geo') worker.reply({ type: 'scores', id: message.id, scores: Float32Array.of(message.lat, message.lon, message.week) })
    }
    const scorer = await WorkerScorer.load(bytes())
    const file = bytes()
    const scores = await scorer.geoScores(file, 50.1, 14.4, 18)
    expect(Array.from(scores)).toEqual([expect.closeTo(50.1, 4), expect.closeTo(14.4, 4), 18])
    const { message, transfer } = FakeWorker.instances[0].posted[1]
    expect(message.type).toBe('geo')
    expect(transfer).toHaveLength(1)
    expect((message as { bytes: ArrayBuffer }).bytes).not.toBe(file.buffer) // a copy was moved, the page keeps its file
    expect(file.byteLength).toBe(64)
    scorer.delete()
  })

  it('rejects when the worker could not run the location model, and the worker stays usable', async () => {
    FakeWorker.behaviour = (worker, message) => {
      if (message.type === 'load') worker.reply({ type: 'loaded' })
      if (message.type === 'geo') worker.reply({ type: 'failed', id: message.id, message: 'ModelLoadError: bad shape' })
      if (message.type === 'run') worker.reply({ type: 'scores', id: message.id, scores: Float32Array.of(1) })
    }
    const scorer = await WorkerScorer.load(bytes())
    await expect(scorer.geoScores(bytes(), 1, 2, 3)).rejects.toThrow('bad shape')
    expect((await scorer.scores(new Float32Array(4)))[0]).toBe(1)
  })

  it('refuses after the worker was shut down', async () => {
    const scorer = await WorkerScorer.load(bytes())
    scorer.delete()
    await expect(scorer.geoScores(bytes(), 1, 2, 3)).rejects.toThrow('shut down')
  })
})

describe('WorkerScorer.delete', () => {
  it('asks the worker to free the model, then terminates it, and fails what is still waiting', async () => {
    FakeWorker.behaviour = (worker, message) => {
      if (message.type === 'load') worker.reply({ type: 'loaded' })
    }
    const scorer = await WorkerScorer.load(bytes())
    const waiting = scorer.scores(new Float32Array(4)).catch((error: Error) => error)
    scorer.delete()
    scorer.delete() // harmless the second time
    const worker = FakeWorker.instances[0]
    expect(worker.terminated).toBe(true)
    expect(worker.posted.some((p) => p.message.type === 'dispose')).toBe(true)
    expect(await waiting).toMatchObject({ message: expect.stringContaining('shut down') })
    await expect(scorer.scores(new Float32Array(4))).rejects.toThrow('shut down')
  })
})

describe('loadScorer', () => {
  it('uses the worker when it works', async () => {
    const scorer = await loadScorer(bytes())
    expect(scorer.mode).toBe('worker')
    expect(BirdnetModel.load).not.toHaveBeenCalled()
    scorer.delete()
  })

  it('runs the model on the page when the worker fails, and says why', async () => {
    FakeWorker.behaviour = (worker) => worker.onerror?.({ message: 'no worker for you' })
    const reasons: string[] = []
    const scorer = await loadScorer(bytes(), { onWorkerFailed: (error) => reasons.push(error.message) })
    expect(scorer.mode).toBe('main')
    expect(reasons).toEqual(['no worker for you'])
    expect(BirdnetModel.load).toHaveBeenCalledTimes(1)
  })

  it('runs the model on the page without even trying a worker when asked to', async () => {
    const scorer = await loadScorer(bytes(), { worker: false })
    expect(scorer.mode).toBe('main')
    expect(FakeWorker.instances).toHaveLength(0)
  })

  it('runs the model on the page when the browser has no workers', async () => {
    vi.stubGlobal('Worker', undefined)
    const scorer = await loadScorer(bytes())
    expect(scorer.mode).toBe('main')
  })

  it('fails with the error of the page when neither works', async () => {
    FakeWorker.behaviour = (worker) => worker.onerror?.({ message: 'no worker' })
    model.load = async () => Promise.reject(new Error('does not compile here either'))
    await expect(loadScorer(bytes())).rejects.toThrow('does not compile here either')
  })
})
