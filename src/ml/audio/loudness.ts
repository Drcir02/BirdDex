// Loudness for the level meter on the scan screen.
//
// The microphone gives us blocks of samples between -1 and 1. The meter wants one number from 0 to 1 that looks
// natural: our ears judge loudness on a logarithmic scale, so the meter works in decibels relative to full scale
// (dBFS): -60 dBFS (a very quiet room) is empty, 0 dBFS (the loudest the phone can record) is full.

export const METER_FLOOR_DB = -60

/** Amplitude (0 to 1) in decibels relative to full scale. Silence is -120. */
export function toDb(amplitude: number): number {
  return amplitude > 1e-6 ? 20 * Math.log10(amplitude) : -120
}

/** Root mean square and peak of a block of samples. */
export function measureBlock(samples: Float32Array): { rms: number; peak: number } {
  if (samples.length === 0) return { rms: 0, peak: 0 }
  let sum = 0
  let peak = 0
  for (let i = 0; i < samples.length; i++) {
    const value = samples[i]
    sum += value * value
    const magnitude = Math.abs(value)
    if (magnitude > peak) peak = magnitude
  }
  return { rms: Math.sqrt(sum / samples.length), peak }
}

/** An amplitude as a meter position: -60 dBFS gives 0, 0 dBFS gives 1. */
export function meterPosition(amplitude: number): number {
  return Math.min(1, Math.max(0, (toDb(amplitude) - METER_FLOOR_DB) / -METER_FLOOR_DB))
}

/**
 * A meter with a quick rise and a gentle fall, so the needle does not flicker. Feed it the loudness of each block.
 */
export class LevelMeter {
  private level = 0
  /** Seconds the needle takes to fall by about two thirds. */
  private readonly releaseSeconds: number

  constructor(releaseSeconds = 0.25) {
    this.releaseSeconds = releaseSeconds
  }

  /** Returns the new meter value (0 to 1). `seconds` is the length of the block that was measured. */
  update(rms: number, seconds: number): number {
    const target = meterPosition(rms)
    if (target >= this.level) {
      this.level = target
    } else {
      const fall = 1 - Math.exp(-Math.max(0, seconds) / this.releaseSeconds)
      this.level += (target - this.level) * fall
    }
    return this.level
  }

  get value(): number {
    return this.level
  }

  reset(): void {
    this.level = 0
  }
}
