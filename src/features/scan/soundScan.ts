// The states of a sound scan as a small pure state machine. The hook that drives it with the real engine is useSoundScan.ts.
//
//   idle -> starting (tap, waiting for the microphone) -> listening -> stopping -> (the result screen)
//                         \-> error                         \-> paused (the page went away, or the microphone was taken)
//                                                            \-> error

import type { SoundUpdate } from '../../domain/engines'
import type { Candidate } from '../../domain/types'
import type { ScanErrorKind } from './errors'

/** A scan stops by itself after a minute: long enough for a bird to sing twice, short enough to forget the phone in a pocket. */
export const SOUND_LIMIT_MS = 60_000

export type SoundPhase = 'idle' | 'starting' | 'listening' | 'stopping' | 'paused' | 'error'

/** Why a listening scan stopped without the person pressing Done. */
export type PauseReason = 'hidden' | 'microphone'

export interface SoundScanState {
  phase: SoundPhase
  /** 0 to 1, for the level meter. */
  level: number
  candidates: readonly Candidate[]
  hearingBird: boolean
  analysedSeconds: number
  /** When listening began, in performance.now() milliseconds. For the elapsed time. */
  startedAt?: number
  error?: ScanErrorKind
  pauseReason?: PauseReason
  /** A paused scan that heard something that is worth showing. */
  hasResult: boolean
}

export const INITIAL_SOUND_STATE: SoundScanState = {
  phase: 'idle',
  level: 0,
  candidates: [],
  hearingBird: false,
  analysedSeconds: 0,
  hasResult: false,
}

export type SoundAction =
  | { type: 'start' }
  | { type: 'update'; update: SoundUpdate }
  | { type: 'listening'; startedAt: number }
  | { type: 'stopping' }
  | { type: 'paused'; reason: PauseReason; hasResult: boolean }
  | { type: 'failed'; error: ScanErrorKind }
  | { type: 'reset' }

export function soundReducer(state: SoundScanState, action: SoundAction): SoundScanState {
  switch (action.type) {
    case 'start':
      return { ...INITIAL_SOUND_STATE, phase: 'starting' }
    case 'update':
      // Updates that arrive after Done, or before a start, are ignored.
      if (state.phase !== 'starting' && state.phase !== 'listening') return state
      return {
        ...state,
        phase: 'listening',
        level: Number.isFinite(action.update.level) ? Math.min(1, Math.max(0, action.update.level)) : 0,
        candidates: action.update.candidates,
        hearingBird: action.update.hearingBird,
        analysedSeconds: action.update.analysedSeconds,
      }
    case 'listening':
      if (state.phase !== 'starting' && state.phase !== 'listening') return state
      return { ...state, phase: 'listening', startedAt: action.startedAt }
    case 'stopping':
      return state.phase === 'starting' || state.phase === 'listening' ? { ...state, phase: 'stopping', level: 0 } : state
    case 'paused':
      return { ...state, phase: 'paused', level: 0, hearingBird: false, pauseReason: action.reason, hasResult: action.hasResult }
    case 'failed':
      return { ...state, phase: 'error', level: 0, hearingBird: false, error: action.error }
    case 'reset':
      return INITIAL_SOUND_STATE
  }
}

/** True while the microphone is (or is about to be) open. */
export const isScanning = (state: SoundScanState): boolean => state.phase === 'starting' || state.phase === 'listening'

/** Milliseconds left of the minute, never negative. */
export function remainingMs(elapsedMs: number, limitMs: number = SOUND_LIMIT_MS): number {
  return Math.max(0, limitMs - Math.max(0, elapsedMs))
}
