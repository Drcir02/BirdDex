// The listening loop of the sound scanner, without the microphone and without the model: feed it blocks of audio and it
// cuts windows, asks an `analyse` function about each one, follows the results and tells the screen.
//
//   push(block)   audio arrives (from capture.ts, or from a test)
//   finish()      stop; waits for the window in progress and gives the final guesses and the clip
//
// Keeping it free of the microphone and of LiteRT means the whole behaviour (window timing, falling behind, level
// meter, best moment, clip) is tested with fake audio and a fake analyser (tests/unit/sound-pipeline.test.ts).

import type { SoundResult, SoundUpdate } from '../../domain/engines'
import type { Candidate } from '../../domain/types'
import { LevelMeter } from '../audio/loudness'
import { Resampler, TARGET_SAMPLE_RATE } from '../audio/resample'
import { HOP_SAMPLES, KEEP_SAMPLES, SampleRing, WINDOW_SAMPLES, WindowSchedule } from '../audio/windowing'
import { encodeWavBlob } from '../audio/wav'
import { ScanTracker, type AggregateOptions, type WindowScores } from './aggregate'

/** The clip we save with a catch: this much before the end of the strongest window, and this much after it. */
export const CLIP_BEFORE_SECONDS = 4.5
export const CLIP_AFTER_SECONDS = 1.5
/** Without a detection, the clip is the newest audio of this length (when there is at least MIN seconds of it). */
export const FALLBACK_CLIP_SECONDS = 6
export const MIN_CLIP_SECONDS = 1

/** After this many failures in a row the analysis gives up (the microphone keeps working, the clip is still saved). */
const MAX_FAILURES_IN_A_ROW = 3

export interface WindowInfo {
  /** 1 for the first analysed window. */
  index: number
  /** Position just after the window, in seconds of audio. */
  endSeconds: number
  /** Windows passed over because analysis could not keep up. */
  skipped: number
  /** Time the analysis took, in milliseconds. */
  ms: number
  top: readonly Candidate[]
}

export interface PipelineOptions {
  /** Looks at one window (144000 samples at 48 kHz). `end` is the position after its last sample. */
  analyse(window: Float32Array, end: number): Promise<WindowScores>
  onUpdate(update: SoundUpdate): void
  /** Called when analysing a window failed. */
  onError?(error: unknown): void
  /** Called after each analysed window, with timing (for the dev page and measurements). */
  onWindow?(info: WindowInfo): void
  aggregate?: Partial<AggregateOptions>
  /** Shortest time between two updates that only change the level meter. Default 50 ms. */
  levelIntervalMs?: number
  now?(): number
}

interface Snapshot {
  start: number
  samples: Float32Array
  /** The window end the snapshot was made for. */
  peakEnd: number
}

export class SoundPipeline {
  private readonly options: PipelineOptions
  private readonly now: () => number
  private readonly ring = new SampleRing(KEEP_SAMPLES)
  private readonly schedule = new WindowSchedule()
  private readonly tracker: ScanTracker
  private readonly meter = new LevelMeter()
  private resampler: Resampler | undefined
  private inputRate = TARGET_SAMPLE_RATE
  private candidates: Candidate[] = []
  private analysedEnd = 0
  private windowsDone = 0
  private lastEmit = Number.NEGATIVE_INFINITY
  private busy: Promise<void> | undefined
  private closed = false
  private failures = 0
  private givenUp = false
  private snapshot: Snapshot | undefined
  private result: Promise<SoundResult> | undefined

  constructor(options: PipelineOptions) {
    this.options = options
    this.now = options.now ?? (() => performance.now())
    this.tracker = new ScanTracker(options.aggregate)
  }

  /** Audio from the microphone: mono samples, their RMS and peak, and the rate they were recorded at. */
  push(block: Float32Array, rms: number, _peak: number, sampleRate: number = TARGET_SAMPLE_RATE): void {
    if (this.closed || block.length === 0) return
    if (sampleRate !== this.inputRate || (sampleRate !== TARGET_SAMPLE_RATE && !this.resampler)) {
      this.inputRate = sampleRate
      this.resampler = sampleRate === TARGET_SAMPLE_RATE ? undefined : new Resampler(sampleRate, TARGET_SAMPLE_RATE)
    }
    this.meter.update(rms, block.length / sampleRate)
    this.ring.push(this.resampler ? this.resampler.process(block) : block)
    this.pump()
    this.emit(false)
  }

  /** Seconds of audio received so far (after conversion to 48 kHz). */
  get capturedSeconds(): number {
    return this.ring.totalWritten / TARGET_SAMPLE_RATE
  }

  /** Stops listening and returns the final guesses and the clip. Can be called many times; the answer is the same. */
  finish(): Promise<SoundResult> {
    this.result ??= this.conclude()
    return this.result
  }

  // ----- Analysis -----

  private pump(): void {
    if (this.busy || this.closed || this.givenUp) return
    const due = this.schedule.take(this.ring.totalWritten)
    if (!due) return
    this.busy = this.analyseWindow(due.end, due.skipped).finally(() => {
      this.busy = undefined
      this.pump()
    })
  }

  private async analyseWindow(end: number, skipped: number): Promise<void> {
    const window = this.ring.read(end - WINDOW_SAMPLES, end)
    if (!window) return // overwritten while we were busy: a newer window will follow
    const started = this.now()
    let scores: WindowScores
    try {
      scores = await this.options.analyse(window, end)
    } catch (error) {
      this.failures++
      if (this.failures >= MAX_FAILURES_IN_A_ROW) this.givenUp = true
      this.options.onError?.(error)
      return
    }
    this.failures = 0
    const ms = this.now() - started
    this.windowsDone++
    this.analysedEnd = end
    const update = this.tracker.add(scores)
    this.candidates = update.candidates
    if (update.newRecord && this.tracker.record) this.takeSnapshot(this.tracker.record.peakEnd)
    this.options.onWindow?.({ index: this.windowsDone, endSeconds: end / TARGET_SAMPLE_RATE, skipped, ms, top: scores.top })
    if (!this.closed) this.emit(true)
  }

  // ----- Updates -----

  private emit(force: boolean): void {
    const time = this.now()
    if (!force && time - this.lastEmit < (this.options.levelIntervalMs ?? 50)) return
    this.lastEmit = time
    try {
      this.options.onUpdate({
        candidates: this.candidates,
        level: this.meter.value,
        analysedSeconds: this.analysedEnd / TARGET_SAMPLE_RATE,
        hearingBird: this.tracker.hearingBird,
      })
    } catch (error) {
      // A bug in the screen must not stop the listening.
      console.error('The screen failed while handling a sound update', error)
    }
  }

  // ----- The clip -----

  /** The part of the recording around a window end that is worth saving, in sample positions. */
  private clipRange(peakEnd: number, total: number): { start: number; end: number } {
    return {
      start: Math.max(0, peakEnd - Math.round(CLIP_BEFORE_SECONDS * TARGET_SAMPLE_RATE)),
      end: Math.min(total, peakEnd + Math.round(CLIP_AFTER_SECONDS * TARGET_SAMPLE_RATE)),
    }
  }

  /** The ring forgets after 12 seconds, so when the bird in front gets a new best we keep a copy of its audio. */
  private takeSnapshot(peakEnd: number): void {
    const { start, end } = this.clipRange(peakEnd, this.ring.totalWritten)
    const from = Math.max(start, this.ring.oldest)
    const samples = this.ring.read(from, end)
    if (samples) this.snapshot = { start: from, samples, peakEnd }
  }

  private clipSamples(): Float32Array | undefined {
    const record = this.tracker.record
    const total = this.ring.totalWritten
    if (record) {
      const { start, end } = this.clipRange(record.peakEnd, total)
      const fromRing = this.ring.read(start, end)
      if (fromRing && fromRing.length > 0) return fromRing
      // Part of it is gone from the ring: use the copy made when this was the best moment.
      const copy = this.snapshot
      if (copy && copy.peakEnd === record.peakEnd) {
        // The ring may still hold some newer audio after the copy, but the copy is the whole story up to its end.
        return copy.samples
      }
    }
    // Nothing detected (or the copy is missing): the newest few seconds, if there is enough to be worth keeping.
    const newest = this.ring.readLatest(FALLBACK_CLIP_SECONDS * TARGET_SAMPLE_RATE)
    return newest.length >= MIN_CLIP_SECONDS * TARGET_SAMPLE_RATE ? newest : undefined
  }

  // ----- The end -----

  private async conclude(): Promise<SoundResult> {
    this.closed = true // no more audio, no more updates
    await this.busy
    // A last look at the newest 3 seconds when at least half a second of sound arrived since the last window, so a
    // quick stop at 4 seconds still has two windows to agree on.
    const total = this.ring.totalWritten
    if (!this.givenUp && total >= WINDOW_SAMPLES && total - this.analysedEnd >= HOP_SAMPLES / 2) {
      await this.analyseWindow(total, 0)
    }
    const candidates = this.tracker.candidates()
    const samples = this.clipSamples()
    if (!samples) return { candidates }
    return { candidates, clip: encodeWavBlob(samples, TARGET_SAMPLE_RATE), clipSeconds: samples.length / TARGET_SAMPLE_RATE }
  }
}
