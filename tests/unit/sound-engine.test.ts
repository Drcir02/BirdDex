import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SoundUpdate } from '../../src/domain/engines'
import type { ModelProgress, Species } from '../../src/domain/types'
import type { CaptureHandlers, CaptureSession } from '../../src/ml/audio/capture'

// The whole engine with the microphone, the model files and BirdNET replaced by fakes: what is tested is how the
// parts are put together (order of calls, clean-up, filters, errors), not the neural network. The real model is
// tested in tests/e2e/sound-engine.spec.ts.

const world = vi.hoisted(() => ({
  handlers: undefined as undefined | CaptureHandlers,
  captureStop: undefined as undefined | (() => Promise<void>),
  captureCalls: 0,
  captureError: undefined as unknown,
  scoresFor: undefined as undefined | ((call: number) => Float32Array),
  modelCalls: 0,
  models: [] as Array<{ deleted: boolean }>,
  ensureError: undefined as unknown,
  workerOk: false,
  workerError: undefined as string | undefined,
  manifestFiles: [] as Array<{ id: string; bytes: number }>,
  ensureCalls: [] as string[][],
  geoScores: undefined as undefined | (() => Promise<Float32Array | undefined>),
  geoCalls: 0,
  geoComputeGiven: [] as boolean[],
  scorerGeo: undefined as undefined | (() => Promise<Float32Array>),
  order: [] as string[],
}))

vi.mock('../../src/ml/audio/capture', async (original) => {
  const actual = await original<typeof import('../../src/ml/audio/capture')>()
  return {
    ...actual,
    startCapture: vi.fn((handlers: CaptureHandlers) => {
      world.captureCalls++
      world.handlers = handlers
      world.order.push('capture-started')
      if (world.captureError) return Promise.reject(world.captureError)
      const stop = vi.fn(async () => {
        world.order.push('capture-stopped')
      })
      world.captureStop = stop
      return Promise.resolve({ sampleRate: 48000, atTargetRate: true, settings: {}, method: 'worklet', stop } satisfies CaptureSession)
    }),
  }
})

vi.mock('../../src/ml/runtime/modelStore', async (original) => {
  const actual = await original<typeof import('../../src/ml/runtime/modelStore')>()
  return {
    ...actual,
    getModelManifest: vi.fn(async () => ({ version: 2, files: world.manifestFiles, benchmarks: [] })),
    ensureModels: vi.fn(async (ids: string[], options?: { modelId?: string; onProgress?: (p: ModelProgress) => void }) => {
      world.ensureCalls.push(ids)
      const total = world.manifestFiles.filter((f) => ids.includes(f.id)).reduce((sum, f) => sum + f.bytes, 0)
      options?.onProgress?.({ modelId: options.modelId ?? '', stage: 'downloading', loadedBytes: total / 2, totalBytes: total })
      if (world.ensureError) throw world.ensureError
      options?.onProgress?.({ modelId: options.modelId ?? '', stage: 'downloading', loadedBytes: total, totalBytes: total })
    }),
    getModelBytes: vi.fn(async () => new Uint8Array(4)),
  }
})

vi.mock('../../src/ml/sound/scorer', () => ({
  loadScorer: vi.fn(async (_bytes: Uint8Array, options?: { worker?: boolean; onWorkerFailed?: (error: Error) => void }) => {
    if (world.workerError && options?.worker !== false) options?.onWorkerFailed?.(new Error(world.workerError))
    const state = { deleted: false }
    world.models.push(state)
    const mode = world.workerOk && options?.worker !== false ? 'worker' : 'main'
    return {
      mode,
      ...(mode === 'worker' ? { geoScores: vi.fn(async () => (world.scorerGeo ?? (async () => new Float32Array(6522)))()) } : {}),
      scores: vi.fn(async () => (world.scoresFor ?? (() => new Float32Array(6522)))(world.modelCalls++)),
      delete: vi.fn(() => {
        state.deleted = true
      }),
    }
  }),
}))

vi.mock('../../src/ml/sound/geo', async (original) => {
  const actual = await original<typeof import('../../src/ml/sound/geo')>()
  return {
    ...actual,
    createGeoPrior: vi.fn(() => ({
      scores: vi.fn(async (_point: unknown, _date: unknown, compute?: unknown) => {
        world.geoCalls++
        world.geoComputeGiven.push(typeof compute === 'function')
        if (typeof compute === 'function') await (compute as (...args: unknown[]) => Promise<unknown>)(new Uint8Array(1), 50, 14, 18)
        return world.geoScores ? world.geoScores() : undefined
      }),
      cached: 0,
    })),
  }
})

const species = (id: string, birdnetIndex: number): Species => ({
  id,
  dexNumber: birdnetIndex,
  scientificName: id,
  czechName: null,
  englishName: id,
  family: null,
  inCzechia: true,
  inEurope: true,
  rarity: 'common',
  birdnetIndex,
  wingclipIndex: null,
  wikiTitle: null,
})
// Twelve birds at the BirdNET positions 10 to 21, so that a place can "expect" the 10 or more the location prior needs.
const DEX = Array.from({ length: 12 }, (_, i) => species(`bird-${String.fromCharCode(97 + i)}`, 10 + i))

vi.mock('../../src/data/species', () => ({ loadSpecies: vi.fn(async () => DEX) }))

import { SoundCaptureError, startCapture } from '../../src/ml/audio/capture'
import { createSoundEngine, MAX_SCAN_SECONDS, type DisposableSoundEngine } from '../../src/ml/sound/engine'

const GEO_FILE = { id: 'birdnet-geo-fp16', bytes: 200 }
const MAIN_FILE = { id: 'birdnet-fp16', bytes: 1000 }
const tick = () => new Promise<void>((resolve) => setImmediate(resolve))

/** Pushes `seconds` of audio through the microphone handler, in 0.1 second blocks. */
async function hear(seconds: number, rms = 0.05): Promise<void> {
  for (let block = 0; block < seconds * 10; block++) {
    world.handlers!.onBlock(new Float32Array(4800), rms, rms * 2, 48000)
    await tick()
  }
}

/** A model that is sure about one species in every window. */
const sure = (index: number, score = 0.9) => () => {
  const scores = new Float32Array(6522)
  scores[index] = score
  return scores
}

let engine: DisposableSoundEngine
const updates: SoundUpdate[] = []
const onUpdate = (update: SoundUpdate) => updates.push(update)

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  world.handlers = undefined
  world.captureStop = undefined
  world.captureCalls = 0
  world.captureError = undefined
  world.scoresFor = undefined
  world.modelCalls = 0
  world.models = []
  world.ensureError = undefined
  world.workerOk = false
  world.workerError = undefined
  world.manifestFiles = [MAIN_FILE, GEO_FILE]
  world.ensureCalls = []
  world.geoScores = undefined
  world.geoCalls = 0
  world.geoComputeGiven = []
  world.scorerGeo = undefined
  world.order = []
  updates.length = 0
  engine = createSoundEngine()
})

afterEach(async () => {
  await engine.dispose()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('prepare', () => {
  it('downloads both models with one combined progress, then prepares, then reports ready', async () => {
    const progress: ModelProgress[] = []
    await engine.prepare((p) => progress.push(p))
    expect(world.ensureCalls).toEqual([['birdnet-fp16', 'birdnet-geo-fp16']])
    expect(progress.map((p) => p.stage)).toEqual(['downloading', 'downloading', 'preparing', 'ready'])
    expect(progress.every((p) => p.modelId === 'birdnet')).toBe(true)
    expect(progress.at(-1)).toMatchObject({ stage: 'ready', loadedBytes: 1200, totalBytes: 1200 })
  })

  it('does the work once; later calls just say "ready"', async () => {
    await engine.prepare()
    const again: ModelProgress[] = []
    await engine.prepare((p) => again.push(p))
    expect(again).toEqual([{ modelId: 'birdnet', stage: 'ready', loadedBytes: 1200, totalBytes: 1200 }])
    expect(world.ensureCalls).toHaveLength(1)
    expect(world.models).toHaveLength(1)
  })

  it('lets callers that ask at the same time share the work and all see the progress', async () => {
    const a: string[] = []
    const b: string[] = []
    await Promise.all([engine.prepare((p) => a.push(p.stage)), engine.prepare((p) => b.push(p.stage))])
    expect(world.models).toHaveLength(1)
    expect(a).toContain('ready')
    expect(b).toContain('ready')
  })

  it('works without the location model when the model list does not have it', async () => {
    world.manifestFiles = [MAIN_FILE]
    await engine.prepare()
    expect(world.ensureCalls).toEqual([['birdnet-fp16']])
  })

  it('fails with the real error when the download fails, and tries again from the start next time', async () => {
    world.ensureError = new Error('network down')
    await expect(engine.prepare()).rejects.toThrow('network down')
    expect(world.models).toHaveLength(0)
    world.ensureError = undefined
    await engine.prepare()
    expect(world.models).toHaveLength(1)
  })
})

describe('start', () => {
  it('opens the microphone in the same tick as the tap, before any model work is awaited', () => {
    const promise = engine.start({ onUpdate })
    expect(world.captureCalls).toBe(1) // synchronous: this is what iOS needs
    void promise.catch(() => undefined)
  })

  it('works even when prepare() was not called first', async () => {
    const session = await engine.start({ onUpdate })
    expect(world.models).toHaveLength(1)
    await session.stop()
  })

  it('names a bird of the Dex after the windows agree, with a clip, and releases the microphone first', async () => {
    world.scoresFor = sure(10)
    await engine.prepare()
    const session = await engine.start({ onUpdate })
    await hear(5.5)
    const last = updates.at(-1)!
    expect(last.candidates).toEqual([{ speciesId: 'bird-a', confidence: expect.closeTo(0.9, 6) }])
    expect(last.hearingBird).toBe(true)
    expect(last.analysedSeconds).toBe(5)
    expect(last.level).toBeGreaterThan(0)

    world.order.push('stop-called')
    const result = await session.stop()
    expect(world.order.slice(-2)).toEqual(['stop-called', 'capture-stopped'])
    expect(result.candidates[0].speciesId).toBe('bird-a')
    expect(result.clip).toBeInstanceOf(Blob)
    expect(result.clip!.type).toBe('audio/wav')
    expect(result.clipSeconds).toBeGreaterThan(3)
    expect(world.captureStop).toHaveBeenCalledTimes(1)
    expect(await session.stop()).toBe(result) // asking again gives the same answer, no second release
    expect(world.captureStop).toHaveBeenCalledTimes(1)
  })

  it('never reports birds that are not in the Dex', async () => {
    const scores = new Float32Array(6522)
    scores[500] = 0.99 // not a bird of the Dex (a Dex bird sits at 10, 11 or 12)
    scores[11] = 0.4
    world.scoresFor = () => scores
    await engine.prepare()
    const session = await engine.start({ onUpdate })
    await hear(5.5)
    const result = await session.stop()
    expect(result.candidates.map((c) => c.speciesId)).toEqual(['bird-b'])
  })

  it('reports at most three birds, strongest first', async () => {
    world.scoresFor = () => {
      const scores = new Float32Array(6522)
      scores[10] = 0.5
      scores[11] = 0.8
      scores[12] = 0.65
      return scores
    }
    await engine.prepare()
    const session = await engine.start({ onUpdate })
    await hear(5.5)
    const result = await session.stop()
    expect(result.candidates.map((c) => c.speciesId)).toEqual(['bird-b', 'bird-c', 'bird-a'])
  })

  it('calls onError when the microphone stops by itself, and stop() still returns what was heard', async () => {
    world.scoresFor = sure(10)
    const errors: unknown[] = []
    await engine.prepare()
    const session = await engine.start({ onUpdate, onError: (e) => errors.push(e) })
    await hear(5)
    world.handlers!.onEnded!('interrupted')
    expect(errors).toHaveLength(1)
    expect(errors[0]).toBeInstanceOf(SoundCaptureError)
    expect((errors[0] as SoundCaptureError).reason).toBe('interrupted')
    expect((await session.stop()).candidates[0].speciesId).toBe('bird-a')
  })

  it('stops a scan that nobody stops, after the time limit', async () => {
    vi.useFakeTimers()
    const errors: unknown[] = []
    const quick = createSoundEngine({ maxScanSeconds: 60 })
    const session = await quick.start({ onUpdate, onError: (e) => errors.push(e) })
    await vi.advanceTimersByTimeAsync(59_000)
    expect(world.captureStop).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(2_000)
    expect(world.captureStop).toHaveBeenCalledTimes(1)
    expect((errors[0] as SoundCaptureError).reason).toBe('timeout')
    await session.stop() // still fine
    expect(MAX_SCAN_SECONDS).toBe(900)
    await quick.dispose()
  })

  it('stops the scan before it when a new one starts', async () => {
    await engine.prepare()
    await engine.start({ onUpdate })
    const first = world.captureStop!
    await engine.start({ onUpdate })
    expect(first).toHaveBeenCalledTimes(1)
  })
})

describe('start: when things go wrong', () => {
  it('rejects with the microphone error and leaves nothing running', async () => {
    world.captureError = new SoundCaptureError('denied', 'blocked')
    await expect(engine.start({ onUpdate })).rejects.toMatchObject({ reason: 'denied' })
  })

  it('rejects when the models cannot be prepared, and still releases a microphone that did open', async () => {
    world.ensureError = new Error('storage full')
    await expect(engine.start({ onUpdate })).rejects.toThrow('storage full')
    await tick()
    expect(world.captureStop).toHaveBeenCalledTimes(1)
  })

  it('keeps analysing when a window fails now and then, and reports it', async () => {
    let call = 0
    world.scoresFor = () => {
      if (call++ === 0) throw new Error('one bad window')
      return sure(10)()
    }
    const errors: unknown[] = []
    await engine.prepare()
    const session = await engine.start({ onUpdate, onError: (e) => errors.push(e) })
    await hear(7.5)
    expect(errors).toHaveLength(1)
    expect((await session.stop()).candidates[0].speciesId).toBe('bird-a')
  })
})

describe('the location', () => {
  /** A location model that expects the birds at these BirdNET positions (score 0.5) and no others. */
  const expects = (listed: number[]) => () => {
    const scores = new Float32Array(6522)
    for (const index of listed) scores[index] = 0.5
    return Promise.resolve(scores)
  }
  const allTwelve = Array.from({ length: 12 }, (_, i) => 10 + i)

  async function confidenceOfBirdA(options: { location?: { lat: number; lon: number } }): Promise<number> {
    world.scoresFor = sure(10) // the model is always sure about bird-a
    await engine.prepare()
    const session = await engine.start({ onUpdate, ...options })
    await hear(5.5)
    const result = await session.stop()
    return result.candidates.find((c) => c.speciesId === 'bird-a')?.confidence ?? 0
  }

  it('asks the location model only when there is a position', async () => {
    expect(await confidenceOfBirdA({})).toBeCloseTo(0.9, 5)
    expect(world.geoCalls).toBe(0)
  })

  it('counts a bird the place expects at full strength', async () => {
    world.geoScores = expects(allTwelve)
    expect(await confidenceOfBirdA({ location: { lat: 50, lon: 14 } })).toBeCloseTo(0.9, 5)
    expect(world.geoCalls).toBe(1)
  })

  it('counts a bird the place does not expect at 0.8 of its score, but still counts it', async () => {
    world.geoScores = expects(allTwelve.slice(1)) // eleven birds, all except bird-a
    expect(await confidenceOfBirdA({ location: { lat: 50, lon: 14 } })).toBeCloseTo(0.72, 5)
  })

  it('ignores a place that expects hardly any bird of the Dex (open sea, a bad position)', async () => {
    world.geoScores = expects([11, 12, 13]) // three birds: under the minimum of ten
    expect(await confidenceOfBirdA({ location: { lat: 0, lon: -30 } })).toBeCloseTo(0.9, 5)
  })

  it('runs the location model in the worker that holds BirdNET, and on the page when there is no worker', async () => {
    world.geoScores = expects(allTwelve)
    world.workerOk = true
    await confidenceOfBirdA({ location: { lat: 50, lon: 14 } })
    expect(world.geoComputeGiven).toEqual([true]) // the worker's geoScores was handed over to do the computing
  })

  it('computes the location model on the page when BirdNET runs on the page', async () => {
    world.geoScores = expects(allTwelve)
    await confidenceOfBirdA({ location: { lat: 50, lon: 14 } })
    expect(world.geoComputeGiven).toEqual([false])
  })

  it('carries on without the place when the location model fails', async () => {
    world.geoScores = () => Promise.reject(new Error('no model'))
    expect(await confidenceOfBirdA({ location: { lat: 50, lon: 14 } })).toBeCloseTo(0.9, 5)
  })

  it('carries on without the place when there is no location model in the model list', async () => {
    world.manifestFiles = [MAIN_FILE]
    world.geoScores = expects(allTwelve.slice(1))
    expect(await confidenceOfBirdA({ location: { lat: 50, lon: 14 } })).toBeCloseTo(0.9, 5)
    expect(world.geoCalls).toBe(0)
  })
})

describe('all labels (debug)', () => {
  it('names birds that are not in the Dex from their labels', async () => {
    const labels = Array.from({ length: 6522 }, (_, i) => `Genus${i} species${i}_Bird ${i}`)
    labels[4771] = 'Poecile atricapillus_Black-capped Chickadee'
    const debug = createSoundEngine({ allLabels: labels })
    world.scoresFor = sure(4771)
    await debug.prepare()
    const session = await debug.start({ onUpdate })
    await hear(5.5)
    const result = await session.stop()
    expect(result.candidates[0].speciesId).toBe('poecile-atricapillus')
    await debug.dispose()
  })
})

describe('where BirdNET runs', () => {
  it('asks for a worker by default and says where the model ended up', async () => {
    world.workerOk = true
    const seen: Array<{ mode: string; workerError?: string }> = []
    const e = createSoundEngine({ onModel: (info) => seen.push(info) })
    await e.prepare()
    expect(seen).toEqual([{ mode: 'worker' }])
    await e.dispose()
  })

  it('reports why the worker did not work when the model had to run on the page', async () => {
    world.workerError = 'The BirdNET worker took too long to start'
    const seen: Array<{ mode: string; workerError?: string }> = []
    const e = createSoundEngine({ onModel: (info) => seen.push(info) })
    await e.prepare()
    expect(seen).toEqual([{ mode: 'main', workerError: 'The BirdNET worker took too long to start' }])
    await e.dispose()
  })

  it('can be told to stay on the page', async () => {
    world.workerOk = true
    const seen: string[] = []
    const e = createSoundEngine({ worker: false, onModel: (info) => seen.push(info.mode) })
    await e.prepare()
    expect(seen).toEqual(['main'])
    await e.dispose()
  })
})

describe('giving the memory back', () => {
  async function scanOnce(e: DisposableSoundEngine): Promise<void> {
    world.scoresFor = sure(10)
    await e.prepare()
    const session = await e.start({ onUpdate })
    await hear(3.5)
    await session.stop()
  }

  it('shuts a worker down a minute after the last scan, and loads it again on the next prepare()', async () => {
    world.workerOk = true
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const e = createSoundEngine()
    await scanOnce(e)
    expect(world.models).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(59_000)
    expect(world.models[0].deleted).toBe(false)
    await vi.advanceTimersByTimeAsync(2_000)
    expect(world.models[0].deleted).toBe(true)
    await e.prepare() // the person comes back: loaded again
    expect(world.models).toHaveLength(2)
    expect(world.models[1].deleted).toBe(false)
    await e.dispose()
  })

  it('starts the minute again when the scan screen is opened (prepare) before it is up', async () => {
    world.workerOk = true
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const e = createSoundEngine()
    await scanOnce(e)
    await vi.advanceTimersByTimeAsync(30_000)
    await e.prepare() // the person is back: a new minute begins
    await vi.advanceTimersByTimeAsync(59_000) // 89 seconds after the scan, but only 59 after the last visit
    expect(world.models[0].deleted).toBe(false)
    await vi.advanceTimersByTimeAsync(2_000)
    expect(world.models[0].deleted).toBe(true)
    await e.dispose()
  })

  it('also gives the memory back when the engine was prepared and then never used', async () => {
    world.workerOk = true
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const e = createSoundEngine()
    await e.prepare() // the scan screen opened, nobody tapped anything
    await vi.advanceTimersByTimeAsync(61_000)
    expect(world.models[0].deleted).toBe(true)
    await e.dispose()
  })

  it('does not shut it down while a scan is running', async () => {
    world.workerOk = true
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const e = createSoundEngine({ idleReleaseSeconds: 5 })
    await e.prepare()
    await scanOnce(e) // starts the 5 second countdown when it ends...
    await e.start({ onUpdate }) // ...and a new scan starts before it runs out
    await vi.advanceTimersByTimeAsync(60_000)
    expect(world.models[0].deleted).toBe(false)
    await e.dispose()
  })

  it('keeps a model that runs on the page, because that memory cannot be given back anyway', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const e = createSoundEngine()
    await scanOnce(e)
    await vi.advanceTimersByTimeAsync(600_000)
    expect(world.models[0].deleted).toBe(false)
    await e.dispose()
  })

  it('can be switched off', async () => {
    world.workerOk = true
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const e = createSoundEngine({ idleReleaseSeconds: 0 })
    await scanOnce(e)
    await vi.advanceTimersByTimeAsync(600_000)
    expect(world.models[0].deleted).toBe(false)
    await e.dispose()
  })
})

describe('shutting down while loading', () => {
  it('frees a model that finishes loading after dispose(), and does not pretend it is ready', async () => {
    const e = createSoundEngine()
    const loading = e.prepare().catch((error: Error) => error)
    await e.dispose() // called while the models are still being prepared
    const outcome = await loading
    expect(outcome).toBeInstanceOf(Error)
    expect(world.models.every((model) => model.deleted)).toBe(true)
    // A later prepare() starts from scratch and works.
    await e.prepare()
    expect(world.models.at(-1)!.deleted).toBe(false)
    await e.dispose()
  })
})

describe('dispose', () => {
  it('frees the model and can be prepared again', async () => {
    await engine.prepare()
    await engine.dispose()
    expect(world.models[0].deleted).toBe(true)
    await engine.prepare()
    expect(world.models).toHaveLength(2)
  })

  it('stops a running scan', async () => {
    await engine.prepare()
    await engine.start({ onUpdate })
    await engine.dispose()
    expect(world.captureStop).toHaveBeenCalledTimes(1)
  })
})

describe('the module', () => {
  it('uses the real startCapture mock we set up', () => {
    expect(vi.isMockFunction(startCapture)).toBe(true)
  })
})
