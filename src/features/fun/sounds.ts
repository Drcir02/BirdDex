// Sound effects made with Web Audio: no audio files. A happy catch jingle (longer for rarer birds), a lock-on blip and a
// soft error tone. They respect the "Zvukové efekty" setting.
//
// iOS rules: an AudioContext only makes sound after it was created or resumed inside a tap. `installAudioUnlock()` listens for the
// person's first taps anywhere in the app and unlocks the context there, so the jingle can play later without a tap of its own.
// (The ringer switch of an iPhone also mutes Web Audio; that is the phone's rule and cannot be changed from a web page.)

import type { Rarity } from '../../domain/types'
import { getSettings } from '../../state/settings'

export type SoundName = 'catch' | 'lock' | 'error'

export type PlaySound = (sound: SoundName, rarity?: Rarity) => void

export interface Note {
  /** Hertz. */
  freq: number
  /** Seconds from the start of the sound. */
  start: number
  /** Seconds. */
  duration: number
  type: 'square' | 'triangle' | 'sine'
  /** 0 to 1, before the master volume. */
  gain: number
  /** Optional glide to this frequency over the note. */
  slideTo?: number
}

// Equal-tempered notes used by the jingles.
const C5 = 523.25
const D5 = 587.33
const E5 = 659.25
const G5 = 783.99
const A5 = 880
const C6 = 1046.5
const E6 = 1318.5
const G6 = 1568
const C7 = 2093

/** The notes of a sound. Pure, so it can be tested without any audio. */
export function notesFor(sound: SoundName, rarity: Rarity = 'common'): Note[] {
  if (sound === 'lock') {
    return [
      { freq: A5, start: 0, duration: 0.07, type: 'square', gain: 0.5 },
      { freq: E6, start: 0.08, duration: 0.12, type: 'square', gain: 0.55 },
    ]
  }
  if (sound === 'error') {
    return [
      { freq: 330, start: 0, duration: 0.16, type: 'triangle', gain: 0.6 },
      { freq: 262, start: 0.17, duration: 0.3, type: 'triangle', gain: 0.55, slideTo: 247 },
    ]
  }

  // The catch jingle: a rising arpeggio, and the rarer the bird the longer and brighter the ending.
  const step = 0.1
  const base: Note[] = [C5, E5, G5, C6].map((freq, index) => ({ freq, start: index * step, duration: 0.14, type: 'square', gain: 0.5 }))
  const last = base[base.length - 1].start + step
  const ring = (freq: number, start: number, duration: number): Note => ({ freq, start, duration, type: 'triangle', gain: 0.5 })

  switch (rarity) {
    case 'common':
      return [...base, { freq: C6, start: last, duration: 0.3, type: 'square', gain: 0.45 }]
    case 'uncommon':
      return [...base, { freq: E6, start: last, duration: 0.34, type: 'square', gain: 0.45 }, ring(C5, last, 0.34)]
    case 'rare':
      return [...base, { freq: E6, start: last, duration: 0.14, type: 'square', gain: 0.45 }, { freq: G6, start: last + step, duration: 0.4, type: 'square', gain: 0.45 }, ring(E5, last, 0.5)]
    case 'epic':
      return [
        ...base,
        { freq: E6, start: last, duration: 0.12, type: 'square', gain: 0.45 },
        { freq: G6, start: last + step, duration: 0.12, type: 'square', gain: 0.45 },
        { freq: C7, start: last + 2 * step, duration: 0.5, type: 'square', gain: 0.4 },
        ring(G5, last, 0.6),
      ]
    case 'legendary':
      return [
        { freq: D5, start: 0, duration: 0.09, type: 'square', gain: 0.5 },
        ...base.map((note) => ({ ...note, start: note.start + 0.1 })),
        { freq: E6, start: last + 0.1, duration: 0.1, type: 'square', gain: 0.45 },
        { freq: G6, start: last + 0.2, duration: 0.1, type: 'square', gain: 0.45 },
        { freq: C7, start: last + 0.3, duration: 0.7, type: 'square', gain: 0.4 },
        ring(C5, last + 0.1, 0.9),
        ring(G5, last + 0.3, 0.8),
        { freq: C7, start: last + 0.5, duration: 0.5, type: 'sine', gain: 0.35, slideTo: C7 * 1.5 },
      ]
  }
}

/** How long a sound lasts, in seconds. */
export function soundLength(sound: SoundName, rarity: Rarity = 'common'): number {
  return notesFor(sound, rarity).reduce((end, note) => Math.max(end, note.start + note.duration), 0)
}

// ---------- The player ----------

/** The little part of the Web Audio API that is used, so a test can pass a stand-in. */
export interface ParamLike {
  value: number
  setValueAtTime(value: number, time: number): unknown
  linearRampToValueAtTime(value: number, time: number): unknown
  exponentialRampToValueAtTime(value: number, time: number): unknown
}
export interface NodeLike {
  connect(destination: unknown): unknown
  disconnect?(): unknown
}
export interface OscillatorLike extends NodeLike {
  type: string
  frequency: ParamLike
  onended: (() => void) | null
  start(time: number): void
  stop(time: number): void
}
export interface GainLike extends NodeLike {
  gain: ParamLike
}
export interface AudioContextLike {
  readonly currentTime: number
  readonly state: string
  readonly destination: unknown
  resume(): Promise<void>
  close?(): Promise<void>
  createOscillator(): OscillatorLike
  createGain(): GainLike
  createBuffer?(channels: number, length: number, sampleRate: number): unknown
  createBufferSource?(): { buffer: unknown; connect(destination: unknown): unknown; start(time?: number): void }
}

/** Overall loudness: the jingles are bright square waves, so keep them gentle. */
const MASTER_VOLUME = 0.22

export interface SoundPlayerOptions {
  createContext?: () => AudioContextLike | undefined
  isEnabled?: () => boolean
}

export interface SoundPlayer {
  /** Creates and resumes the audio context. Must run inside a tap (or key press) on iOS. */
  unlock(): void
  play: PlaySound
  /** Whether a context exists and is running. */
  isRunning(): boolean
  dispose(): void
}

function browserContext(): AudioContextLike | undefined {
  if (typeof window === 'undefined') return undefined
  const Constructor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Constructor) return undefined
  try {
    return new Constructor() as unknown as AudioContextLike
  } catch {
    return undefined
  }
}

export function createSoundPlayer(options: SoundPlayerOptions = {}): SoundPlayer {
  const createContext = options.createContext ?? browserContext
  const isEnabled = options.isEnabled ?? (() => getSettings().soundEffects)
  let context: AudioContextLike | undefined
  let attempted = false

  const ensureContext = (): AudioContextLike | undefined => {
    if (!context && !attempted) {
      attempted = true
      context = createContext()
    }
    return context
  }

  const resume = (ctx: AudioContextLike) => {
    if (ctx.state === 'running') return
    try {
      void ctx.resume().catch(() => undefined)
    } catch {
      // Not allowed yet: the next tap tries again.
    }
  }

  const unlock = () => {
    const ctx = ensureContext()
    if (!ctx) return
    resume(ctx)
    // iOS wants some sound to be started inside the tap: a silent one-sample buffer does it.
    try {
      const buffer = ctx.createBuffer?.(1, 1, 22050)
      const source = ctx.createBufferSource?.()
      if (buffer && source) {
        source.buffer = buffer
        source.connect(ctx.destination)
        source.start(0)
      }
    } catch {
      // Not every context can do it; resume() was the important part.
    }
  }

  const play: PlaySound = (sound, rarity) => {
    if (!isEnabled()) return
    const ctx = ensureContext()
    if (!ctx) return
    resume(ctx)
    try {
      const startAt = ctx.currentTime + 0.02
      for (const note of notesFor(sound, rarity)) {
        const oscillator = ctx.createOscillator()
        const envelope = ctx.createGain()
        oscillator.type = note.type
        const from = startAt + note.start
        const to = from + note.duration
        oscillator.frequency.setValueAtTime(note.freq, from)
        if (note.slideTo) oscillator.frequency.linearRampToValueAtTime(note.slideTo, to)
        // A quick attack and a smooth fade, so notes do not click.
        envelope.gain.setValueAtTime(0.0001, from)
        envelope.gain.linearRampToValueAtTime(note.gain * MASTER_VOLUME, from + 0.012)
        envelope.gain.exponentialRampToValueAtTime(0.0001, to)
        oscillator.connect(envelope)
        envelope.connect(ctx.destination)
        oscillator.onended = () => {
          oscillator.disconnect?.()
          envelope.disconnect?.()
        }
        oscillator.start(from)
        oscillator.stop(to + 0.03)
      }
    } catch {
      // Sound is a bonus: never let it break a screen.
    }
  }

  return {
    unlock,
    play,
    isRunning: () => context?.state === 'running',
    dispose() {
      const ctx = context
      context = undefined
      attempted = false
      void ctx?.close?.().catch(() => undefined)
    },
  }
}

// ---------- The app's own player ----------

const appPlayer = createSoundPlayer()

/** Plays a sound effect (when the setting is on). Safe to call from anywhere; it never throws. */
export const playSound: PlaySound = (sound, rarity) => appPlayer.play(sound, rarity)

/** Unlocks audio. Call it inside a tap handler. */
export const unlockAudio = (): void => appPlayer.unlock()

const UNLOCK_EVENTS = ['pointerup', 'touchend', 'click', 'keydown'] as const
let unlockInstalled = false
let visibilityHooked = false

function removeUnlockListeners(onGesture: () => void) {
  for (const name of UNLOCK_EVENTS) document.removeEventListener(name, onGesture, true)
  unlockInstalled = false
}

/**
 * Unlocks audio on the person's first tap or key press anywhere in the app (when sound effects are on). Safe to call more than once.
 * When sound effects are off nothing is created; switching them on in the settings plays a sample from inside that tap.
 */
export function installAudioUnlock(): void {
  if (typeof document === 'undefined') return
  if (!visibilityHooked) {
    visibilityHooked = true
    // iOS stops the context when the app goes to the background ("interrupted"); the next tap wakes it again.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && !appPlayer.isRunning()) installAudioUnlock()
    })
  }
  if (unlockInstalled) return
  unlockInstalled = true
  const onGesture = () => {
    if (!getSettings().soundEffects) return
    appPlayer.unlock()
    if (appPlayer.isRunning()) removeUnlockListeners(onGesture)
  }
  for (const name of UNLOCK_EVENTS) document.addEventListener(name, onGesture, { capture: true, passive: true })
}

installAudioUnlock()
