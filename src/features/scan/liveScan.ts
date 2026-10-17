// The states of a live camera scan, and the watch that notices a camera which stops sending pictures.
// Pure, so both are unit-tested without a camera. The hook that drives them with the real camera is useLiveScan.ts.

import type { LiveUpdate } from '../../domain/engines'
import type { ScanErrorKind } from './errors'

/** A camera that has sent no new picture for this long is called stalled (it is a known bug of iPhone home-screen apps). */
export const CAMERA_STALL_MS = 6000

export type LivePhase = 'idle' | 'starting' | 'running' | 'stalled' | 'paused' | 'error'

export interface LiveScanState {
  phase: LivePhase
  /** The newest answer of the scanner. */
  update?: LiveUpdate
  error?: ScanErrorKind
  /** The Catch button was pressed and the snapshot is being taken. */
  catching: boolean
  /** Taking the snapshot failed: the camera keeps running and the person may press Catch again. */
  snapshotFailed: boolean
}

export const INITIAL_LIVE_STATE: LiveScanState = { phase: 'idle', catching: false, snapshotFailed: false }

export type LiveAction =
  | { type: 'start' }
  | { type: 'running' }
  | { type: 'update'; update: LiveUpdate }
  | { type: 'stalled' }
  | { type: 'paused' }
  | { type: 'failed'; error: ScanErrorKind }
  | { type: 'catching' }
  | { type: 'catchFailed' }
  /** The person zoomed or moved the view: a lock on a bird belongs to what was on the screen before. */
  | { type: 'viewChanged' }
  | { type: 'reset' }

/** The same answer without the lock. */
export function withoutLock(update: LiveUpdate): LiveUpdate {
  const { lockedSpeciesId: _locked, ...rest } = update
  return rest
}

export function liveReducer(state: LiveScanState, action: LiveAction): LiveScanState {
  switch (action.type) {
    case 'start':
      return { ...INITIAL_LIVE_STATE, phase: 'starting' }
    case 'running':
      return state.phase === 'starting' ? { ...state, phase: 'running' } : state
    case 'update':
      // An answer that arrives after the camera was switched off, or before it was switched on, is ignored.
      return state.phase === 'starting' || state.phase === 'running' ? { ...state, update: action.update } : state
    case 'stalled':
      return { ...INITIAL_LIVE_STATE, phase: 'stalled' }
    case 'paused':
      return { ...INITIAL_LIVE_STATE, phase: 'paused' }
    case 'failed':
      return { ...INITIAL_LIVE_STATE, phase: 'error', error: action.error }
    case 'catching':
      return state.phase === 'running' ? { ...state, catching: true, snapshotFailed: false } : state
    case 'catchFailed':
      return { ...state, catching: false, snapshotFailed: true }
    case 'viewChanged':
      return state.update?.lockedSpeciesId !== undefined ? { ...state, update: withoutLock(state.update) } : state
    case 'reset':
      return INITIAL_LIVE_STATE
  }
}

/** The Catch button works while the scanner has locked on a bird. */
export const canCatchLive = (state: LiveScanState): boolean =>
  state.phase === 'running' && !state.catching && state.update?.lockedSpeciesId !== undefined

// ---------- The stall watch ----------

export type StallVerdict = 'waiting' | 'running' | 'stalled'

export interface VideoSample {
  /** The video has a picture to show (it is playing and has a size). */
  hasFrame: boolean
  /** Anything that changes whenever a new picture arrives: a frame counter, or the playback time. */
  marker: number
}

/**
 * Called every moment with the state of the video element. "waiting" until the first picture, "running" while pictures
 * keep arriving, "stalled" when none arrived for `timeoutMs` (counted from the start, or from the last picture).
 */
export class StallWatch {
  private readonly timeoutMs: number
  private lastProgressAt: number
  private lastMarker = Number.NaN
  private seenFrame = false

  constructor(startedAt: number, timeoutMs: number = CAMERA_STALL_MS) {
    this.timeoutMs = timeoutMs
    this.lastProgressAt = startedAt
  }

  check(sample: VideoSample, now: number): StallVerdict {
    if (sample.hasFrame && sample.marker !== this.lastMarker) {
      this.lastMarker = sample.marker
      this.lastProgressAt = now
      this.seenFrame = true
    }
    if (now - this.lastProgressAt >= this.timeoutMs) return 'stalled'
    return this.seenFrame ? 'running' : 'waiting'
  }
}
