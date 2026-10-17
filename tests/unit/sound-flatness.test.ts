import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { decodeWav } from '../../src/ml/audio/wav'
import { FLAT_LIMIT, fft, isOnlyHiss, spectralFlatness } from '../../src/ml/audio/flatness'

// BirdNET reads flat noise as a Lesser Spotted Woodpecker (0.51 to 0.58, measured with the real model in Python), the same
// score as a faint real bird. The check in flatness.ts keeps such windows away from the model.

const RATE = 48000
const WINDOW = 144000

/** Small deterministic generator (mulberry32) and Gaussian numbers from it. */
function gaussian(seed: number): () => number {
  let state = seed >>> 0
  const uniform = () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return () => Math.sqrt(-2 * Math.log(uniform() + 1e-12)) * Math.cos(2 * Math.PI * uniform())
}

/** Noise whose power falls by `dbPerOctave` per octave above 1 kHz (0 = white), loudness `sigma`. */
function hiss(dbPerOctave: number, sigma = 0.05, seed = 1): Float32Array {
  const size = 262144
  const next = gaussian(seed)
  const re = new Float64Array(size)
  const im = new Float64Array(size)
  for (let i = 0; i < size; i++) re[i] = next()
  fft(re, im, size)
  for (let bin = 0; bin <= size / 2; bin++) {
    const f = Math.max(bin * (RATE / size), 1)
    const gain = Math.pow(f / 1000, dbPerOctave / 6.0206)
    re[bin] *= gain
    im[bin] *= gain
    if (bin > 0 && bin < size / 2) {
      re[size - bin] = re[bin]
      im[size - bin] = -im[bin]
    }
  }
  // inverse FFT through the forward one: conjugate, transform, conjugate (the result is real, so only re matters)
  for (let i = 0; i < size; i++) im[i] = -im[i]
  fft(re, im, size)
  const out = new Float32Array(WINDOW)
  let sum = 0
  for (let i = 0; i < WINDOW; i++) sum += re[i] * re[i]
  const scale = sigma / Math.sqrt(sum / WINDOW)
  for (let i = 0; i < WINDOW; i++) out[i] = re[i] * scale
  return out
}

describe('spectral flatness', () => {
  it('is close to 1 for white noise, at any loudness', () => {
    for (const sigma of [0.1, 0.01, 0.001]) expect(spectralFlatness(hiss(0, sigma), RATE)).toBeGreaterThan(0.99)
  })

  it('does not depend on how loud the sound is', () => {
    const quiet = hiss(-2, 0.001)
    const loud = hiss(-2, 0.1)
    expect(Math.abs(spectralFlatness(quiet, RATE) - spectralFlatness(loud, RATE))).toBeLessThan(1e-6)
  })

  it('falls as the spectrum slopes: -1.5 dB per octave is just flat, -3 dB per octave is not', () => {
    const flat = spectralFlatness(hiss(-1.5), RATE)
    const sloped = spectralFlatness(hiss(-3), RATE)
    expect(flat).toBeGreaterThan(0.94)
    expect(sloped).toBeLessThan(0.9)
    expect(sloped).toBeLessThan(flat)
  })

  it('is low for a tone in a little noise', () => {
    const samples = hiss(0, 0.002)
    for (let i = 0; i < samples.length; i++) samples[i] += 0.1 * Math.sin((2 * Math.PI * 4000 * i) / RATE)
    expect(spectralFlatness(samples, RATE)).toBeLessThan(0.3)
  })

  it('cannot judge digital silence or audio shorter than one frame, and says 0 (not flat)', () => {
    expect(spectralFlatness(new Float32Array(WINDOW), RATE)).toBe(0)
    expect(spectralFlatness(new Float32Array(1000).fill(0.1), RATE)).toBe(0)
  })

  it('refuses an FFT size that is not a power of two', () => {
    expect(() => spectralFlatness(new Float32Array(WINDOW), RATE, { fftSize: 1000 })).toThrow(RangeError)
  })

  it('agrees with a plain DFT on a small frame (the FFT is right)', () => {
    const size = 16
    const re = new Float64Array(size)
    const im = new Float64Array(size)
    const x = Array.from({ length: size }, (_, i) => Math.sin(i * 0.7) + 0.3 * Math.cos(i * 2.1))
    re.set(x)
    fft(re, im, size)
    for (let k = 0; k < size; k++) {
      let sr = 0
      let si = 0
      for (let n = 0; n < size; n++) {
        sr += x[n] * Math.cos((2 * Math.PI * k * n) / size)
        si -= x[n] * Math.sin((2 * Math.PI * k * n) / size)
      }
      expect(re[k]).toBeCloseTo(sr, 9)
      expect(im[k]).toBeCloseTo(si, 9)
    }
  })
})

describe('isOnlyHiss', () => {
  it('flags the hiss that BirdNET reads as a woodpecker: white noise, 16-bit rounding noise, a slope of -1 dB per octave', () => {
    expect(isOnlyHiss(hiss(0), RATE)).toBe(true)
    expect(isOnlyHiss(hiss(-1), RATE)).toBe(true)
    const next = gaussian(7)
    const rounding = new Float32Array(WINDOW)
    for (let i = 0; i < WINDOW; i++) rounding[i] = Math.round(next()) / 32768 // about one step of a 16-bit microphone
    expect(isOnlyHiss(rounding, RATE)).toBe(true)
  })

  it('lets noise through that slopes steeply (hum, rumble, wind), where BirdNET finds nothing anyway', () => {
    expect(isOnlyHiss(hiss(-3), RATE)).toBe(false)
  })

  it('does not flag digital silence', () => {
    expect(isOnlyHiss(new Float32Array(WINDOW), RATE)).toBe(false)
  })

  it('never flags a real recording: every window of the field soundscape and the redpoll clip', () => {
    for (const file of ['soundscape-24s.wav', 'birdnet-demo-sample.wav']) {
      const wav = decodeWav(new Uint8Array(readFileSync(`tests/fixtures/audio/${file}`)))
      expect(wav.sampleRate).toBe(RATE)
      for (let start = 0; start + WINDOW <= wav.samples.length; start += RATE) {
        const window = wav.samples.subarray(start, start + WINDOW)
        expect(spectralFlatness(window, RATE), `${file} at ${start / RATE} s`).toBeLessThan(FLAT_LIMIT - 0.1)
      }
    }
  })

  it('takes the limit as an argument', () => {
    expect(isOnlyHiss(hiss(-3), RATE, 0.5)).toBe(true)
    expect(isOnlyHiss(hiss(0), RATE, Infinity)).toBe(false)
  })
})
