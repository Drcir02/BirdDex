import { describe, expect, it } from 'vitest'
import { Average, LiveTracker, nextDelayMs, type LiveFrameInput } from '../../src/ml/vision/liveLogic'
import { LIVE } from '../../src/ml/vision/constants'

/** A frame where `index` has `confidence` and everything else a little. */
function frame(size: number, scores: Record<number, number>, pBird = 0.98): LiveFrameInput {
  const confidences = new Array<number>(size).fill(0.01)
  for (const [index, value] of Object.entries(scores)) confidences[Number(index)] = value
  return { confidences, pBird }
}

describe('smoothing', () => {
  it('starts with the first frame as it is', () => {
    const tracker = new LiveTracker(4)
    const state = tracker.update(frame(4, { 2: 0.9 }))
    expect(state.guesses[0]).toEqual({ index: 2, confidence: expect.closeTo(0.9, 6) })
    expect(state.pBird).toBeCloseTo(0.98, 6)
    expect(state.frames).toBe(1)
  })

  it('is an exponential average over about five frames: alpha = 2 / (5 + 1)', () => {
    const tracker = new LiveTracker(3)
    tracker.update(frame(3, { 0: 0.9 }))
    // one frame later the bird is gone: 0.9 -> 0.9 + (0.01 - 0.9) / 3
    const next = tracker.update(frame(3, { 0: 0.01 }))
    const expected = 0.9 + (0.01 - 0.9) / 3
    expect(next.guesses.find((g) => g.index === 0)?.confidence).toBeCloseTo(expected, 5)
    // a frame's weight shrinks by 2/3 each step: after five more frames the first is worth (2/3)^5 = 13 percent
    let state = next
    for (let i = 0; i < 5; i++) state = tracker.update(frame(3, { 0: 0.01 }))
    const remaining = state.guesses.find((g) => g.index === 0)!.confidence
    expect(remaining).toBeCloseTo(0.01 + (expected - 0.01) * Math.pow(2 / 3, 5), 5)
  })

  it('smooths the probability of a bird in the picture too', () => {
    const tracker = new LiveTracker(2)
    tracker.update(frame(2, { 0: 0.9 }, 1))
    const state = tracker.update(frame(2, { 0: 0.9 }, 0.4))
    expect(state.pBird).toBeCloseTo(1 + (0.4 - 1) / 3, 6)
  })

  it('smooths outsideDexTop like pBird, and counts a missing value as 0', () => {
    const tracker = new LiveTracker(2)
    expect(tracker.update({ ...frame(2, { 0: 0.9 }), outsideDexTop: 0.6 }).outsideDexTop).toBeCloseTo(0.6, 6)
    expect(tracker.update({ ...frame(2, { 0: 0.9 }), outsideDexTop: 0 }).outsideDexTop).toBeCloseTo(0.6 - 0.6 / 3, 6)
    tracker.reset()
    expect(tracker.update(frame(2, { 0: 0.9 })).outsideDexTop).toBe(0)
  })

  it('reports the three strongest guesses, strongest first', () => {
    const tracker = new LiveTracker(6)
    const state = tracker.update(frame(6, { 1: 0.2, 3: 0.6, 4: 0.3, 5: 0.25 }))
    expect(state.guesses.map((g) => g.index)).toEqual([3, 4, 5])
  })

  it('forgets everything on reset', () => {
    const tracker = new LiveTracker(3)
    for (let i = 0; i < 4; i++) tracker.update(frame(3, { 1: 0.9 }))
    tracker.reset()
    const state = tracker.update(frame(3, { 2: 0.9 }))
    expect(state.frames).toBe(1)
    expect(state.lockedIndex).toBeUndefined()
    expect(state.guesses[0].index).toBe(2)
    expect(state.guesses[0].confidence).toBeCloseTo(0.9, 6)
  })

  it('refuses a frame with the wrong number of species', () => {
    expect(() => new LiveTracker(3).update(frame(4, {}))).toThrow(RangeError)
  })
})

describe('locking on', () => {
  it('locks when the same species leads for three frames in a row above 0.4, and not before', () => {
    const tracker = new LiveTracker(5)
    const locks = [1, 2, 3, 4].map(() => tracker.update(frame(5, { 3: 0.8 })).lockedIndex)
    expect(locks).toEqual([undefined, undefined, 3, 3])
  })

  it('does not lock when the smoothed confidence stays at or below 0.4', () => {
    const tracker = new LiveTracker(5)
    for (let i = 0; i < 12; i++) expect(tracker.update(frame(5, { 3: 0.4 })).lockedIndex).toBeUndefined()
    for (let i = 0; i < 12; i++) expect(tracker.update(frame(5, { 3: 0.39 })).lockedIndex).toBeUndefined()
  })

  it('needs the three frames to be in a row: a frame with another leader starts the count again', () => {
    const tracker = new LiveTracker(5, { smoothingFrames: 1 }) // alpha 1: no memory, so every frame stands for itself
    const sequence: Record<number, number>[] = [{ 3: 0.8 }, { 3: 0.8 }, { 1: 0.8 }, { 3: 0.8 }, { 3: 0.8 }, { 3: 0.8 }]
    const locks = sequence.map((scores) => tracker.update(frame(5, scores)).lockedIndex)
    expect(locks).toEqual([undefined, undefined, undefined, undefined, undefined, 3])
  })

  it('counts a weak frame in the middle as a break', () => {
    const tracker = new LiveTracker(5, { smoothingFrames: 1 })
    const sequence: Record<number, number>[] = [{ 3: 0.8 }, { 3: 0.8 }, { 3: 0.3 }, { 3: 0.8 }, { 3: 0.8 }]
    expect(sequence.map((scores) => tracker.update(frame(5, scores)).lockedIndex)).toEqual([undefined, undefined, undefined, undefined, undefined])
  })

  it('reaches the lock a little later with smoothing, because the average has to build up', () => {
    const tracker = new LiveTracker(5)
    // the scene is empty for a while, then a bird appears and stays
    for (let i = 0; i < 3; i++) tracker.update(frame(5, {}, 0.99))
    const locks = Array.from({ length: 8 }, () => tracker.update(frame(5, { 2: 0.9 })).lockedIndex)
    const first = locks.findIndex((l) => l === 2)
    expect(first).toBeGreaterThanOrEqual(3)
    expect(first).toBeLessThanOrEqual(6)
    expect(locks.slice(first).every((l) => l === 2)).toBe(true)
  })

  it('keeps the lock through one blurry frame (hysteresis) and gives it up after two frames without the lead', () => {
    const tracker = new LiveTracker(5, { smoothingFrames: 1 })
    for (let i = 0; i < 3; i++) tracker.update(frame(5, { 3: 0.8 }))
    expect(tracker.update(frame(5, { 3: 0.3, 1: 0.35 })).lockedIndex).toBe(3) // 1 leads, 3 keeps 0.3 >= 0.25
    expect(tracker.update(frame(5, { 3: 0.8 })).lockedIndex).toBe(3) // back: the count of lost frames starts over
    expect(tracker.update(frame(5, { 3: 0.3, 1: 0.35 })).lockedIndex).toBe(3)
    expect(tracker.update(frame(5, { 3: 0.3, 1: 0.35 })).lockedIndex).toBeUndefined() // two frames in a row
  })

  it('drops the lock at once when the confidence falls below 0.25', () => {
    const tracker = new LiveTracker(5, { smoothingFrames: 1 })
    for (let i = 0; i < 3; i++) tracker.update(frame(5, { 3: 0.8 }))
    expect(tracker.update(frame(5, { 3: 0.2 })).lockedIndex).toBeUndefined()
  })

  it('moves the lock to another species that leads for three frames', () => {
    const tracker = new LiveTracker(5, { smoothingFrames: 1 })
    for (let i = 0; i < 3; i++) tracker.update(frame(5, { 3: 0.8 }))
    const locks = [0, 1, 2].map(() => tracker.update(frame(5, { 1: 0.8, 3: 0.1 })).lockedIndex)
    expect(locks[2]).toBe(1)
    expect(locks[0]).not.toBe(1)
  })

  it('shows no guesses and holds no lock while the picture looks like no bird', () => {
    const tracker = new LiveTracker(5, { smoothingFrames: 1 })
    for (let i = 0; i < 3; i++) tracker.update(frame(5, { 3: 0.8 }))
    const state = tracker.update(frame(5, { 3: 0.8 }, 0.1))
    expect(state.guesses).toEqual([])
    for (let i = 0; i < 3; i++) tracker.update(frame(5, { 3: 0.8 }, 0.1))
    expect(tracker.update(frame(5, { 3: 0.8 }, 0.1)).lockedIndex).toBeUndefined()
    // and it can lock again when the bird is back
    const locks = [0, 1, 2].map(() => tracker.update(frame(5, { 3: 0.8 })).lockedIndex)
    expect(locks[2]).toBe(3)
  })

  it('treats a missing P(bird) as no bird', () => {
    const tracker = new LiveTracker(3, { smoothingFrames: 1 })
    expect(tracker.update(frame(3, { 1: 0.9 }, Number.NaN)).guesses).toEqual([])
  })

  it('uses the numbers of the constants by default', () => {
    expect(LIVE.lockFrames).toBe(3)
    expect(LIVE.lockConfidence).toBe(0.4)
    expect(LIVE.smoothingFrames).toBe(5)
    expect(LIVE.minIntervalMs).toBe(700)
  })
})

describe('pacing', () => {
  it('waits for the minimum interval from the start of the last frame', () => {
    expect(nextDelayMs(0, 100, 100)).toBe(600)
    expect(nextDelayMs(1000, 1700, 700)).toBe(175)
  })

  it('never queues up: no wait when the model needed longer than the interval', () => {
    expect(nextDelayMs(0, 1500, 1500)).toBe(1500 / 0.8 - 1500)
    expect(nextDelayMs(0, 5000, 0)).toBe(0)
  })

  it('keeps the model busy at most 80 percent of the time', () => {
    // a model that needs 1000 ms: start to start 1250 ms, 250 ms of rest after it
    expect(nextDelayMs(0, 1000, 1000)).toBeCloseTo(250, 6)
    // a fast model is held to the 700 ms rule
    expect(nextDelayMs(0, 50, 50)).toBe(650)
  })
})

describe('Average', () => {
  it('starts with its first sample and then moves a share towards each new one', () => {
    const average = new Average(0.5)
    expect(average.current).toBeUndefined()
    expect(average.add(10)).toBe(10)
    expect(average.add(20)).toBe(15)
    expect(average.add(15)).toBe(15)
    expect(average.current).toBe(15)
  })
})
