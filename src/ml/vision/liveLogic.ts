// The live camera's memory: smooths the guesses over the last frames and decides when the scanner has "locked on" a bird.
// Pure logic with no timers and no DOM, tested with synthetic sequences (tests/unit/vision-live-logic.test.ts).
//
// Each analysed frame brings one confidence per Dex species (P(bird) * P(species), as for photos) and P(bird). They are
// smoothed with an exponential average that weighs about the last `smoothingFrames` frames (alpha = 2 / (n + 1), so 1/3 for
// five frames). The scanner locks on a species when it has been the strongest for `lockFrames` frames in a row with a smoothed
// confidence above `lockConfidence`. A lock is held with some hysteresis, so one blurry frame does not drop it.

import type { FrameView } from '../../domain/engines'
import { LIVE } from './constants'
import { isNotABird, topIndices } from './scoring'

/** True when two views of the camera picture (the zoomed part, or undefined for all of it) show practically the same part. */
export function sameView(a: FrameView | undefined, b: FrameView | undefined, tolerance = 0.004): boolean {
  if (a === undefined || b === undefined) return a === b
  return (
    Math.abs(a.x - b.x) <= tolerance &&
    Math.abs(a.y - b.y) <= tolerance &&
    Math.abs(a.width - b.width) <= tolerance &&
    Math.abs(a.height - b.height) <= tolerance
  )
}

export interface LiveTrackerOptions {
  smoothingFrames?: number
  lockFrames?: number
  lockConfidence?: number
  unlockFrames?: number
  unlockConfidence?: number
  /** How many guesses to report. Default 3. */
  candidateCount?: number
  /** Smoothed P(bird) below this shows no guesses at all. Default: the bird probe threshold. */
  birdThreshold?: number
}

export interface LiveFrameInput {
  /** P(bird) * P(species) for each Dex species in Dex order. */
  confidences: ArrayLike<number>
  pBird: number
  /** The plain model's best species outside the Dex (VisionScores.outsideTop). Missing counts as 0. */
  outsideDexTop?: number
}

export interface LiveGuess {
  /** Position in the Dex order the confidences came in. */
  index: number
  confidence: number
}

export interface LiveState {
  /** The strongest guesses by smoothed confidence, strongest first. Empty while the picture looks like no bird. */
  guesses: LiveGuess[]
  /** Smoothed P(bird). */
  pBird: number
  /** Smoothed outsideDexTop. */
  outsideDexTop: number
  /** The species the scanner has locked on, as a position in the Dex order. */
  lockedIndex: number | undefined
  /** Frames seen since the start or the last reset. */
  frames: number
}

export class LiveTracker {
  private readonly smoothed: Float64Array
  private pBird = 0
  private outsideDexTop = 0
  private frames = 0
  private streakIndex = -1
  private streakCount = 0
  private lostCount = 0
  private lockedIndex: number | undefined

  private readonly alpha: number
  private readonly lockFrames: number
  private readonly lockConfidence: number
  private readonly unlockFrames: number
  private readonly unlockConfidence: number
  private readonly candidateCount: number
  private readonly birdThreshold: number | undefined

  constructor(size: number, options: LiveTrackerOptions = {}) {
    this.smoothed = new Float64Array(size)
    this.alpha = 2 / ((options.smoothingFrames ?? LIVE.smoothingFrames) + 1)
    this.lockFrames = options.lockFrames ?? LIVE.lockFrames
    this.lockConfidence = options.lockConfidence ?? LIVE.lockConfidence
    this.unlockFrames = options.unlockFrames ?? LIVE.unlockFrames
    this.unlockConfidence = options.unlockConfidence ?? LIVE.unlockConfidence
    this.candidateCount = options.candidateCount ?? 3
    this.birdThreshold = options.birdThreshold
  }

  /** Forgets everything: the next frame starts a new average. */
  reset(): void {
    this.smoothed.fill(0)
    this.pBird = 0
    this.outsideDexTop = 0
    this.frames = 0
    this.streakIndex = -1
    this.streakCount = 0
    this.lostCount = 0
    this.lockedIndex = undefined
  }

  update(frame: LiveFrameInput): LiveState {
    if (frame.confidences.length !== this.smoothed.length) throw new RangeError('The frame has the wrong number of species')
    const pBird = Number.isFinite(frame.pBird) ? frame.pBird : 0
    const outside = frame.outsideDexTop !== undefined && Number.isFinite(frame.outsideDexTop) ? frame.outsideDexTop : 0
    if (this.frames === 0) {
      for (let i = 0; i < this.smoothed.length; i++) this.smoothed[i] = frame.confidences[i]
      this.pBird = pBird
      this.outsideDexTop = outside
    } else {
      const a = this.alpha
      for (let i = 0; i < this.smoothed.length; i++) this.smoothed[i] += a * (frame.confidences[i] - this.smoothed[i])
      this.pBird += a * (pBird - this.pBird)
      this.outsideDexTop += a * (outside - this.outsideDexTop)
    }
    this.frames++

    const notABird = this.birdThreshold === undefined ? isNotABird(this.pBird) : isNotABird(this.pBird, this.birdThreshold)
    const best = notABird ? -1 : topIndices(this.smoothed, 1)[0]
    const bestConfidence = best >= 0 ? this.smoothed[best] : 0

    if (best >= 0 && bestConfidence > this.lockConfidence) {
      if (best === this.streakIndex) this.streakCount++
      else {
        this.streakIndex = best
        this.streakCount = 1
      }
    } else {
      this.streakIndex = -1
      this.streakCount = 0
    }

    if (this.streakCount >= this.lockFrames) {
      this.lockedIndex = this.streakIndex
      this.lostCount = 0
    } else if (this.lockedIndex !== undefined) {
      const holding = best === this.lockedIndex && this.smoothed[this.lockedIndex] >= this.unlockConfidence
      this.lostCount = holding ? 0 : this.lostCount + 1
      if (this.smoothed[this.lockedIndex] < this.unlockConfidence || this.lostCount >= this.unlockFrames) {
        this.lockedIndex = undefined
        this.lostCount = 0
      }
    }

    const guesses = notABird ? [] : topIndices(this.smoothed, this.candidateCount).map((index) => ({ index, confidence: this.smoothed[index] }))
    return { guesses, pBird: this.pBird, outsideDexTop: this.outsideDexTop, lockedIndex: this.lockedIndex, frames: this.frames }
  }
}

/** How long to wait before the next frame so that analysing never takes more than `maxDutyCycle` of the time. */
export function nextDelayMs(startedAt: number, finishedAt: number, averageDurationMs: number, minIntervalMs: number = LIVE.minIntervalMs, maxDutyCycle: number = LIVE.maxDutyCycle): number {
  const interval = Math.max(minIntervalMs, averageDurationMs / maxDutyCycle)
  return Math.max(0, startedAt + interval - finishedAt)
}

/** Exponential moving average that starts with its first value. */
export class Average {
  private value: number | undefined
  constructor(private readonly alpha: number) {}
  add(sample: number): number {
    this.value = this.value === undefined ? sample : this.value + this.alpha * (sample - this.value)
    return this.value
  }
  get current(): number | undefined {
    return this.value
  }
}
