import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LiveUpdate, SoundUpdate } from '../../src/domain/engines'
import { evaluateCandidates } from '../../src/domain/thresholds'
import type { ModelProgress } from '../../src/domain/types'
import {
  createFakeEngines,
  createFakeLiveScanner,
  createFakePhotoEngine,
  createFakeSoundEngine,
  FAKE_SCENARIOS,
  FAKE_SPECIES,
  makeFakeClip,
  parseFakeScenario,
} from '../../src/ml/fakes'
import { ModelDownloadError, ModelStorageFullError } from '../../src/ml/runtime/modelErrors'

const nothing = {} as HTMLCanvasElement

afterEach(() => vi.useRealTimers())

describe('the species the fakes talk about', () => {
  it('are the three common garden birds', () => {
    expect(Object.values(FAKE_SPECIES)).toEqual(['parus-major', 'erithacus-rubecula', 'turdus-merula'])
  })

  const speciesFile = join(process.cwd(), 'public', 'data', 'species.json')
  it.skipIf(!existsSync(speciesFile))('exist in the Dex data, once it has been built', () => {
    const parsed: unknown = JSON.parse(readFileSync(speciesFile, 'utf8'))
    const list = (Array.isArray(parsed) ? parsed : (parsed as { species?: unknown }).species) as { id?: string }[] | undefined
    expect(Array.isArray(list)).toBe(true)
    const ids = new Set((list ?? []).map((species) => species.id))
    for (const id of Object.values(FAKE_SPECIES)) expect(ids.has(id), `${id} is in species.json`).toBe(true)
  })
})

describe('what each scenario means for the Catch button', () => {
  const photo = async (scenario: (typeof FAKE_SCENARIOS)[number]) => (await createFakePhotoEngine({ scenario, delayMs: 0 }).identify(nothing)).candidates

  it('clear: a clear winner that can be caught even with strict settings', async () => {
    const candidates = await photo('clear')
    expect(evaluateCandidates(candidates, 'photo', 'strict')[0].allowed).toBe(true)
    expect(evaluateCandidates(candidates, 'live', 'strict')[0].allowed).toBe(true)
    expect(candidates[0].speciesId).toBe('parus-major')
  })

  it('low: nothing can be caught, not even with easy settings', async () => {
    const candidates = await photo('low')
    for (const method of ['photo', 'live'] as const) {
      expect(evaluateCandidates(candidates, method, 'easy').map((verdict) => verdict.reason)).toEqual(['low-confidence', 'low-confidence', 'low-confidence'])
    }
  })

  it('unclear: a confident top guess that is too close to the second one', async () => {
    const candidates = await photo('unclear')
    expect(evaluateCandidates(candidates, 'photo', 'normal')[0]).toMatchObject({ allowed: false, reason: 'unclear-margin' })
    expect(evaluateCandidates(candidates, 'photo', 'easy')[0]).toMatchObject({ allowed: false, reason: 'unclear-margin' })
  })

  it('empty: no bird found', async () => {
    expect(await photo('empty')).toEqual([])
    expect((await createFakePhotoEngine({ scenario: 'empty', delayMs: 0 }).identify(nothing)).pBird).toBeLessThan(0.1)
  })

  it('the sound versions follow the same story', async () => {
    const sound = (scenario: (typeof FAKE_SCENARIOS)[number]) => {
      vi.useFakeTimers()
      return createFakeSoundEngine({ scenario, delayMs: 10 })
    }
    const settle = async (scenario: (typeof FAKE_SCENARIOS)[number]) => {
      const engine = sound(scenario)
      const preparing = engine.prepare()
      await vi.advanceTimersByTimeAsync(100)
      await preparing
      const session = await engine.start({ onUpdate: () => undefined })
      await vi.advanceTimersByTimeAsync(100)
      const result = await session.stop()
      vi.useRealTimers()
      return result.candidates
    }
    expect(evaluateCandidates(await settle('clear'), 'sound', 'strict')[0].allowed).toBe(true)
    expect(evaluateCandidates(await settle('low'), 'sound', 'easy').some((verdict) => verdict.allowed)).toBe(false)
    expect(await settle('empty')).toEqual([])
    // Two birds at once is fine for sound: the scores do not compete.
    expect(evaluateCandidates(await settle('unclear'), 'sound', 'normal').filter((verdict) => verdict.allowed)).toHaveLength(2)
  })
})

describe('preparing the models', () => {
  const collect = async (prepare: (onProgress: (progress: ModelProgress) => void) => Promise<void>) => {
    const events: ModelProgress[] = []
    await prepare((progress) => events.push(progress))
    return events
  }

  it('shows a download that grows, then preparing, then ready', async () => {
    const engine = createFakeSoundEngine({ delayMs: 0 })
    const events = await collect((onProgress) => engine.prepare(onProgress))
    expect(events[0]).toMatchObject({ modelId: 'birdnet', stage: 'downloading', loadedBytes: 0 })
    expect(events.map((event) => event.stage)).toEqual(['downloading', 'downloading', 'downloading', 'downloading', 'downloading', 'preparing', 'ready'])
    const loaded = events.map((event) => event.loadedBytes)
    expect([...loaded].sort((a, b) => a - b)).toEqual(loaded)
    expect(events.at(-1)?.loadedBytes).toBe(events.at(-1)?.totalBytes)
    expect(events.every((event) => event.totalBytes === 25_932_528 + 14_770_468)).toBe(true)
  })

  it('says "ready" at once the second time', async () => {
    const engine = createFakePhotoEngine({ delayMs: 0 })
    await engine.prepare()
    const events = await collect((onProgress) => engine.prepare(onProgress))
    expect(events).toEqual([expect.objectContaining({ modelId: 'wingclip', stage: 'ready' })])
  })

  it('fails once with a download error and then works (to test "try again")', async () => {
    const engine = createFakePhotoEngine({ scenario: 'download-error', delayMs: 0 })
    const events: ModelProgress[] = []
    const error = await engine.prepare((progress) => events.push(progress)).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ModelDownloadError)
    expect(error).toMatchObject({ reason: 'network' })
    expect(events.length).toBeGreaterThan(0)
    expect(events.at(-1)?.stage).toBe('downloading')
    await expect(engine.prepare()).resolves.toBeUndefined()
    expect((await engine.identify(nothing)).candidates.length).toBeGreaterThan(0)
  })

  it('always fails with a storage error in the storage-full story', async () => {
    const engine = createFakeSoundEngine({ scenario: 'storage-full', delayMs: 0 })
    await expect(engine.prepare()).rejects.toBeInstanceOf(ModelStorageFullError)
    await expect(engine.prepare()).rejects.toBeInstanceOf(ModelStorageFullError)
    await expect(engine.start({ onUpdate: () => undefined })).rejects.toBeInstanceOf(ModelStorageFullError)
  })

  it('prepares by itself when a scan starts without prepare()', async () => {
    const engine = createFakeSoundEngine({ delayMs: 0 })
    const session = await engine.start({ onUpdate: () => undefined })
    await session.stop()
  })
})

describe('the fake sound engine', () => {
  async function listen(options: { scenario?: (typeof FAKE_SCENARIOS)[number] } = {}) {
    vi.useFakeTimers()
    const engine = createFakeSoundEngine({ delayMs: 100, ...options })
    const preparing = engine.prepare()
    await vi.advanceTimersByTimeAsync(400)
    await preparing
    const updates: SoundUpdate[] = []
    const session = await engine.start({ onUpdate: (update) => updates.push(update) })
    return { session, updates, tick: (n = 1) => vi.advanceTimersByTimeAsync(100 * n) }
  }

  it('listens: silent for the first two steps, then the guesses appear and grow', async () => {
    const { session, updates, tick } = await listen()
    await tick(2)
    expect(updates).toHaveLength(2)
    expect(updates.every((update) => update.candidates.length === 0 && !update.hearingBird)).toBe(true)

    await tick()
    expect(updates[2].candidates.map((c) => c.speciesId)).toEqual(['parus-major', 'turdus-merula', 'erithacus-rubecula'])
    expect(updates[2].candidates[0].confidence).toBeCloseTo(0.546, 3)
    expect(updates[2].hearingBird).toBe(true)

    await tick(3)
    expect(updates.at(-1)?.candidates[0].confidence).toBe(0.91)
    expect(updates.map((update) => update.analysedSeconds)).toEqual([1, 2, 3, 4, 5, 6])
    for (const update of updates) {
      expect(update.level).toBeGreaterThanOrEqual(0)
      expect(update.level).toBeLessThanOrEqual(1)
      expect(update.candidates.length).toBeLessThanOrEqual(3)
    }
    await session.stop()
  })

  it('stops for real: no more updates and no timers left', async () => {
    const { session, updates, tick } = await listen()
    await tick(4)
    const result = await session.stop()
    const seen = updates.length
    await tick(10)
    expect(updates).toHaveLength(seen)
    expect(vi.getTimerCount()).toBe(0)

    expect(result.candidates[0]).toEqual({ speciesId: 'parus-major', confidence: expect.any(Number) })
    expect(result.clipSeconds).toBe(2)
    expect(result.clip?.type).toBe('audio/wav')
    expect(result.clip?.size).toBe(44 + 2 * 48_000 * 2)
  })

  it('has nothing to report when stopped too early', async () => {
    const { session, tick } = await listen()
    await tick(2)
    expect(await session.stop()).toEqual({ candidates: [] })
  })

  it('hears nothing in the empty story, and is unsure in the low story', async () => {
    const empty = await listen({ scenario: 'empty' })
    await empty.tick(6)
    expect(empty.updates.every((update) => update.candidates.length === 0 && !update.hearingBird)).toBe(true)
    expect(await empty.session.stop()).toEqual({ candidates: [] })

    const low = await listen({ scenario: 'low' })
    await low.tick(6)
    expect(low.updates.at(-1)?.candidates[0]).toEqual({ speciesId: 'erithacus-rubecula', confidence: 0.41 })
    await low.session.stop()
  })

  it('does not share its results between sessions', async () => {
    const first = await listen()
    await first.tick(5)
    const result = await first.session.stop()
    result.candidates[0].confidence = 0
    const second = await listen()
    await second.tick(5)
    expect((await second.session.stop()).candidates[0].confidence).toBe(0.91)
  })
})

describe('the fake photo engine', () => {
  it('answers after a delay with a copy of the story', async () => {
    vi.useFakeTimers()
    const engine = createFakePhotoEngine({ delayMs: 100 })
    const preparing = engine.prepare()
    await vi.advanceTimersByTimeAsync(400)
    await preparing

    let done = false
    const pending = engine.identify(nothing).then((result) => {
      done = true
      return result
    })
    await vi.advanceTimersByTimeAsync(150)
    expect(done).toBe(false)
    await vi.advanceTimersByTimeAsync(100)
    const result = await pending
    expect(result.candidates).toEqual([
      { speciesId: 'parus-major', confidence: 0.88 },
      { speciesId: 'erithacus-rubecula', confidence: 0.07 },
      { speciesId: 'turdus-merula', confidence: 0.03 },
    ])
    expect(result.pBird).toBe(0.97)
    result.candidates[0].confidence = 0
    vi.useRealTimers()
    expect((await createFakePhotoEngine({ delayMs: 0 }).identify(nothing)).candidates[0].confidence).toBe(0.88)
  })
})

describe('the fake live camera', () => {
  async function watch(scenario?: (typeof FAKE_SCENARIOS)[number]) {
    vi.useFakeTimers()
    const scanner = createFakeLiveScanner({ delayMs: 100, ...(scenario ? { scenario } : {}) })
    const updates: LiveUpdate[] = []
    const startedAt = scanner.start({} as HTMLVideoElement, { onUpdate: (update) => updates.push(update) })
    // Preparing the fake models takes 300 ms at this speed; the first frame comes one step after that.
    await vi.advanceTimersByTimeAsync(300)
    const session = await startedAt
    return { session, updates, tick: (n = 1) => vi.advanceTimersByTimeAsync(100 * n) }
  }

  it('locks on after three frames in a clear scene', async () => {
    const { session, updates, tick } = await watch()
    await tick(5)
    expect(updates.map((update) => update.lockedSpeciesId)).toEqual([undefined, undefined, 'parus-major', 'parus-major', 'parus-major'])
    expect(updates[0].candidates[0].speciesId).toBe('parus-major')
    expect(updates.at(-1)?.candidates[0].confidence).toBe(0.88)
    expect(updates[0].candidates[0].confidence).toBeLessThan(updates.at(-1)?.candidates[0].confidence ?? 0)
    expect(updates.every((update) => update.framesPerSecond === 10)).toBe(true)
    expect(updates.at(-1)?.pBird).toBeGreaterThan(0.9)
    session.stop()
  })

  it('never locks on in a shaky, low-confidence scene, because the top guess keeps changing', async () => {
    const { session, updates, tick } = await watch('low')
    await tick(8)
    expect(updates.some((update) => update.lockedSpeciesId)).toBe(false)
    const tops = updates.map((update) => update.candidates[0].speciesId)
    expect(new Set(tops).size).toBeGreaterThan(1)
    session.stop()
  })

  it('locks on to the leader in an unclear scene (the Catch button then says why it is off)', async () => {
    const { session, updates, tick } = await watch('unclear')
    await tick(5)
    expect(updates.at(-1)?.lockedSpeciesId).toBe('turdus-merula')
    session.stop()
  })

  it('sees no bird in the empty story', async () => {
    const { session, updates, tick } = await watch('empty')
    await tick(5)
    expect(updates.every((update) => update.candidates.length === 0 && update.lockedSpeciesId === undefined)).toBe(true)
    expect(updates.at(-1)?.pBird).toBeLessThan(0.1)
    session.stop()
  })

  it('stops for real', async () => {
    const { session, updates, tick } = await watch()
    await tick(3)
    session.stop()
    const seen = updates.length
    await tick(5)
    expect(updates).toHaveLength(seen)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('takes a snapshot as a JPEG even when the video has no picture yet', async () => {
    const { session } = await watch()
    const blob = await session.snapshot()
    expect(blob.type).toBe('image/jpeg')
    const bytes = new Uint8Array(await blob.arrayBuffer())
    expect(Array.from(bytes.slice(0, 3))).toEqual([0xff, 0xd8, 0xff])
    expect(Array.from(bytes.slice(-2))).toEqual([0xff, 0xd9])
    session.stop()
  })
})

describe('the fake clip', () => {
  it('is a real 16-bit mono 48 kHz WAV with something to hear', async () => {
    const clip = makeFakeClip(2)
    expect(clip.type).toBe('audio/wav')
    const bytes = new Uint8Array(await clip.arrayBuffer())
    const view = new DataView(bytes.buffer)
    const text = (at: number, length: number) => String.fromCharCode(...bytes.slice(at, at + length))
    expect(text(0, 4)).toBe('RIFF')
    expect(text(8, 4)).toBe('WAVE')
    expect(text(12, 4)).toBe('fmt ')
    expect(view.getUint16(20, true)).toBe(1) // PCM
    expect(view.getUint16(22, true)).toBe(1) // mono
    expect(view.getUint32(24, true)).toBe(48_000)
    expect(view.getUint16(34, true)).toBe(16)
    expect(text(36, 4)).toBe('data')
    expect(view.getUint32(40, true)).toBe(2 * 48_000 * 2)
    expect(view.getUint32(4, true)).toBe(bytes.length - 8)

    let loudest = 0
    for (let i = 44; i < 44 + 48_000 * 2; i += 2) loudest = Math.max(loudest, Math.abs(view.getInt16(i, true)))
    expect(loudest).toBeGreaterThan(5000)
    expect(loudest).toBeLessThan(32768)
    // The end of the clip is quiet.
    expect(view.getInt16(bytes.length - 2, true)).toBe(0)
  })

  it('can be any length', () => {
    expect(makeFakeClip(1).size).toBe(44 + 2 * 48_000)
  })
})

describe('createFakeEngines and parseFakeScenario', () => {
  it('builds all three engines with the same story', async () => {
    const engines = createFakeEngines({ scenario: 'empty', delayMs: 0 })
    expect((await engines.photo.identify(nothing)).candidates).toEqual([])
    expect(Object.keys(engines).sort()).toEqual(['live', 'photo', 'sound'])
  })

  it('accepts the known scenario names and falls back to "clear" for anything else', () => {
    for (const scenario of FAKE_SCENARIOS) expect(parseFakeScenario(scenario)).toBe(scenario)
    expect(parseFakeScenario(undefined)).toBe('clear')
    expect(parseFakeScenario('')).toBe('clear')
    expect(parseFakeScenario('LOW')).toBe('clear')
    expect(parseFakeScenario('nonsense')).toBe('clear')
  })
})
