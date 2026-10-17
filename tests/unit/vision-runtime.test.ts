import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ModelProgress } from '../../src/domain/types'
import { ModelDownloadError } from '../../src/ml/runtime/modelErrors'
import { ModelLoadError } from '../../src/ml/runtime/ort'
import { WorkerStartError, type VisionBackend } from '../../src/ml/vision/backend'
import type { InitInfo, VisionFrame, VisionInit, VisionScores } from '../../src/ml/vision/core'
import { getVisionRuntime, resetVisionRuntime, VisionRuntime, wingclipSpecies, type RuntimeDeps } from '../../src/ml/vision/runtime'
import { makeSpecies } from './helpers/vision-fixtures'

const info: InitInfo = { build: 'wasm', ortVersion: 'test', initMs: 5, dexSize: 3 }

function scores(): VisionScores {
  return { pBird: 0.9, pRaw: 0.8, probs: Float32Array.from([0.5, 0.3, 0.1]), outsideMass: 0.1, outsideTop: 0.05, bestSimilarity: 0.5, bestDexSimilarity: 0.5, blank: false, timings: { preprocessMs: 1, inferMs: 2, scoreMs: 3 } }
}

function frame(): VisionFrame {
  return { data: new Uint8ClampedArray(16), width: 2, height: 2, channels: 4 }
}

class FakeBackend implements VisionBackend {
  alive = true
  inits: VisionInit[] = []
  runs = 0
  disposed = false
  failInit: Error | undefined
  failRun: Error | undefined
  constructor(readonly kind: 'worker' | 'main') {}
  async init(init: VisionInit): Promise<InitInfo> {
    if (this.failInit) throw this.failInit
    this.inits.push(init)
    return info
  }
  async run(): Promise<VisionScores> {
    this.runs++
    if (this.failRun) {
      this.alive = false
      throw this.failRun
    }
    return scores()
  }
  async dispose(): Promise<void> {
    this.disposed = true
    this.alive = false
  }
}

/** Fake timers the test advances by hand. */
function fakeClock() {
  let nextHandle = 1
  const timers = new Map<number, { at: number; callback: () => void }>()
  let now = 0
  return {
    setTimer: (callback: () => void, ms: number) => {
      const handle = nextHandle++
      timers.set(handle, { at: now + ms, callback })
      return handle
    },
    clearTimer: (handle: unknown) => void timers.delete(handle as number),
    advance(ms: number) {
      now += ms
      for (const [handle, timer] of [...timers]) {
        if (timer.at <= now) {
          timers.delete(handle)
          timer.callback()
        }
      }
    },
    pending: () => timers.size,
  }
}

function makeDeps(overrides: Partial<RuntimeDeps> = {}) {
  const clock = fakeClock()
  const backends: FakeBackend[] = []
  const loads: string[] = []
  const species = makeSpecies([10, null, 30, 40])
  const deps: RuntimeDeps = {
    loadFile: async (fileId, onProgress) => {
      loads.push(fileId)
      const size = fileId === 'wingclip-data' ? 250 : 100
      onProgress?.(size / 2, size)
      onProgress?.(size, size)
      return new Uint8Array(size)
    },
    totalBytes: async () => 450,
    loadSpecies: async () => species,
    startWorker: async () => {
      const backend = new FakeBackend('worker')
      backends.push(backend)
      return backend
    },
    startInline: () => {
      const backend = new FakeBackend('main')
      backends.push(backend)
      return backend
    },
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    ...overrides,
  }
  return { deps, clock, backends, loads, species }
}

describe('wingclipSpecies', () => {
  it('keeps the species that WingCLIP knows, in Dex order', () => {
    const list = makeSpecies([5, null, 7])
    expect(wingclipSpecies(list).map((s) => s.id)).toEqual(['sp-0', 'sp-2'])
  })
})

describe('prepare', () => {
  it('loads the three files, then starts the model, and reports the three stages', async () => {
    const { deps, backends, loads } = makeDeps()
    const runtime = new VisionRuntime({}, deps)
    expect(runtime.isReady).toBe(false)
    const seen: ModelProgress[] = []
    await runtime.prepare((progress) => seen.push(progress))
    expect(loads).toEqual(['wingclip-onnx', 'wingclip-data', 'wingclip-text'])
    expect(seen[0]).toEqual({ modelId: 'wingclip', stage: 'downloading', loadedBytes: 0, totalBytes: 450 })
    const downloading = seen.filter((p) => p.stage === 'downloading')
    expect(downloading[downloading.length - 1].loadedBytes).toBe(450)
    for (let i = 1; i < downloading.length; i++) expect(downloading[i].loadedBytes).toBeGreaterThanOrEqual(downloading[i - 1].loadedBytes)
    expect(seen.map((p) => p.stage).filter((stage, i, all) => all.indexOf(stage) === i)).toEqual(['downloading', 'preparing', 'ready'])
    expect(seen[seen.length - 1]).toEqual({ modelId: 'wingclip', stage: 'ready', loadedBytes: 450, totalBytes: 450 })
    expect(runtime.isReady).toBe(true)
    expect(runtime.backendKind).toBe('worker')
    expect(runtime.info).toEqual(info)
    expect(backends).toHaveLength(1)
  })

  it('gives the model the three files and the rows of the Dex species that WingCLIP knows', async () => {
    const { deps, backends } = makeDeps()
    const runtime = new VisionRuntime({}, deps)
    await runtime.prepare()
    const [init] = backends[0].inits
    expect(init.graph.byteLength).toBe(100)
    expect(init.weights.byteLength).toBe(250)
    expect(init.classifier.byteLength).toBe(100)
    expect(Array.from(init.dexRows)).toEqual([10, 30, 40])
    expect(runtime.dex.map((s) => s.id)).toEqual(['sp-0', 'sp-2', 'sp-3'])
  })

  it('is cheap to call again: the work is done once, also when callers come at the same time', async () => {
    const { deps, backends, loads } = makeDeps()
    const runtime = new VisionRuntime({}, deps)
    const progress: ModelProgress[] = []
    await Promise.all([runtime.prepare(), runtime.prepare((p) => progress.push(p)), runtime.prepare()])
    await runtime.prepare()
    expect(loads).toHaveLength(3)
    expect(backends).toHaveLength(1)
    // a late caller is told at once that it is ready
    const late: ModelProgress[] = []
    await runtime.prepare((p) => late.push(p))
    expect(late).toEqual([{ modelId: 'wingclip', stage: 'ready', loadedBytes: 450, totalBytes: 450 }])
    expect(progress.length).toBeGreaterThan(0)
  })

  it('forgets a failure, so the next call tries again', async () => {
    let fail = true
    const { deps, loads } = makeDeps({
      loadFile: async (fileId) => {
        loads.push(fileId)
        if (fail) throw new ModelDownloadError('offline', { reason: 'offline' })
        return new Uint8Array(10)
      },
    })
    const runtime = new VisionRuntime({}, deps)
    await expect(runtime.prepare()).rejects.toBeInstanceOf(ModelDownloadError)
    expect(runtime.isReady).toBe(false)
    fail = false
    await runtime.prepare()
    expect(runtime.isReady).toBe(true)
  })

  it('fails with ModelLoadError when the model does not start, and frees what it started', async () => {
    const backend = new FakeBackend('worker')
    backend.failInit = new Error('Failed to load external data file')
    const { deps } = makeDeps({ startWorker: async () => backend })
    const runtime = new VisionRuntime({}, deps)
    await expect(runtime.prepare()).rejects.toBeInstanceOf(ModelLoadError)
    expect(backend.disposed).toBe(true)
    expect(runtime.isReady).toBe(false)
  })

  it('keeps a ModelLoadError of the model as it is', async () => {
    const backend = new FakeBackend('worker')
    const failure = new ModelLoadError('no backend')
    backend.failInit = failure
    const { deps } = makeDeps({ startWorker: async () => backend })
    await expect(new VisionRuntime({}, deps).prepare()).rejects.toBe(failure)
  })

  it('needs a Dex with birds that WingCLIP knows', async () => {
    const { deps } = makeDeps({ loadSpecies: async () => makeSpecies([null, null]) })
    await expect(new VisionRuntime({}, deps).prepare()).rejects.toBeInstanceOf(ModelLoadError)
  })
})

describe('where the model runs', () => {
  it('falls back to the main thread when no worker can be started', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { deps, backends } = makeDeps({
      startWorker: async () => {
        throw new WorkerStartError('no module workers')
      },
    })
    const runtime = new VisionRuntime({ mode: 'auto' }, deps)
    await runtime.prepare()
    expect(runtime.backendKind).toBe('main')
    expect(backends[0].kind).toBe('main')
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('does not hide other failures behind the fallback', async () => {
    const { deps } = makeDeps({
      startWorker: async () => {
        throw new ModelLoadError('broken')
      },
    })
    await expect(new VisionRuntime({ mode: 'auto' }, deps).prepare()).rejects.toBeInstanceOf(ModelLoadError)
  })

  it('has a strict worker mode and a main thread mode, for the tests and measurements', async () => {
    const failing = makeDeps({
      startWorker: async () => {
        throw new WorkerStartError('no')
      },
    })
    await expect(new VisionRuntime({ mode: 'worker' }, failing.deps).prepare()).rejects.toBeInstanceOf(WorkerStartError)
    const main = makeDeps()
    const runtime = new VisionRuntime({ mode: 'main' }, main.deps)
    await runtime.prepare()
    expect(runtime.backendKind).toBe('main')
    expect(main.backends.map((b) => b.kind)).toEqual(['main'])
  })
})

describe('analyse', () => {
  it('prepares the model first when that has not happened yet', async () => {
    const { deps, backends } = makeDeps()
    const runtime = new VisionRuntime({}, deps)
    const result = await runtime.analyse(frame())
    expect(result.pBird).toBe(0.9)
    expect(backends[0].runs).toBe(1)
  })

  it('starts a new model after the worker has died', async () => {
    const { deps, backends } = makeDeps()
    const runtime = new VisionRuntime({}, deps)
    await runtime.prepare()
    backends[0].failRun = new WorkerStartError('the worker stopped')
    await expect(runtime.analyse(frame())).rejects.toBeInstanceOf(WorkerStartError)
    expect(runtime.isReady).toBe(false)
    await runtime.analyse(frame())
    expect(backends).toHaveLength(2)
    expect(backends[1].runs).toBe(1)
  })
})

describe('letting go of the model', () => {
  it('releases the model after a while without use, and loads it again when needed', async () => {
    const { deps, clock, backends, loads } = makeDeps()
    const runtime = new VisionRuntime({ idleReleaseMs: 1000 }, deps)
    await runtime.prepare()
    clock.advance(999)
    expect(runtime.isReady).toBe(true)
    clock.advance(2)
    await Promise.resolve()
    expect(runtime.isReady).toBe(false)
    expect(backends[0].disposed).toBe(true)
    await runtime.analyse(frame())
    expect(backends).toHaveLength(2)
    expect(loads).toHaveLength(6)
  })

  it('counts the time from the last use', async () => {
    const { deps, clock } = makeDeps()
    const runtime = new VisionRuntime({ idleReleaseMs: 1000 }, deps)
    await runtime.prepare()
    clock.advance(800)
    await runtime.analyse(frame())
    clock.advance(800)
    expect(runtime.isReady).toBe(true)
    clock.advance(300)
    await Promise.resolve()
    expect(runtime.isReady).toBe(false)
  })

  it('does not release while something holds it, and starts counting when the hold ends', async () => {
    const { deps, clock } = makeDeps()
    const runtime = new VisionRuntime({ idleReleaseMs: 1000 }, deps)
    await runtime.prepare()
    const release = runtime.hold()
    clock.advance(10_000)
    expect(runtime.isReady).toBe(true)
    release()
    release() // twice is fine
    clock.advance(1001)
    await Promise.resolve()
    expect(runtime.isReady).toBe(false)
  })

  it('can be told never to release', async () => {
    const { deps, clock } = makeDeps()
    const runtime = new VisionRuntime({ idleReleaseMs: 0 }, deps)
    await runtime.prepare()
    expect(clock.pending()).toBe(0)
  })

  it('dispose frees the model at once and leaves no timer behind', async () => {
    const { deps, clock, backends } = makeDeps()
    const runtime = new VisionRuntime({ idleReleaseMs: 1000 }, deps)
    await runtime.prepare()
    await runtime.dispose()
    expect(backends[0].disposed).toBe(true)
    expect(runtime.isReady).toBe(false)
    expect(clock.pending()).toBe(0)
    await runtime.dispose() // twice is fine
  })
})

describe('the shared runtime', () => {
  afterEach(() => resetVisionRuntime())

  it('is one object for everybody until it is reset', async () => {
    const first = getVisionRuntime()
    expect(getVisionRuntime()).toBe(first)
    await resetVisionRuntime()
    expect(getVisionRuntime()).not.toBe(first)
  })
})
