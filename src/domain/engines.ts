// The contract between the screens and the identification code in src/ml.
// Screens only know these interfaces. Tests and e2e runs can swap in fakes (src/ml/fakes.ts).

import type { Candidate, GeoPoint, ModelProgress } from './types'

export type ProgressCallback = (progress: ModelProgress) => void

// ---------- Sound ----------

export interface SoundUpdate {
  /** Up to three guesses so far, strongest first, already limited to species in the Dex. */
  candidates: Candidate[]
  /** Input loudness from 0 to 1, for the level meter. */
  level: number
  analysedSeconds: number
  /** True while a recent window scored high enough to say "I hear a bird". */
  hearingBird: boolean
}

export interface SoundResult {
  candidates: Candidate[]
  /** The best few seconds around the strongest detection, as a 16-bit mono 48 kHz WAV. */
  clip?: Blob
  clipSeconds?: number
}

export interface SoundSession {
  stop(): Promise<SoundResult>
}

export interface SoundEngine {
  /** Downloads and prepares the models. Safe to call many times. */
  prepare(onProgress?: ProgressCallback): Promise<void>
  /** Must be called straight from a tap: iOS only starts audio inside a user gesture. */
  start(options: {
    location?: GeoPoint
    date?: Date
    onUpdate: (update: SoundUpdate) => void
    /**
     * Optional. Called when something goes wrong after the start: the microphone is taken away (a call, unplugged, permission
     * withdrawn) or the scan ran out of time. stop() still works and returns what was heard so far. (Added by the sound engine.)
     */
    onError?: (error: unknown) => void
  }): Promise<SoundSession>
}

// ---------- Photo ----------

export type ImageSource = ImageBitmap | HTMLCanvasElement | HTMLImageElement | HTMLVideoElement

export interface PhotoResult {
  candidates: Candidate[]
  /** Probability that the picture shows a bird at all, from 0 to 1. */
  pBird: number
  /**
   * How sure the plain model is of its best species outside the Dex, from 0 to 1 (a bird we do not have in the Dex that looks
   * like one we have). Absent from fakes and from engines that cannot tell. High values make the Catch button wait.
   */
  outsideDexTop?: number
}

export interface PhotoEngine {
  prepare(onProgress?: ProgressCallback): Promise<void>
  identify(image: ImageSource, options?: { location?: GeoPoint; date?: Date }): Promise<PhotoResult>
}

// ---------- Live camera ----------

export interface LiveUpdate {
  candidates: Candidate[]
  pBird: number
  /** Smoothed like the confidences; see PhotoResult. */
  outsideDexTop?: number
  /** Set when the same species has been first for several frames in a row. */
  lockedSpeciesId?: string
  framesPerSecond: number
}

export interface LiveSession {
  stop(): void
  /** A JPEG of the current frame, to save with the catch. */
  snapshot(): Promise<Blob>
}

export interface LiveScanner {
  start(
    video: HTMLVideoElement,
    options: {
      location?: GeoPoint
      date?: Date
      onUpdate: (update: LiveUpdate) => void
      /**
       * Optional. Called once when the scanner gives up because analysing the picture failed several times in a row.
       * The session has stopped by then. (Added by the live scanner.)
       */
      onError?: (error: unknown) => void
    },
  ): Promise<LiveSession>
}

export interface Engines {
  sound: SoundEngine
  photo: PhotoEngine
  live: LiveScanner
}
