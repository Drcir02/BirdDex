// Cutting the live microphone stream into the 3 second windows BirdNET reads.
//
//   SampleRing      remembers the last 12 seconds of 48 kHz audio (for the windows and for the clip we save)
//   WindowSchedule  says when the next window is ready: the first after 3 seconds, then one more every second
//
// Windows are counted in samples, not in clock time, so a slow phone that falls behind simply analyses the newest
// window and skips the ones it missed, instead of building up a queue.

import { TARGET_SAMPLE_RATE } from './resample'

export const WINDOW_SECONDS = 3
export const HOP_SECONDS = 1
/** How much audio the ring keeps: enough for the window being analysed and a clip around an earlier detection. */
export const KEEP_SECONDS = 12

export const WINDOW_SAMPLES = WINDOW_SECONDS * TARGET_SAMPLE_RATE
export const HOP_SAMPLES = HOP_SECONDS * TARGET_SAMPLE_RATE
export const KEEP_SAMPLES = KEEP_SECONDS * TARGET_SAMPLE_RATE

/**
 * A ring buffer of mono samples. Positions are absolute: the first sample ever written is position 0, and positions
 * keep counting up after old samples have been overwritten.
 */
export class SampleRing {
  readonly capacity: number
  private readonly data: Float32Array
  private written = 0

  constructor(capacity: number = KEEP_SAMPLES) {
    if (!Number.isInteger(capacity) || capacity <= 0) throw new RangeError(`Bad ring size: ${capacity}`)
    this.capacity = capacity
    this.data = new Float32Array(capacity)
  }

  /** Number of samples written so far (the position just after the newest sample). */
  get totalWritten(): number {
    return this.written
  }

  /** Position of the oldest sample that is still in the ring. */
  get oldest(): number {
    return Math.max(0, this.written - this.capacity)
  }

  push(samples: Float32Array): void {
    // A block bigger than the ring can only leave its last `capacity` samples behind.
    const source = samples.length > this.capacity ? samples.subarray(samples.length - this.capacity) : samples
    const skipped = samples.length - source.length
    let at = (this.written + skipped) % this.capacity
    const firstPart = Math.min(source.length, this.capacity - at)
    this.data.set(source.subarray(0, firstPart), at)
    if (firstPart < source.length) {
      at = 0
      this.data.set(source.subarray(firstPart), at)
    }
    this.written += samples.length
  }

  /** True when every sample from `start` up to (not including) `end` is still in the ring. */
  has(start: number, end: number): boolean {
    return start >= this.oldest && end <= this.written && start <= end
  }

  /** A copy of the samples from `start` up to (not including) `end`, or undefined if some are gone or not yet here. */
  read(start: number, end: number): Float32Array | undefined {
    if (!this.has(start, end)) return undefined
    const out = new Float32Array(end - start)
    let from = start % this.capacity
    const firstPart = Math.min(out.length, this.capacity - from)
    out.set(this.data.subarray(from, from + firstPart))
    if (firstPart < out.length) {
      from = 0
      out.set(this.data.subarray(0, out.length - firstPart), firstPart)
    }
    return out
  }

  /** The newest `count` samples, or fewer when the ring does not hold that many yet. */
  readLatest(count: number): Float32Array {
    const end = this.written
    const start = Math.max(this.oldest, end - count)
    return this.read(start, end) ?? new Float32Array(0)
  }

  clear(): void {
    this.written = 0
    this.data.fill(0)
  }
}

export interface DueWindow {
  /** Position just after the window's last sample. The window is [end - windowSamples, end). */
  end: number
  /** How many earlier windows were passed over because analysis could not keep up. */
  skipped: number
}

/** Decides when the next window can be analysed. */
export class WindowSchedule {
  private readonly windowSamples: number
  private readonly hopSamples: number
  /** End position of the next window we want. */
  private nextEnd: number

  constructor(windowSamples: number = WINDOW_SAMPLES, hopSamples: number = HOP_SAMPLES) {
    if (windowSamples <= 0 || hopSamples <= 0) throw new RangeError('Window and hop must be positive')
    this.windowSamples = windowSamples
    this.hopSamples = hopSamples
    this.nextEnd = windowSamples
  }

  /**
   * Given how many samples exist now, returns the window to analyse next, or undefined when none is ready yet.
   * If several windows are ready it returns the newest one and counts the others as skipped.
   */
  take(totalWritten: number): DueWindow | undefined {
    if (totalWritten < this.nextEnd) return undefined
    const behind = Math.floor((totalWritten - this.nextEnd) / this.hopSamples)
    const end = this.nextEnd + behind * this.hopSamples
    this.nextEnd = end + this.hopSamples
    return { end, skipped: behind }
  }

  /** When the next window will be ready, in samples written so far. */
  get nextReadyAt(): number {
    return this.nextEnd
  }

  get window(): number {
    return this.windowSamples
  }
}
