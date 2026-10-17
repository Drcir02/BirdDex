// Microphone capture for the sound scanner.
//
//   const session = await startCapture({ onBlock: (samples, rms, peak, sampleRate) => ... })   // straight from a tap!
//   session.sampleRate                                                                           // 48000 on almost every phone
//   await session.stop()                                                             // releases the microphone
//
// What matters here:
// - iOS only starts audio when the code runs inside the tap. startCapture() therefore creates the AudioContext and asks
//   for the microphone before its first `await`; everything slow (loading the worklet) happens after.
// - Echo cancelling, noise suppression and automatic gain are switched off. They are made for phone calls and they
//   smear bird song, which BirdNET then cannot recognise. (Some browsers ignore the request; settings are reported.)
// - The audio context asks for 48 kHz, BirdNET's rate, so the browser itself converts whatever the hardware delivers.
//   If it refuses, `sampleRate` says what we really get and the caller converts with resample.ts.
// - The samples come from an AudioWorklet (public/worklets/capture-processor.js) in blocks of 2048 with their loudness.
//   Old browsers without worklets use a ScriptProcessorNode instead.

import { measureBlock } from './loudness'
import { TARGET_SAMPLE_RATE } from './resample'

export type CaptureFailure =
  /** This browser has no microphone API or no Web Audio. */
  | 'unsupported'
  /** The page is not on https (or localhost), so the browser hides the microphone. */
  | 'insecure'
  /** The person (or the system settings) said no. */
  | 'denied'
  /** No microphone found. */
  | 'no-device'
  /** The microphone exists but another app is using it, or it could not be started. */
  | 'busy'
  /** Something else went wrong. */
  | 'failed'
  /** The microphone stopped by itself after it had started (call, unplugged, permission withdrawn). */
  | 'interrupted'
  /** The scan ran for too long without being stopped, and stopped itself. */
  | 'timeout'

export class SoundCaptureError extends Error {
  readonly reason: CaptureFailure
  constructor(reason: CaptureFailure, message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'SoundCaptureError'
    this.reason = reason
  }
}

/** Turns what getUserMedia throws into a failure reason. */
export function captureFailureOf(error: unknown): CaptureFailure {
  const name = typeof error === 'object' && error !== null && 'name' in error ? String((error as { name: unknown }).name) : ''
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
    case 'SecurityError':
      return 'denied'
    case 'NotFoundError':
    case 'DevicesNotFoundError':
    case 'OverconstrainedError':
      return 'no-device'
    case 'NotReadableError':
    case 'TrackStartError':
    case 'AbortError':
      return 'busy'
    default:
      return 'failed'
  }
}

export interface CaptureHandlers {
  /**
   * A block of mono samples with its loudness (RMS and peak, 0 to 1). `sampleRate` is the rate of the samples, the same
   * for every block; it is passed along because blocks can arrive before startCapture() has returned its session.
   */
  onBlock(samples: Float32Array, rms: number, peak: number, sampleRate: number): void
  /** The microphone stopped by itself. Capture is over; call stop() to clean up. */
  onEnded?(reason: CaptureFailure): void
}

/** What the browser says it really gave us, for the field check and the dev page. */
export interface CaptureSettings {
  sampleRate?: number
  channelCount?: number
  // Browsers report these as true or false, newer ones may also say "all" or "remote-only" for echo cancellation.
  echoCancellation?: boolean | string
  noiseSuppression?: boolean | string
  autoGainControl?: boolean | string
}

export interface CaptureSession {
  /** Sample rate of the blocks passed to onBlock. */
  readonly sampleRate: number
  /** True when the audio context really runs at BirdNET's 48 kHz. */
  readonly atTargetRate: boolean
  readonly settings: CaptureSettings
  /** 'worklet' or 'script-processor'. */
  readonly method: 'worklet' | 'script-processor'
  /** Releases the microphone and the audio context. Safe to call many times. */
  stop(): Promise<void>
}

type WebkitWindow = Window & { webkitAudioContext?: typeof AudioContext }

const WORKLET_NAME = 'capture-processor'
const SCRIPT_BLOCK = 4096

export const CAPTURE_CONSTRAINTS: MediaStreamConstraints = {
  audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
}

function createContext(): AudioContext {
  const Context = window.AudioContext ?? (window as WebkitWindow).webkitAudioContext
  if (!Context) throw new SoundCaptureError('unsupported', 'This browser has no Web Audio')
  try {
    return new Context({ sampleRate: TARGET_SAMPLE_RATE })
  } catch {
    // Some browsers refuse a fixed rate. The default one works; the caller will resample.
    return new Context()
  }
}

/**
 * Opens the microphone and starts delivering samples. Call it directly from the tap handler (no `await` before it).
 * Rejects with a SoundCaptureError; the audio context is closed again in that case.
 */
export function startCapture(handlers: CaptureHandlers): Promise<CaptureSession> {
  // ----- Synchronous part: must happen inside the tap. -----
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return Promise.reject(new SoundCaptureError('unsupported', 'There is no browser here'))
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    const insecure = window.isSecureContext === false
    return Promise.reject(
      new SoundCaptureError(insecure ? 'insecure' : 'unsupported', insecure ? 'The microphone needs a secure (https) page' : 'This browser cannot record sound'),
    )
  }

  let context: AudioContext
  try {
    context = createContext()
  } catch (error) {
    return Promise.reject(error instanceof SoundCaptureError ? error : new SoundCaptureError('unsupported', 'The audio system could not start', { cause: error }))
  }
  void context.resume().catch(() => undefined)

  let streamRequest: Promise<MediaStream>
  try {
    streamRequest = navigator.mediaDevices.getUserMedia(CAPTURE_CONSTRAINTS)
  } catch (error) {
    void context.close().catch(() => undefined)
    return Promise.reject(new SoundCaptureError(captureFailureOf(error), 'The microphone could not be requested', { cause: error }))
  }

  return connect(context, streamRequest, handlers)
}

async function connect(context: AudioContext, streamRequest: Promise<MediaStream>, handlers: CaptureHandlers): Promise<CaptureSession> {
  let stream: MediaStream | undefined
  const nodes: AudioNode[] = []
  let stopped = false
  let stopping: Promise<void> | undefined
  const cleanups: Array<() => void> = []

  const stop = (): Promise<void> => {
    if (stopping) return stopping
    stopped = true
    stopping = (async () => {
      for (const undo of cleanups.splice(0)) undo()
      for (const node of nodes) {
        try {
          node.disconnect()
        } catch {
          // Already disconnected.
        }
      }
      stream?.getTracks().forEach((track) => track.stop())
      try {
        await context.close()
      } catch {
        // Already closed.
      }
    })()
    return stopping
  }

  try {
    try {
      stream = await streamRequest
    } catch (error) {
      const reason = captureFailureOf(error)
      throw new SoundCaptureError(reason, reason === 'denied' ? 'The microphone is blocked' : 'The microphone could not be opened', { cause: error })
    }
    const track = stream.getAudioTracks()[0]
    if (!track) throw new SoundCaptureError('no-device', 'The microphone gave no audio track')

    const source = context.createMediaStreamSource(stream)
    nodes.push(source)
    // Everything is routed through a silent gain node to the speakers: some browsers only pull audio through the
    // graph when it ends in the destination. Gain 0 keeps the microphone out of the speaker (no howling).
    const mute = context.createGain()
    mute.gain.value = 0
    mute.connect(context.destination)
    nodes.push(mute)

    let method: CaptureSession['method'] = 'worklet'
    try {
      if (!context.audioWorklet) throw new Error('No AudioWorklet')
      await context.audioWorklet.addModule(`${import.meta.env.BASE_URL}worklets/capture-processor.js`)
      const worklet = new AudioWorkletNode(context, WORKLET_NAME, {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        channelCount: 1,
        channelCountMode: 'explicit',
        outputChannelCount: [1],
      })
      worklet.port.onmessage = (event: MessageEvent<{ samples: Float32Array; rms: number; peak: number }>) => {
        if (stopped) return
        handlers.onBlock(event.data.samples, event.data.rms, event.data.peak, context.sampleRate)
      }
      cleanups.push(() => {
        worklet.port.onmessage = null
      })
      nodes.push(worklet)
      source.connect(worklet)
      worklet.connect(mute)
    } catch {
      // No worklets (old browser) or the file could not be loaded: fall back to the older ScriptProcessorNode.
      method = 'script-processor'
      const processor = context.createScriptProcessor(SCRIPT_BLOCK, 1, 1)
      processor.onaudioprocess = (event) => {
        if (stopped) return
        const samples = event.inputBuffer.getChannelData(0).slice()
        const { rms, peak } = measureBlock(samples)
        handlers.onBlock(samples, rms, peak, context.sampleRate)
      }
      cleanups.push(() => {
        processor.onaudioprocess = null
      })
      nodes.push(processor)
      source.connect(processor)
      processor.connect(mute)
    }
    if (stopped) throw new SoundCaptureError('failed', 'Capture was stopped while starting')

    // If the microphone dies later (call, unplugged, permission withdrawn) tell the owner of the session.
    const onTrackEnded = () => {
      if (!stopped) handlers.onEnded?.('interrupted')
    }
    track.addEventListener('ended', onTrackEnded)
    cleanups.push(() => track.removeEventListener('ended', onTrackEnded))

    // Phone calls, locking the screen and switching apps suspend the audio context. Bring it back when we can.
    const resumeIfNeeded = () => {
      if (!stopped && context.state !== 'running' && context.state !== 'closed') void context.resume().catch(() => undefined)
    }
    context.addEventListener('statechange', resumeIfNeeded)
    document.addEventListener('visibilitychange', resumeIfNeeded)
    cleanups.push(() => {
      context.removeEventListener('statechange', resumeIfNeeded)
      document.removeEventListener('visibilitychange', resumeIfNeeded)
    })
    if (context.state !== 'running') void context.resume().catch(() => undefined)

    const raw = track.getSettings()
    const settings: CaptureSettings = {
      sampleRate: raw.sampleRate,
      channelCount: raw.channelCount,
      echoCancellation: raw.echoCancellation,
      noiseSuppression: raw.noiseSuppression,
      autoGainControl: raw.autoGainControl,
    }
    return {
      sampleRate: context.sampleRate,
      atTargetRate: context.sampleRate === TARGET_SAMPLE_RATE,
      settings,
      method,
      stop,
    }
  } catch (error) {
    await stop()
    throw error instanceof SoundCaptureError ? error : new SoundCaptureError('failed', 'The microphone could not be started', { cause: error })
  }
}
