// The live scanner follows the zoomed part of the camera picture: it analyses and saves that part, forgets what it saw when the
// part changes, and drops the answer of a frame whose picture is no longer the one on the screen.
import { describe, expect, it } from 'vitest'
import type { FrameView, LiveUpdate } from '../../src/domain/engines'
import type { VisionFrame, VisionScores } from '../../src/ml/vision/core'
import { createLiveScanner } from '../../src/ml/vision/live'
import { sameView } from '../../src/ml/vision/liveLogic'
import type { VisionRuntime } from '../../src/ml/vision/runtime'
import { makeSpecies } from './helpers/vision-fixtures'

const SIZE = 5

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

function scores(index: number, confidence: number, pBird = 0.98): VisionScores {
  const probs = new Float32Array(SIZE).fill(0.01)
  probs[index] = confidence / pBird
  return { pBird, pRaw: 0.9, probs, outsideMass: 0, outsideTop: 0, bestSimilarity: 0.5, bestDexSimilarity: 0.5, blank: false, timings: { preprocessMs: 1, inferMs: 1, scoreMs: 1 } }
}

function makeVideo() {
  let time = 0
  return {
    readyState: 4,
    videoWidth: 1080,
    videoHeight: 1920,
    paused: false,
    ended: false,
    get currentTime() {
      time += 0.1
      return time
    },
  } as unknown as HTMLVideoElement
}

const FULL: FrameView | undefined = undefined
const ZOOM_2: FrameView = { x: 0.25, y: 0.25, width: 0.5, height: 0.5 }
const ZOOM_4: FrameView = { x: 0.375, y: 0.375, width: 0.25, height: 0.25 }

function setup(options: { durationMs?: number } = {}) {
  const clock = fakeClock()
  const species = makeSpecies([1, 2, 3, 4, 5])
  const updates: LiveUpdate[] = []
  const grabbed: Array<FrameView | undefined> = []
  const snapshots: Array<FrameView | undefined> = []
  const kept: Array<FrameView | undefined> = []
  let started = 0
  const runtime = {
    dex: species,
    prepare: async () => undefined,
    hold: () => () => undefined,
    analyse: (_frame: VisionFrame) =>
      new Promise<VisionScores>((resolve) => {
        started += 1
        if (!options.durationMs) resolve(scores(2, 0.8))
        else clock.setTimer(() => resolve(scores(2, 0.8)), options.durationMs)
      }),
  } as unknown as VisionRuntime
  let view: FrameView | undefined = FULL
  let viewThrows = false
  const scanner = createLiveScanner({
    runtime,
    grab: (_video, frameView) => {
      grabbed.push(frameView)
      return { data: new Uint8ClampedArray(16), width: 2, height: 2, channels: 4 }
    },
    snapshot: async (_source, frameView) => {
      snapshots.push(frameView)
      return new Blob(['live'], { type: 'image/jpeg' })
    },
    keep: (_source, frameView) => {
      kept.push(frameView)
      return 'copy'
    },
    encode: async () => new Blob(['kept'], { type: 'image/jpeg' }),
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    isHidden: () => false,
  })
  const video = makeVideo()
  const start = () =>
    scanner.start(video, {
      onUpdate: (update) => updates.push(update),
      getView: () => {
        if (viewThrows) throw new Error('the screen is gone')
        return view
      },
    })
  return {
    clock,
    updates,
    grabbed,
    snapshots,
    kept,
    start,
    analysesStarted: () => started,
    setView: (next: FrameView | undefined) => {
      view = next
    },
    breakView: () => {
      viewThrows = true
    },
  }
}

describe('sameView', () => {
  it('treats the whole picture as one view, and nearly equal parts as the same', () => {
    expect(sameView(undefined, undefined)).toBe(true)
    expect(sameView(undefined, ZOOM_2)).toBe(false)
    expect(sameView(ZOOM_2, undefined)).toBe(false)
    expect(sameView(ZOOM_2, { ...ZOOM_2 })).toBe(true)
    expect(sameView(ZOOM_2, { ...ZOOM_2, x: ZOOM_2.x + 0.002 })).toBe(true)
    expect(sameView(ZOOM_2, { ...ZOOM_2, x: ZOOM_2.x + 0.02 })).toBe(false)
    expect(sameView(ZOOM_2, ZOOM_4)).toBe(false)
  })
})

describe('the zoomed view in the live scanner', () => {
  it('reads and saves the part the screen shows, and the whole picture when there is no zoom', async () => {
    const t = setup()
    const session = await t.start()
    await t.clock.advance(0)
    await t.clock.advance(800)
    expect(t.grabbed.length).toBeGreaterThanOrEqual(2)
    expect(t.grabbed.every((view) => view === undefined)).toBe(true)

    t.setView(ZOOM_2)
    await t.clock.advance(800)
    expect(t.grabbed.at(-1)).toEqual(ZOOM_2)

    await session.snapshot()
    expect(t.snapshots).toEqual([ZOOM_2])

    // The picture kept for later is the zoomed one too.
    t.setView(ZOOM_4)
    session.stop()
    expect(t.kept).toEqual([ZOOM_4])
    await session.snapshot()
  })

  it('forgets the lock when the view changes, and needs a few frames again', async () => {
    const t = setup()
    await t.start()
    await t.clock.advance(0)
    await t.clock.advance(3000)
    expect(t.updates.at(-1)?.lockedSpeciesId).toBeDefined()
    const framesBefore = t.updates.length

    t.setView(ZOOM_2)
    await t.clock.advance(800)
    const after = t.updates.slice(framesBefore)
    expect(after.length).toBeGreaterThan(0)
    // The first answers of the new view have no lock yet.
    expect(after[0].lockedSpeciesId).toBeUndefined()
    await t.clock.advance(3000)
    expect(t.updates.at(-1)?.lockedSpeciesId).toBeDefined()
  })

  it('drops the answer of a frame that was analysed while the view changed', async () => {
    const t = setup({ durationMs: 1000 })
    await t.start()
    await t.clock.advance(0)
    expect(t.analysesStarted()).toBe(1)
    // The person zooms while the model is still busy with the first frame.
    t.setView(ZOOM_2)
    await t.clock.advance(1100)
    expect(t.updates).toHaveLength(0)
    // The next frame, taken of the new view, is answered normally.
    await t.clock.advance(2500)
    expect(t.updates.length).toBeGreaterThan(0)
  })

  it('carries on with the whole picture when asking for the view fails', async () => {
    const t = setup()
    await t.start()
    await t.clock.advance(0)
    t.breakView()
    await t.clock.advance(2000)
    expect(t.grabbed.at(-1)).toBeUndefined()
    expect(t.updates.length).toBeGreaterThan(0)
  })
})
