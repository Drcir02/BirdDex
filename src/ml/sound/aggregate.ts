// From a stream of per-window results to the three guesses shown on the scan screen. Pure functions and one small
// class, no model and no browser needed, so the rules are tested with made-up sequences.
//
// The rules (BirdNET scores a 3 second window every second, so neighbouring windows share two thirds of their sound):
//   1. A bird "counts" when it is among the strongest of a window (top 5, score at least 0.10) in at least 2 of the
//      last 3 windows. One lucky window is not enough. This is what keeps a passing noise from becoming a bird.
//   2. Its confidence is the mean of its two best windows among those. A bird that only just counts (one strong and
//      one weak window) therefore lands in the middle, and a bird heard clearly twice scores close to its best.
//      Birds under 0.15 are not listed: a 12 percent guess helps nobody.
//   3. "Hearing a bird" is on while the strongest bird of the newest window scores at least 0.25.
//
// ScanTracker applies these rules window after window and also remembers the best confidence every bird reached during
// the whole scan. That best-so-far list is what the screen shows and what stop() hands over, so the numbers only
// ever go up while you listen, and what you saw is what you can catch.

import type { Candidate } from '../../domain/types'

export interface AggregateOptions {
  /** How many of the newest windows are looked at. */
  recentWindows: number
  /** In how many of them a bird has to be among the strongest. */
  minAppearances: number
  /** A bird is "among the strongest" of a window when it is in this many places from the top... */
  topPerWindow: number
  /** ...and scores at least this much. */
  minScore: number
  /** A bird whose confidence (mean of its two best windows) is below this is left out of the list. */
  minConfidence: number
  /** How many guesses to return. */
  maxCandidates: number
  /** Score of the best bird in the newest window that counts as "I hear a bird". */
  hearingThreshold: number
}

export const AGGREGATE_DEFAULTS: AggregateOptions = {
  recentWindows: 3,
  minAppearances: 2,
  topPerWindow: 5,
  minScore: 0.1,
  minConfidence: 0.15,
  maxCandidates: 3,
  hearingThreshold: 0.25,
}

/** What one analysed window found: its strongest allowed birds, strongest first. */
export interface WindowScores {
  /** Position just after the window's last sample, so the strongest window can be found again in the recording. */
  end: number
  top: readonly Candidate[]
}

export interface Guess extends Candidate {
  /** The `end` of the window in which this bird scored highest. */
  peakEnd: number
  /** Its highest score in a single window (the confidence is the mean of two). */
  peakScore: number
}

/** The birds that count in the newest windows, strongest first. */
export function aggregateRecent(history: readonly WindowScores[], options: Partial<AggregateOptions> = {}): Guess[] {
  const o = { ...AGGREGATE_DEFAULTS, ...options }
  const recent = history.slice(-o.recentWindows)

  const seen = new Map<string, Array<{ score: number; end: number }>>()
  for (const window of recent) {
    for (const guess of window.top.slice(0, o.topPerWindow)) {
      if (!(guess.confidence >= o.minScore)) continue
      const list = seen.get(guess.speciesId)
      const entry = { score: guess.confidence, end: window.end }
      if (list) list.push(entry)
      else seen.set(guess.speciesId, [entry])
    }
  }

  const counted: Guess[] = []
  for (const [speciesId, list] of seen) {
    if (list.length < o.minAppearances) continue
    list.sort((a, b) => b.score - a.score)
    const bestTwo = list.slice(0, 2) // a bird needs only one window when minAppearances is tuned down to 1
    const confidence = bestTwo.reduce((sum, entry) => sum + entry.score, 0) / bestTwo.length
    if (confidence < o.minConfidence) continue
    counted.push({ speciesId, confidence, peakEnd: list[0].end, peakScore: list[0].score })
  }
  counted.sort((a, b) => b.confidence - a.confidence || b.peakScore - a.peakScore || (a.speciesId < b.speciesId ? -1 : 1))
  return counted.slice(0, o.maxCandidates)
}

/** True when the strongest bird of the newest window scores at least the threshold. */
export function isHearingBird(latest: WindowScores | undefined, threshold: number = AGGREGATE_DEFAULTS.hearingThreshold): boolean {
  return (latest?.top[0]?.confidence ?? 0) >= threshold
}

export interface TrackerUpdate {
  /** Best confidence of every bird so far, strongest first, at most three. */
  candidates: Candidate[]
  hearingBird: boolean
  /** True when this window pushed the leading bird to a new best, so the audio around it is worth keeping. */
  newRecord: boolean
}

/** Follows a whole scan. */
export class ScanTracker {
  private readonly options: AggregateOptions
  private history: WindowScores[] = []
  private readonly best = new Map<string, Guess>()
  private leader: Guess | undefined
  private latest: WindowScores | undefined
  private windows = 0

  constructor(options: Partial<AggregateOptions> = {}) {
    this.options = { ...AGGREGATE_DEFAULTS, ...options }
  }

  /** Adds the next analysed window. */
  add(window: WindowScores): TrackerUpdate {
    this.windows++
    this.latest = window
    this.history.push(window)
    if (this.history.length > this.options.recentWindows) this.history.shift()

    for (const guess of aggregateRecent(this.history, this.options)) {
      const known = this.best.get(guess.speciesId)
      if (!known || guess.confidence > known.confidence) this.best.set(guess.speciesId, guess)
    }

    const before = this.leader?.confidence ?? 0
    this.leader = this.ranked()[0]
    const newRecord = (this.leader?.confidence ?? 0) > before
    return { candidates: this.candidates(), hearingBird: this.hearingBird, newRecord }
  }

  private ranked(): Guess[] {
    return [...this.best.values()].sort(
      (a, b) => b.confidence - a.confidence || b.peakScore - a.peakScore || (a.speciesId < b.speciesId ? -1 : 1),
    )
  }

  /** The best confidence each bird has reached in this scan, strongest first. */
  candidates(): Candidate[] {
    return this.ranked()
      .slice(0, this.options.maxCandidates)
      .map(({ speciesId, confidence }) => ({ speciesId, confidence }))
  }

  /** The bird in front, with the window to build its clip around. */
  get record(): Guess | undefined {
    return this.leader
  }

  get hearingBird(): boolean {
    return isHearingBird(this.latest, this.options.hearingThreshold)
  }

  /** Number of windows added. */
  get windowCount(): number {
    return this.windows
  }
}
