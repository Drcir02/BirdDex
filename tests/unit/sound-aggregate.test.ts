import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { Candidate } from '../../src/domain/types'
import { AGGREGATE_DEFAULTS, aggregateRecent, isHearingBird, ScanTracker, type WindowScores } from '../../src/ml/sound/aggregate'
import { idFromLabel } from '../../src/ml/sound/scores'

/** A window result: w(3000, ['a', 0.9], ['b', 0.2]). `end` only has to grow from window to window. */
const w = (end: number, ...top: Array<[string, number]>): WindowScores => ({
  end,
  top: top.map(([speciesId, confidence]) => ({ speciesId, confidence })),
})

const ids = (candidates: readonly Candidate[]) => candidates.map((c) => c.speciesId)

describe('aggregateRecent: what the newest windows agree on', () => {
  it('has nothing to say before there are two windows', () => {
    expect(aggregateRecent([])).toEqual([])
    expect(aggregateRecent([w(1, ['a', 0.99])])).toEqual([])
  })

  it('counts a bird heard in two windows, with the mean of the two as its confidence', () => {
    const result = aggregateRecent([w(1, ['a', 0.9]), w(2, ['a', 0.8])])
    expect(ids(result)).toEqual(['a'])
    expect(result[0].confidence).toBeCloseTo(0.85, 10)
  })

  it('counts a bird in 2 of the last 3 windows even when the middle window missed it', () => {
    const result = aggregateRecent([w(1, ['a', 0.9]), w(2, ['b', 0.6]), w(3, ['a', 0.7])])
    expect(result.find((g) => g.speciesId === 'a')?.confidence).toBeCloseTo(0.8, 10)
  })

  it('does not count a bird that was strong in only one window', () => {
    expect(aggregateRecent([w(1, ['a', 0.99]), w(2, ['b', 0.5]), w(3, ['c', 0.5])])).toEqual([])
  })

  it('uses the mean of the best two windows when there are three', () => {
    const result = aggregateRecent([w(1, ['a', 0.5]), w(2, ['a', 0.9]), w(3, ['a', 0.7])])
    expect(result[0].confidence).toBeCloseTo(0.8, 10)
    expect(result[0].peakScore).toBe(0.9)
    expect(result[0].peakEnd).toBe(2) // the window with its strongest score
  })

  it('only looks at the last 3 windows', () => {
    const history = [w(1, ['a', 0.95]), w(2, ['a', 0.95]), w(3, ['b', 0.5]), w(4, ['b', 0.5]), w(5, ['c', 0.5])]
    expect(ids(aggregateRecent(history))).toEqual(['b']) // a is older than 3 windows, c is in one window only
  })

  it('ignores scores below 0.10 but accepts exactly 0.10 (when the confidence is high enough to be listed)', () => {
    expect(aggregateRecent([w(1, ['a', 0.09]), w(2, ['a', 0.09])])).toEqual([])
    expect(aggregateRecent([w(1, ['a', 0.1]), w(2, ['a', 0.1])], { minConfidence: 0 })).toHaveLength(1)
    expect(aggregateRecent([w(1, ['a', 0.1]), w(2, ['a', 0.1])], { minScore: 0.1 })).toEqual([]) // 0.10 is under the 0.15 needed to be listed
  })

  it('leaves out birds whose confidence is under 0.15, and lists them at exactly 0.15', () => {
    expect(aggregateRecent([w(1, ['a', 0.14]), w(2, ['a', 0.14])])).toEqual([])
    expect(aggregateRecent([w(1, ['a', 0.3]), w(2, ['a', 0.1])])).toHaveLength(1) // (0.3 + 0.1) / 2 = 0.2
    expect(aggregateRecent([w(1, ['a', 0.15]), w(2, ['a', 0.15])])).toHaveLength(1)
  })

  it('only looks at the strongest five birds of a window', () => {
    const crowd: Array<[string, number]> = [['p', 0.9], ['q', 0.8], ['r', 0.7], ['s', 0.6], ['t', 0.5], ['sixth', 0.4]]
    expect(ids(aggregateRecent([w(1, ...crowd), w(2, ...crowd)]))).not.toContain('sixth')
    expect(ids(aggregateRecent([w(1, ...crowd), w(2, ...crowd)], { topPerWindow: 6, maxCandidates: 10 }))).toContain('sixth')
  })

  it('returns at most three, strongest first', () => {
    const window = (end: number): WindowScores => w(end, ['a', 0.3], ['b', 0.9], ['c', 0.6], ['d', 0.45], ['e', 0.2])
    const result = aggregateRecent([window(1), window(2)])
    expect(ids(result)).toEqual(['b', 'c', 'd'])
  })

  it('breaks ties by the strongest single window, then by name, so the order is always the same', () => {
    // a: (0.9 + 0.5) / 2 = 0.7; b: (0.7 + 0.7) / 2 = 0.7
    const result = aggregateRecent([w(1, ['a', 0.9], ['b', 0.7]), w(2, ['a', 0.5], ['b', 0.7])])
    expect(ids(result)).toEqual(['a', 'b'])
    const same = aggregateRecent([w(1, ['y', 0.6], ['x', 0.6]), w(2, ['y', 0.6], ['x', 0.6])])
    expect(ids(same)).toEqual(['x', 'y'])
  })

  it('can be tuned', () => {
    const history = [w(1, ['a', 0.8]), w(2, ['b', 0.8]), w(3, ['a', 0.6])]
    expect(ids(aggregateRecent(history, { minAppearances: 1, maxCandidates: 5 }))).toEqual(['b', 'a'])
    expect(aggregateRecent([w(1, ['a', 0.8]), w(2, ['a', 0.8])], { recentWindows: 1 })).toEqual([])
  })

  it('does not change its input', () => {
    const history = [w(1, ['a', 0.9]), w(2, ['a', 0.8])]
    const copy = JSON.parse(JSON.stringify(history)) as WindowScores[]
    aggregateRecent(history)
    expect(history).toEqual(copy)
  })
})

describe('isHearingBird', () => {
  it('is on when the best bird of the newest window scores at least 0.25', () => {
    expect(isHearingBird(w(1, ['a', 0.25]))).toBe(true)
    expect(isHearingBird(w(1, ['a', 0.9]))).toBe(true)
    expect(isHearingBird(w(1, ['a', 0.2499]))).toBe(false)
  })
  it('is off for an empty window or no window', () => {
    expect(isHearingBird(w(1))).toBe(false)
    expect(isHearingBird(undefined)).toBe(false)
  })
  it('has its own threshold', () => {
    expect(isHearingBird(w(1, ['a', 0.5]), 0.6)).toBe(false)
  })
})

describe('ScanTracker: the best of the whole scan', () => {
  it('keeps what it has heard, even when the bird goes quiet', () => {
    const tracker = new ScanTracker()
    tracker.add(w(1, ['a', 0.9]))
    const heard = tracker.add(w(2, ['a', 0.9]))
    expect(ids(heard.candidates)).toEqual(['a'])
    expect(heard.hearingBird).toBe(true)

    // Silence: the bird slides out of the last 3 windows, but it stays in the list with its best number.
    tracker.add(w(3))
    tracker.add(w(4))
    const quiet = tracker.add(w(5))
    expect(quiet.candidates).toEqual([{ speciesId: 'a', confidence: 0.9 }])
    expect(quiet.hearingBird).toBe(false)
  })

  it('only ever raises a bird\'s number', () => {
    const tracker = new ScanTracker()
    tracker.add(w(1, ['a', 0.9]))
    tracker.add(w(2, ['a', 0.9]))
    tracker.add(w(3, ['a', 0.3]))
    const later = tracker.add(w(4, ['a', 0.3]))
    expect(later.candidates[0].confidence).toBeCloseTo(0.9, 10) // not dragged down by the weak windows
  })

  it('shows nothing until a bird counts', () => {
    const tracker = new ScanTracker()
    expect(tracker.add(w(1, ['a', 0.99])).candidates).toEqual([])
    expect(tracker.candidates()).toEqual([])
    expect(tracker.record).toBeUndefined()
  })

  it('tells when the bird in front reaches a new best, for the clip', () => {
    const tracker = new ScanTracker()
    expect(tracker.add(w(10, ['a', 0.5])).newRecord).toBe(false)
    const first = tracker.add(w(20, ['a', 0.6]))
    expect(first.newRecord).toBe(true)
    expect(tracker.record).toMatchObject({ speciesId: 'a', peakEnd: 20 })

    const weaker = tracker.add(w(30, ['a', 0.4], ['b', 0.3]))
    expect(weaker.newRecord).toBe(false) // a: still 0.55 from before, nothing new
    expect(tracker.record?.peakEnd).toBe(20)

    const stronger = tracker.add(w(40, ['a', 0.95]))
    expect(stronger.newRecord).toBe(true)
    expect(tracker.record).toMatchObject({ speciesId: 'a', peakEnd: 40, peakScore: 0.95 })
  })

  it('moves the record to another bird that beats the leader', () => {
    const tracker = new ScanTracker()
    tracker.add(w(1, ['a', 0.6]))
    tracker.add(w(2, ['a', 0.6]))
    tracker.add(w(3, ['b', 0.9]))
    const update = tracker.add(w(4, ['b', 0.9]))
    expect(update.newRecord).toBe(true)
    expect(tracker.record?.speciesId).toBe('b')
    expect(ids(update.candidates)).toEqual(['b', 'a'])
  })

  it('keeps three guesses at most', () => {
    const tracker = new ScanTracker()
    const window = (end: number) => w(end, ['a', 0.9], ['b', 0.8], ['c', 0.7], ['d', 0.6])
    tracker.add(window(1))
    expect(ids(tracker.add(window(2)).candidates)).toEqual(['a', 'b', 'c'])
  })

  it('counts windows', () => {
    const tracker = new ScanTracker()
    tracker.add(w(1))
    tracker.add(w(2))
    expect(tracker.windowCount).toBe(2)
  })
})

describe('ScanTracker on the real BirdNET results of the test recordings (golden.json, made with Python)', () => {
  interface GoldenWindow {
    startS: number
    fp16: Array<{ index: number; label: string; score: number }>
  }
  const golden = JSON.parse(readFileSync('tests/fixtures/audio/golden.json', 'utf8')) as {
    files: Record<string, { windows: GoldenWindow[] }>
  }
  const windowsOf = (file: string): WindowScores[] =>
    golden.files[file].windows.map((window) => ({
      end: (window.startS + 3) * 48000,
      top: window.fp16.map((entry) => ({ speciesId: idFromLabel(entry.label), confidence: entry.score })),
    }))

  it('finds the Lesser Redpoll in the demo recording as soon as the sound goes on for a second window', () => {
    // The demo file is one 3 second window; a fake microphone plays it in a loop, so the next windows hear it again.
    const [window] = windowsOf('birdnet-demo-sample.wav')
    const tracker = new ScanTracker()
    expect(tracker.add({ ...window, end: 144000 }).candidates).toEqual([])
    const update = tracker.add({ ...window, end: 192000 })
    expect(update.candidates[0].speciesId).toBe('acanthis-cabaret')
    expect(update.candidates[0].confidence).toBeGreaterThan(0.9)
    expect(update.hearingBird).toBe(true)
    // BirdNET also gives the Common Redpoll 0.80 for this call: the second guess, as the owner will see it.
    expect(update.candidates[1].speciesId).toBe('acanthis-flammea')
  })

  it('finds the Black-capped Chickadee of the soundscape early', () => {
    const tracker = new ScanTracker()
    const history = windowsOf('soundscape-24s.wav').map((window) => tracker.add(window))
    // Window 1: the chickadee scores 0.81, but one window is never enough. Window 2: House Finch 0.10, no chickadee.
    expect(history[0].candidates).toEqual([])
    expect(history[0].hearingBird).toBe(true)
    expect(history[1].candidates).toEqual([])
    expect(history[1].hearingBird).toBe(false)
    // Window 3 has the chickadee again (0.19, second place): it now counts in 2 of the last 3, with (0.815 + 0.186) / 2.
    const third = history[2].candidates.find((c) => c.speciesId === 'poecile-atricapillus')
    expect(third?.confidence).toBeGreaterThan(0.45)
    expect(third?.confidence).toBeLessThan(0.55)
    expect(history[2].hearingBird).toBe(false) // the best bird of window 3 (Mountain Chickadee) scores 0.21
  })

  it('ends the soundscape with a short, sensible list and a record to cut the clip around', () => {
    const tracker = new ScanTracker()
    for (const window of windowsOf('soundscape-24s.wav')) tracker.add(window)
    const candidates = tracker.candidates()
    expect(candidates.length).toBeLessThanOrEqual(3)
    for (const candidate of candidates) expect(candidate.confidence).toBeLessThanOrEqual(1)
    expect(tracker.record).toBeDefined()
    expect(tracker.windowCount).toBe(22)
  })

  it('never lets AGGREGATE_DEFAULTS drift unnoticed', () => {
    expect(AGGREGATE_DEFAULTS).toEqual({
      recentWindows: 3,
      minAppearances: 2,
      topPerWindow: 5,
      minScore: 0.1,
      minConfidence: 0.15,
      maxCandidates: 3,
      hearingThreshold: 0.25,
    })
  })
})
