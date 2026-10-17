import { describe, expect, it } from 'vitest'
import { Resampler, resample, resampleTo48k, TARGET_SAMPLE_RATE } from '../../src/ml/audio/resample'

// The resampler is checked with pure tones: after conversion a tone must still have the same frequency, amplitude and
// phase, and a tone that cannot exist at 48 kHz must be filtered away instead of folding back into the band.

function tone(frequency: number, rate: number, seconds: number, amplitude = 0.5): Float32Array {
  const samples = new Float32Array(Math.round(rate * seconds))
  for (let i = 0; i < samples.length; i++) samples[i] = amplitude * Math.sin((2 * Math.PI * frequency * i) / rate)
  return samples
}

/** Root mean square of the difference between two signals, ignoring `margin` samples at each end. */
function rmsError(actual: Float32Array, expected: Float32Array, margin: number): number {
  let sum = 0
  let count = 0
  for (let i = margin; i < Math.min(actual.length, expected.length) - margin; i++) {
    const d = actual[i] - expected[i]
    sum += d * d
    count++
  }
  return Math.sqrt(sum / count)
}

function rms(samples: Float32Array, margin: number): number {
  let sum = 0
  let count = 0
  for (let i = margin; i < samples.length - margin; i++) {
    sum += samples[i] * samples[i]
    count++
  }
  return Math.sqrt(sum / count)
}

const db = (ratio: number) => 20 * Math.log10(ratio)

describe('resampling to 48 kHz', () => {
  describe.each([44100, 48000, 16000, 96000])('from %i Hz', (rate) => {
    it('gives one second of audio for one second of input', () => {
      const out = resampleTo48k(tone(1000, rate, 1), rate)
      expect(Math.abs(out.length - TARGET_SAMPLE_RATE)).toBeLessThanOrEqual(1)
    })

    // Tones that every one of these rates can carry (16 kHz audio only reaches 8 kHz).
    it.each([440, 1000, 3000, 6500])('keeps a %i Hz tone: same amplitude, frequency and phase', (frequency) => {
      const out = resampleTo48k(tone(frequency, rate, 1), rate)
      const ideal = tone(frequency, TARGET_SAMPLE_RATE, 1)
      // 3000 samples at each end are skipped: the filter has no audio before the start and after the end.
      expect(rmsError(out, ideal, 3000)).toBeLessThan(0.002) // against an amplitude of 0.5: under 0.6 percent
    })

    if (rate >= 44100) {
      it.each([10000, 14500])('keeps a %i Hz tone (the upper range of bird song)', (frequency) => {
        const out = resampleTo48k(tone(frequency, rate, 1), rate)
        expect(rmsError(out, tone(frequency, TARGET_SAMPLE_RATE, 1), 3000)).toBeLessThan(0.003)
      })
    }

    it('keeps a constant level constant', () => {
      const flat = new Float32Array(rate).fill(0.25)
      const out = resampleTo48k(flat, rate)
      for (let i = 3000; i < out.length - 3000; i += 997) expect(out[i]).toBeCloseTo(0.25, 5)
    })
  })

  it('does not change audio that is already at 48 kHz', () => {
    const input = tone(2000, 48000, 0.5)
    const out = resampleTo48k(input, 48000)
    expect(out).toEqual(input)
    expect(out).not.toBe(input) // a copy, so the caller may reuse its buffer
  })

  it('filters a tone above 24 kHz away when converting down from 96 kHz instead of folding it into the band', () => {
    // 30 kHz would fold back to 18 kHz at 48 kHz if nothing filtered it.
    const out = resampleTo48k(tone(30000, 96000, 1, 0.5), 96000)
    expect(db(rms(out, 3000) / (0.5 / Math.SQRT2))).toBeLessThan(-70)
  })

  it('works for the other usual rates as well', () => {
    for (const rate of [8000, 11025, 22050, 32000, 88200, 192000]) {
      const input = tone(1500, rate, 0.5)
      const out = resampleTo48k(input, rate)
      expect(out.length).toBe(Math.floor((input.length * TARGET_SAMPLE_RATE) / rate))
      expect(rmsError(out, tone(1500, TARGET_SAMPLE_RATE, 0.5), 2500)).toBeLessThan(0.003)
    }
  })

  describe('as a stream', () => {
    // A tiny deterministic generator, so the chunk sizes are the same on every run.
    const random = (seed: number) => () => {
      seed = (seed * 1664525 + 1013904223) >>> 0
      return seed / 4294967296
    }

    it.each([44100, 16000, 96000, 22050])('gives the same samples however the input is cut into blocks (%i Hz)', (rate) => {
      const input = new Float32Array(rate * 2)
      const next = random(rate)
      for (let i = 0; i < input.length; i++) input[i] = next() * 2 - 1 // noise, the hardest case

      const whole = resample(input, rate)

      const rand = random(7)
      const resampler = new Resampler(rate)
      const parts: Float32Array[] = []
      for (let at = 0; at < input.length; ) {
        const size = Math.max(1, Math.floor(rand() * 5000)) // 1 to 5000 samples, including tiny blocks
        parts.push(resampler.process(input.subarray(at, at + size)))
        at += size
      }
      parts.push(resampler.flush())
      const length = parts.reduce((total, part) => total + part.length, 0)
      const joined = new Float32Array(length)
      let offset = 0
      for (const part of parts) {
        joined.set(part, offset)
        offset += part.length
      }
      expect(joined.length).toBe(whole.length)
      expect(joined).toEqual(whole)
    })

    it('hands out audio as it goes, with only a short delay, in blocks like the microphone delivers', () => {
      const rate = 44100
      const resampler = new Resampler(rate)
      let produced = 0
      let fed = 0
      for (let block = 0; block < 100; block++) {
        produced += resampler.process(new Float32Array(2048)).length
        fed += 2048
      }
      // Never more than 40 samples (a filter half width) behind.
      expect(fed * (TARGET_SAMPLE_RATE / rate) - produced).toBeLessThan(60)
      expect(produced).toBeGreaterThan(0)
    })

    it('uses bounded memory on a long stream', () => {
      const resampler = new Resampler(44100)
      const block = tone(1000, 44100, 1)
      let samples = 0
      for (let second = 0; second < 60; second++) samples += resampler.process(block).length
      expect(samples).toBeGreaterThan(60 * 48000 - 100)
      const internal = resampler as unknown as { buffer: Float32Array }
      expect(internal.buffer.length).toBeLessThan(2 * 44100) // never the whole minute
    })
  })

  it('refuses sample rates that make no sense', () => {
    expect(() => new Resampler(0)).toThrow(RangeError)
    expect(() => new Resampler(Number.NaN)).toThrow(RangeError)
    expect(() => new Resampler(44100, -1)).toThrow(RangeError)
  })

  it('handles empty input', () => {
    expect(resampleTo48k(new Float32Array(0), 44100).length).toBe(0)
    const resampler = new Resampler(16000)
    expect(resampler.process(new Float32Array(0)).length).toBe(0)
    expect(resampler.flush().length).toBe(0)
  })
})
