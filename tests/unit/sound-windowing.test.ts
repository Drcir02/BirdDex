import { describe, expect, it } from 'vitest'
import { HOP_SAMPLES, KEEP_SAMPLES, SampleRing, WINDOW_SAMPLES, WindowSchedule } from '../../src/ml/audio/windowing'

/** Samples whose value is their own position, so any copy can be checked exactly. */
const counting = (from: number, count: number) => Float32Array.from({ length: count }, (_, i) => from + i)

describe('the numbers', () => {
  it('are 3 second windows every second and 12 seconds of memory at 48 kHz', () => {
    expect(WINDOW_SAMPLES).toBe(144000)
    expect(HOP_SAMPLES).toBe(48000)
    expect(KEEP_SAMPLES).toBe(576000)
  })
})

describe('SampleRing', () => {
  it('returns what was written, by absolute position', () => {
    const ring = new SampleRing(10)
    ring.push(counting(0, 6))
    expect(ring.totalWritten).toBe(6)
    expect(Array.from(ring.read(0, 6)!)).toEqual([0, 1, 2, 3, 4, 5])
    expect(Array.from(ring.read(2, 4)!)).toEqual([2, 3])
    expect(ring.read(2, 2)!.length).toBe(0)
  })

  it('forgets old samples and keeps counting positions', () => {
    const ring = new SampleRing(10)
    ring.push(counting(0, 7))
    ring.push(counting(7, 8)) // 15 written in all, the ring holds positions 5 to 14
    expect(ring.totalWritten).toBe(15)
    expect(ring.oldest).toBe(5)
    expect(Array.from(ring.read(5, 15)!)).toEqual([5, 6, 7, 8, 9, 10, 11, 12, 13, 14])
    expect(Array.from(ring.read(11, 14)!)).toEqual([11, 12, 13])
    expect(ring.read(4, 8)).toBeUndefined() // already overwritten
    expect(ring.read(10, 16)).toBeUndefined() // not here yet
    expect(ring.has(5, 15)).toBe(true)
    expect(ring.has(4, 15)).toBe(false)
  })

  it('reads across the point where the ring wraps around', () => {
    const ring = new SampleRing(8)
    for (let i = 0; i < 5; i++) ring.push(counting(i * 3, 3)) // 15 samples, wraps twice
    expect(Array.from(ring.read(7, 15)!)).toEqual([7, 8, 9, 10, 11, 12, 13, 14])
    expect(Array.from(ring.read(9, 13)!)).toEqual([9, 10, 11, 12])
  })

  it('copes with a block bigger than the whole ring', () => {
    const ring = new SampleRing(5)
    ring.push(counting(0, 3))
    ring.push(counting(3, 12)) // only the last 5 of these fit
    expect(ring.totalWritten).toBe(15)
    expect(Array.from(ring.read(10, 15)!)).toEqual([10, 11, 12, 13, 14])
    expect(ring.read(9, 15)).toBeUndefined()
  })

  it('gives the newest samples, or fewer when there are fewer', () => {
    const ring = new SampleRing(10)
    expect(ring.readLatest(4).length).toBe(0)
    ring.push(counting(0, 3))
    expect(Array.from(ring.readLatest(4))).toEqual([0, 1, 2])
    ring.push(counting(3, 20))
    expect(Array.from(ring.readLatest(4))).toEqual([19, 20, 21, 22])
    expect(ring.readLatest(100).length).toBe(10)
  })

  it('returns copies, so later writes do not change what was read', () => {
    const ring = new SampleRing(4)
    ring.push(counting(0, 4))
    const copy = ring.read(0, 4)!
    ring.push(counting(100, 4))
    expect(Array.from(copy)).toEqual([0, 1, 2, 3])
  })

  it('can be cleared', () => {
    const ring = new SampleRing(4)
    ring.push(counting(0, 4))
    ring.clear()
    expect(ring.totalWritten).toBe(0)
    expect(ring.read(0, 1)).toBeUndefined()
  })

  it('refuses a size that makes no sense', () => {
    expect(() => new SampleRing(0)).toThrow(RangeError)
    expect(() => new SampleRing(1.5)).toThrow(RangeError)
  })
})

describe('WindowSchedule', () => {
  it('has the first window after 3 seconds and one more every second', () => {
    const schedule = new WindowSchedule()
    expect(schedule.take(0)).toBeUndefined()
    expect(schedule.take(143999)).toBeUndefined()
    expect(schedule.take(144000)).toEqual({ end: 144000, skipped: 0 })
    expect(schedule.take(144001)).toBeUndefined() // the same window is never handed out twice
    expect(schedule.take(191999)).toBeUndefined()
    expect(schedule.take(192000)).toEqual({ end: 192000, skipped: 0 })
    expect(schedule.take(240000)).toEqual({ end: 240000, skipped: 0 })
  })

  it('hands out windows in step with the clock, whatever the block size', () => {
    const schedule = new WindowSchedule()
    const ends: number[] = []
    for (let written = 0; written <= 48000 * 10; written += 2048) {
      const due = schedule.take(written)
      if (due) ends.push(due.end)
    }
    // Windows end at 3 s, 4 s, 5 s... each taken as soon as a block passes that mark (the last block stops just short of 10 s).
    expect(ends).toHaveLength(7)
    ends.forEach((end, i) => expect(end).toBe(144000 + i * 48000))
  })

  it('jumps to the newest window when analysis fell behind, and counts what it skipped', () => {
    const schedule = new WindowSchedule()
    expect(schedule.take(144000)).toEqual({ end: 144000, skipped: 0 })
    // Analysis took 3.4 seconds: windows ending at 4, 5 and 6 s are all due, the one at 6 s (288000) is newest.
    expect(schedule.take(144000 + 3.4 * 48000)).toEqual({ end: 144000 + 3 * 48000, skipped: 2 })
    expect(schedule.take(144000 + 3.9 * 48000)).toBeUndefined()
    expect(schedule.take(144000 + 4 * 48000)).toEqual({ end: 144000 + 4 * 48000, skipped: 0 })
  })

  it('says when the next window will be ready', () => {
    const schedule = new WindowSchedule()
    expect(schedule.nextReadyAt).toBe(144000)
    schedule.take(144000)
    expect(schedule.nextReadyAt).toBe(192000)
  })

  it('can use other sizes', () => {
    const schedule = new WindowSchedule(10, 5)
    expect(schedule.take(9)).toBeUndefined()
    expect(schedule.take(10)).toEqual({ end: 10, skipped: 0 })
    expect(schedule.take(15)).toEqual({ end: 15, skipped: 0 })
    expect(() => new WindowSchedule(0, 5)).toThrow(RangeError)
  })
})
