// The "level bar" of the recording player: how loud the clip is over time, as a handful of bars from 0 to 1.
// Computed once from the saved WAV file (the format the sound scan saves), so no AudioContext is needed to play it.

import { decodeWav } from '../../ml/audio/wav'

export const ENVELOPE_BARS = 32

/** The loudness (RMS) of `bars` equal slices of the samples, scaled so that the loudest slice is 1. Silence gives all zeros. */
export function computeEnvelope(samples: Float32Array, bars = ENVELOPE_BARS): number[] {
  if (bars < 1 || samples.length === 0) return Array.from({ length: Math.max(0, bars) }, () => 0)
  const levels: number[] = []
  for (let bar = 0; bar < bars; bar += 1) {
    const from = Math.floor((bar * samples.length) / bars)
    const to = Math.max(from + 1, Math.floor(((bar + 1) * samples.length) / bars))
    let sum = 0
    for (let index = from; index < to && index < samples.length; index += 1) sum += samples[index] * samples[index]
    levels.push(Math.sqrt(sum / (to - from)))
  }
  const loudest = Math.max(...levels)
  return loudest > 1e-6 ? levels.map((level) => level / loudest) : levels.map(() => 0)
}

/** The envelope of a WAV file, or undefined when the file is not one the decoder knows (the player then draws a flat bar). */
export function envelopeOfWav(bytes: Uint8Array, bars = ENVELOPE_BARS): number[] | undefined {
  try {
    return computeEnvelope(decodeWav(bytes).samples, bars)
  } catch {
    return undefined
  }
}
