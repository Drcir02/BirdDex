import { describe, expect, it } from 'vitest'
import type { LiveUpdate } from '../../src/domain/engines'
import type { Species } from '../../src/domain/types'
import type { VisionFrame, VisionScores } from '../../src/ml/vision/core'
import { createLiveScanner } from '../../src/ml/vision/live'
import type { VisionRuntime } from '../../src/ml/vision/runtime'
import { setOccurrencePriorProvider } from '../../src/ml/vision/prior'
import { makeSpecies } from './helpers/vision-fixtures'

const SIZE = 5

/** Time that only moves when the test says so. Timers fire in order, and the promise chains settle after each. */
function fakeClock() {
  let now = 0
  let nextHandle = 1
  const timers = new Map<number, { at: number; callback: () => void }>()
  const flush = async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve()
  }
  return {
    now: () => now,
    setTimer: (callback: () => void, ms: number) => {
      const handle = nextHandle++
      timers.set(handle, { at: now + ms, callback })
      return handle
    },
    clearTimer: (handle: unknown) => void timers.delete(handle as number),
    pending: () => timers.size,
    flush,
    async advance(ms: number) {
      const end = now + ms
      for (;;) {
        const due = [...timers].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0]
        if (!due) break
        now = Math.max(now, due[1].at)
        timers.delete(due[0])
        due[1].callback()
        await flush()
      }
      now = end
      await flush()
    },
  }
}

type Clock = ReturnType<typeof fakeClock>

function scores(index: number, confidence: number, pBird = 0.98): VisionScores {
  const probs = new Float32Array(SIZE).fill(0.01)
  probs[index] = confidence / pBird
  return { pBird, pRaw: 0.9, probs, outsideMass: 0, outsideTop: 0, bestSimilarity: 0.5, bestDexSimilarity: 0.5, blank: false, timings: { preprocessMs: 1, inferMs: 1, scoreMs: 1 } }
}

function makeVideo() {
  let time = 0
  const video = {
    readyState: 4,
    videoWidth: 640,
    videoHeight: 480,
    paused: false,
    ended: false,
    get currentTime() {
      time += 0.1
      return time
    },
  }
  return video as unknown as HTMLVideoElement & { readyState: number; paused: boolean; videoWidth: number }
}

interface Setup {
  clock: Clock
  updates: LiveUpdate[]
  errors: unknown[]
  analyses: { startedAt: number; frame: VisionFrame }[]
  grabs: number
  holds: { open: number; closed: number }
  video: ReturnType<typeof makeVideo>
  species: Species[]
}

/** `answer` makes the scores for the n-th analysis; `durationMs` is how long the fake model takes. */
function setup(options: { answer?: (n: number) => VisionScores | Error; durationMs?: number | ((n: number) => number); hidden?: () => boolean } = {}) {
  const clock = fakeClock()
  const species = makeSpecies([1, 2, 3, 4, 5])
  const state: Setup = { clock, updates: [], errors: [], analyses: [], grabs: 0, holds: { open: 0, closed: 0 }, video: makeVideo(), species }
  const answer = options.answer ?? (() => scores(2, 0.8))
  const runtime = {
    dex: species,
    prepare: async () => undefined,
    hold: () => {
      state.holds.open++
      return () => {
        state.holds.closed++
      }
    },
    analyse: (frame: VisionFrame) =>
      new Promise<VisionScores>((resolve, reject) => {
        const n = state.analyses.length
        state.analyses.push({ startedAt: clock.now(), frame })
        const duration = typeof options.durationMs === 'function' ? options.durationMs(n) : (options.durationMs ?? 0)
        const finish = () => {
          const result = answer(n)
          if (result instanceof Error) reject(result)
          else resolve(result)
        }
        if (duration === 0) finish()
        else clock.setTimer(finish, duration)
      }),
  } as unknown as VisionRuntime
  const kept: unknown[] = []
  const scanner = createLiveScanner({
    runtime,
    grab: () => {
      state.grabs++
      return { data: new Uint8ClampedArray(16), width: 2, height: 2, channels: 4 }
    },
    snapshot: async () => new Blob(['live'], { type: 'image/jpeg' }),
    keep: () => {
      kept.push('copy')
      return 'copy'
    },
    encode: async () => new Blob(['kept'], { type: 'image/jpeg' }),
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    isHidden: options.hidden ?? (() => false),
  })
  const start = () =>
    scanner.start(state.video, {
      onUpdate: (update) => state.updates.push(update),
      onError: (error) => state.errors.push(error),
    } as Parameters<typeof scanner.start>[1])
  return { state, start, kept }
}

describe('the frame loop', () => {
  it('takes a frame at most every 700 ms, even when the model is instant', async () => {
    const { state, start } = setup()
    await start()
    await state.clock.advance(0)
    expect(state.analyses.map((a) => a.startedAt)).toEqual([0])
    await state.clock.advance(699)
    expect(state.analyses).toHaveLength(1)
    await state.clock.advance(1)
    expect(state.analyses.map((a) => a.startedAt)).toEqual([0, 700])
    await state.clock.advance(1400)
    expect(state.analyses.map((a) => a.startedAt)).toEqual([0, 700, 1400, 2100])
  })

  it('never starts a second analysis while the first is still running', async () => {
    const { state, start } = setup({ durationMs: 5000 })
    await start()
    await state.clock.advance(4900)
    expect(state.analyses).toHaveLength(1)
    expect(state.grabs).toBe(1)
    await state.clock.advance(200)
    // the first finished at 5000; the next one waits for the pause that keeps the model under 80 percent of the time
    expect(state.updates).toHaveLength(1)
    expect(state.analyses).toHaveLength(1)
    await state.clock.advance(5000 / 0.8 - 5000)
    expect(state.analyses).toHaveLength(2)
  })

  it('gives a slow model longer pauses than 700 ms, so it is busy at most 80 percent of the time', async () => {
    const { state, start } = setup({ durationMs: 1000 })
    await start()
    await state.clock.advance(10_000)
    const starts = state.analyses.map((a) => a.startedAt)
    expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(1250)
    expect(starts[2] - starts[1]).toBeGreaterThanOrEqual(1249)
    expect(starts.length).toBeLessThanOrEqual(9)
  })

  it('reports the frames per second it really manages', async () => {
    const { state, start } = setup({ durationMs: 100 })
    await start()
    await state.clock.advance(7000)
    const last = state.updates[state.updates.length - 1]
    expect(last.framesPerSecond).toBeGreaterThan(1.3)
    expect(last.framesPerSecond).toBeLessThan(1.5)
    expect(state.updates[0].framesPerSecond).toBeGreaterThan(0)
  })

  it('does not look at the camera while the page is hidden or the camera is paused or has no picture yet', async () => {
    let hidden = true
    const { state, start } = setup({ hidden: () => hidden })
    await start()
    await state.clock.advance(2000)
    expect(state.grabs).toBe(0)
    hidden = false
    state.video.paused = true
    await state.clock.advance(2000)
    expect(state.grabs).toBe(0)
    state.video.paused = false
    state.video.readyState = 1
    await state.clock.advance(2000)
    expect(state.grabs).toBe(0)
    state.video.readyState = 4
    await state.clock.advance(300)
    expect(state.grabs).toBe(1)
  })

  it('skips a frame that is the same picture as the last one', async () => {
    const { state, start } = setup()
    let time = 1
    Object.defineProperty(state.video, 'currentTime', { get: () => time })
    await start()
    await state.clock.advance(3000)
    expect(state.analyses).toHaveLength(1)
    time = 2
    await state.clock.advance(400)
    expect(state.analyses).toHaveLength(2)
  })
})

describe('what the screens get', () => {
  it('top guesses with the species ids of the Dex, strongest first, and the smoothed P(bird)', async () => {
    const { state, start } = setup({ answer: () => scores(3, 0.7) })
    await start()
    await state.clock.advance(0)
    const [update] = state.updates
    expect(update.candidates[0].speciesId).toBe('sp-3')
    expect(update.candidates[0].confidence).toBeCloseTo(0.7, 5)
    expect(update.candidates).toHaveLength(3)
    expect(update.pBird).toBeCloseTo(0.98, 5)
    expect(update.lockedSpeciesId).toBeUndefined()
  })

  it('carries the smoothed outsideDexTop of the plain model', async () => {
    const { state, start } = setup({ answer: () => ({ ...scores(3, 0.7), outsideTop: 0.3 }) })
    await start()
    await state.clock.advance(0)
    expect(state.updates[0].outsideDexTop).toBeCloseTo(0.3, 6)
  })

  it('locks on the bird after three steady frames, and says which', async () => {
    const { state, start } = setup({ answer: () => scores(2, 0.8) })
    await start()
    await state.clock.advance(2100)
    const locks = state.updates.map((u) => u.lockedSpeciesId)
    expect(locks.slice(0, 4)).toEqual([undefined, undefined, 'sp-2', 'sp-2'])
  })

  it('does not lock while the guesses jump around (three birds taking turns)', async () => {
    const { state, start } = setup({ answer: (n) => scores([1, 3, 4][n % 3], 0.8) })
    await start()
    await state.clock.advance(7000)
    expect(state.updates.length).toBeGreaterThan(8)
    expect(state.updates.every((u) => u.lockedSpeciesId === undefined)).toBe(true)
  })

  it('shows no guesses for a picture that is no bird', async () => {
    const { state, start } = setup({ answer: () => scores(2, 0.01, 0.05) })
    await start()
    await state.clock.advance(2000)
    expect(state.updates.every((u) => u.candidates.length === 0)).toBe(true)
  })

  it('shows no guesses for a blank frame', async () => {
    const blank: VisionScores = { ...scores(0, 0), blank: true, pBird: 0, probs: new Float32Array(SIZE) }
    const { state, start } = setup({ answer: () => blank })
    await start()
    await state.clock.advance(1500)
    expect(state.updates.length).toBeGreaterThan(1)
    expect(state.updates.every((u) => u.candidates.length === 0 && u.pBird === 0)).toBe(true)
  })

  it('keeps going when the screen throws in onUpdate', async () => {
    const { state } = setup()
    const clock = state.clock
    let calls = 0
    const scanner = createLiveScanner({
      runtime: {
        dex: state.species,
        prepare: async () => undefined,
        hold: () => () => undefined,
        analyse: async () => scores(2, 0.8),
      } as unknown as VisionRuntime,
      grab: () => ({ data: new Uint8ClampedArray(16), width: 2, height: 2, channels: 4 }),
      now: clock.now,
      setTimer: clock.setTimer,
      clearTimer: clock.clearTimer,
      isHidden: () => false,
    })
    const originalError = console.error
    console.error = () => undefined
    try {
      await scanner.start(state.video, {
        onUpdate: () => {
          calls++
          throw new Error('the screen broke')
        },
      })
      await clock.advance(2200)
    } finally {
      console.error = originalError
    }
    expect(calls).toBeGreaterThan(2)
  })

  it('asks the registered prior once, when it starts, and gives it to every analysis', async () => {
    let asked = 0
    setOccurrencePriorProvider(async (request) => {
      asked++
      expect(request.location).toEqual({ lat: 50, lon: 14 })
      return new Map([['sp-1', 0.2]])
    })
    try {
      const { state } = setup()
      const priors: unknown[] = []
      const clock = state.clock
      const scanner = createLiveScanner({
        runtime: {
          dex: state.species,
          prepare: async () => undefined,
          hold: () => () => undefined,
          analyse: async (_frame: VisionFrame, options?: { logPrior?: Float32Array }) => {
            priors.push(options?.logPrior)
            return scores(2, 0.8)
          },
        } as unknown as VisionRuntime,
        grab: () => ({ data: new Uint8ClampedArray(16), width: 2, height: 2, channels: 4 }),
        now: clock.now,
        setTimer: clock.setTimer,
        clearTimer: clock.clearTimer,
        isHidden: () => false,
      })
      await scanner.start(state.video, { location: { lat: 50, lon: 14 }, onUpdate: () => undefined })
      await clock.advance(2200)
      expect(asked).toBe(1)
      expect(priors.length).toBeGreaterThan(2)
      expect(priors.every((p) => p instanceof Float32Array && p === priors[0])).toBe(true)
    } finally {
      setOccurrencePriorProvider(undefined)
    }
  })
})

describe('failures and stopping', () => {
  it('survives a failed analysis, and gives up with onError after three in a row', async () => {
    const failure = new Error('worker died')
    const { state, start } = setup({ answer: (n) => (n === 1 ? failure : n >= 4 ? failure : scores(2, 0.8)) })
    await start()
    await state.clock.advance(20_000)
    // frame 0 ok, 1 failed, 2 and 3 ok (the count starts again), then 4, 5, 6 fail in a row
    expect(state.errors).toEqual([failure])
    expect(state.updates).toHaveLength(3)
    expect(state.analyses).toHaveLength(7)
    expect(state.clock.pending()).toBe(0)
    expect(state.holds).toEqual({ open: 1, closed: 1 })
  })

  it('counts scores that do not fit the Dex as a failed analysis, and survives an onError that throws', async () => {
    const wrongSize: VisionScores = { ...scores(0, 0.9), probs: new Float32Array(SIZE - 2).fill(0.1) }
    const { state } = setup()
    const clock = state.clock
    const errors: unknown[] = []
    const scanner = createLiveScanner({
      runtime: { dex: state.species, prepare: async () => undefined, hold: () => () => undefined, analyse: async () => wrongSize } as unknown as VisionRuntime,
      grab: () => ({ data: new Uint8ClampedArray(16), width: 2, height: 2, channels: 4 }),
      now: clock.now,
      setTimer: clock.setTimer,
      clearTimer: clock.clearTimer,
      isHidden: () => false,
    })
    const originalError = console.error
    console.error = () => undefined
    try {
      await scanner.start(state.video, {
        onUpdate: () => errors.push('update'),
        onError: (error) => {
          errors.push(error)
          throw new Error('the screen broke while handling the error')
        },
      })
      await clock.advance(10_000)
    } finally {
      console.error = originalError
    }
    expect(errors).toHaveLength(1)
    expect(errors[0]).toBeInstanceOf(RangeError)
    expect(clock.pending()).toBe(0)
  })

  it('stop() ends the loop, ignores an analysis that is still running and lets the model go', async () => {
    const { state, start } = setup({ durationMs: 500 })
    const session = await start()
    await state.clock.advance(100)
    expect(state.analyses).toHaveLength(1)
    session.stop()
    expect(state.holds).toEqual({ open: 1, closed: 1 })
    await state.clock.advance(5000)
    expect(state.updates).toHaveLength(0)
    expect(state.analyses).toHaveLength(1)
    expect(state.clock.pending()).toBe(0)
    session.stop() // twice is fine
    expect(state.holds.closed).toBe(1)
  })

  it('can be stopped from inside onUpdate (a screen that stops at the lock)', async () => {
    const { state } = setup({ answer: () => scores(2, 0.8) })
    const clock = state.clock
    const scanner = createLiveScanner({
      runtime: { dex: state.species, prepare: async () => undefined, hold: () => () => undefined, analyse: async () => scores(2, 0.8) } as unknown as VisionRuntime,
      grab: () => ({ data: new Uint8ClampedArray(16), width: 2, height: 2, channels: 4 }),
      now: clock.now,
      setTimer: clock.setTimer,
      clearTimer: clock.clearTimer,
      isHidden: () => false,
    })
    let updates = 0
    const session = await scanner.start(state.video, {
      onUpdate: (update) => {
        updates++
        if (update.lockedSpeciesId) session.stop()
      },
    })
    await clock.advance(10_000)
    expect(updates).toBe(3)
    expect(clock.pending()).toBe(0)
  })

  it('does not start the loop, and lets the model go, when the model cannot be prepared', async () => {
    const { state } = setup()
    const scanner = createLiveScanner({
      runtime: {
        dex: state.species,
        prepare: async () => {
          throw new Error('no model')
        },
        hold: () => {
          state.holds.open++
          return () => {
            state.holds.closed++
          }
        },
      } as unknown as VisionRuntime,
      now: state.clock.now,
      setTimer: state.clock.setTimer,
      clearTimer: state.clock.clearTimer,
    })
    await expect(scanner.start(state.video, { onUpdate: () => undefined })).rejects.toThrow('no model')
    expect(state.holds).toEqual({ open: 1, closed: 1 })
    expect(state.clock.pending()).toBe(0)
  })
})

describe('snapshot', () => {
  it('is a JPEG of the camera picture while the scanner runs', async () => {
    const { start } = setup()
    const session = await start()
    const blob = await session.snapshot()
    expect(blob.type).toBe('image/jpeg')
    expect(await blob.text()).toBe('live')
  })

  it('still works after stop(), from the picture kept at that moment', async () => {
    const { state, start, kept } = setup()
    const session = await start()
    session.stop()
    expect(kept).toHaveLength(1)
    state.video.readyState = 0 // the screen has switched the camera off
    expect(await (await session.snapshot()).text()).toBe('kept')
  })

  it('says so when there is no picture at all', async () => {
    const { state, start } = setup()
    state.video.readyState = 0
    const session = await start()
    session.stop()
    await expect(session.snapshot()).rejects.toThrow()
  })
})
