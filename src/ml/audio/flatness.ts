// Is a stretch of audio only hiss? A cheap check on the spectrum, run on every 3 second window before BirdNET sees it.
//
// Why: BirdNET reads perfectly flat noise (a synthetic hiss, or digital silence with a little rounding noise) as a Lesser
// Spotted Woodpecker with a score of 0.51 to 0.58, window after window, at any loudness. That is the same band as a real bird
// heard faintly, so no score threshold can tell them apart. A real recording is never flat: wind, traffic and every bird
// make the spectrum lumpy or sloping. Measured (docs/notes/sound-engine.md, section 7):
//   white noise 0.996, slope -1 dB per octave 0.976, -1.5 dB 0.951 (these give the woodpecker, 0.55 and below),
//   -2 dB 0.916, -3 dB 0.82 (the woodpecker is gone by then), real field recordings 0.07 to 0.73.
// So a window above FLAT_LIMIT is treated as "nothing to hear" and not analysed.
//
// Spectral flatness = geometric mean / arithmetic mean of the power spectrum, 1 for a flat spectrum and close to 0 for a
// few strong peaks. The spectrum is the average of many short Hann-windowed FFTs (Welch), because a single FFT of noise is
// itself lumpy (its flatness is only 0.56); averaged over 140 frames the estimate of a flat hiss is 0.99.

/** Windows flatter than this are only hiss. See the measurements above. */
export const FLAT_LIMIT = 0.95

export const FLATNESS_FFT_SIZE = 2048
/** The band that is looked at. Below 2 kHz hum, rumble and wind slope the spectrum; above 20 kHz microphones and resamplers cut it off. */
export const FLATNESS_LOW_HZ = 2000
export const FLATNESS_HIGH_HZ = 20000

const tableCache = new Map<number, { cos: Float64Array; sin: Float64Array; reverse: Uint32Array; hann: Float64Array }>()

function tables(size: number) {
  let found = tableCache.get(size)
  if (!found) {
    const cos = new Float64Array(size / 2)
    const sin = new Float64Array(size / 2)
    for (let i = 0; i < size / 2; i++) {
      cos[i] = Math.cos((2 * Math.PI * i) / size)
      sin[i] = -Math.sin((2 * Math.PI * i) / size)
    }
    const bits = Math.log2(size)
    const reverse = new Uint32Array(size)
    for (let i = 0; i < size; i++) {
      let r = 0
      for (let b = 0; b < bits; b++) if (i & (1 << b)) r |= 1 << (bits - 1 - b)
      reverse[i] = r
    }
    const hann = new Float64Array(size)
    for (let i = 0; i < size; i++) hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size)
    found = { cos, sin, reverse, hann }
    tableCache.set(size, found)
  }
  return found
}

/** In-place radix-2 FFT of a real signal given in `re` (imaginary part `im` must be zero on entry). */
export function fft(re: Float64Array, im: Float64Array, size: number): void {
  const { cos, sin, reverse } = tables(size)
  for (let i = 0; i < size; i++) {
    const j = reverse[i]
    if (j > i) {
      const t = re[i]
      re[i] = re[j]
      re[j] = t
    }
  }
  for (let half = 1; half < size; half <<= 1) {
    const step = size / (half * 2)
    for (let start = 0; start < size; start += half * 2) {
      for (let k = 0; k < half; k++) {
        const wr = cos[k * step]
        const wi = sin[k * step]
        const a = start + k
        const b = a + half
        const tr = re[b] * wr - im[b] * wi
        const ti = re[b] * wi + im[b] * wr
        re[b] = re[a] - tr
        im[b] = im[a] - ti
        re[a] += tr
        im[a] += ti
      }
    }
  }
}

export interface FlatnessOptions {
  fftSize?: number
  lowHz?: number
  highHz?: number
}

/**
 * Spectral flatness of the samples between lowHz and highHz, from 0 (peaks) to 1 (flat). Audio that cannot be judged counts
 * as 0 (not flat): shorter than one FFT frame, or digital silence (exact zeros), which BirdNET scores as nothing anyway.
 */
export function spectralFlatness(samples: Float32Array, sampleRate: number, options: FlatnessOptions = {}): number {
  const size = options.fftSize ?? FLATNESS_FFT_SIZE
  if (!Number.isInteger(Math.log2(size))) throw new RangeError('The FFT size has to be a power of two')
  const hop = size / 2
  if (samples.length < size) return 0
  const binHz = sampleRate / size
  const lowBin = Math.max(1, Math.ceil((options.lowHz ?? FLATNESS_LOW_HZ) / binHz))
  const highBin = Math.min(size / 2, Math.floor((options.highHz ?? FLATNESS_HIGH_HZ) / binHz))
  if (highBin <= lowBin) return 0

  const { hann } = tables(size)
  const re = new Float64Array(size)
  const im = new Float64Array(size)
  const power = new Float64Array(highBin - lowBin + 1)
  let frames = 0
  for (let at = 0; at + size <= samples.length; at += hop) {
    for (let i = 0; i < size; i++) {
      re[i] = samples[at + i] * hann[i]
      im[i] = 0
    }
    fft(re, im, size)
    for (let bin = lowBin; bin <= highBin; bin++) power[bin - lowBin] += re[bin] * re[bin] + im[bin] * im[bin]
    frames++
  }

  let sum = 0
  let sumLog = 0
  for (let i = 0; i < power.length; i++) {
    const p = power[i] / frames
    sum += p
    sumLog += Math.log(p + 1e-30)
  }
  const mean = sum / power.length
  // Digital silence: nothing to judge, and BirdNET hears nothing in it.
  if (!(mean > 1e-12)) return 0
  return Math.min(1, Math.exp(sumLog / power.length) / mean)
}

/** True when the window is only hiss and BirdNET should not be asked about it. */
export function isOnlyHiss(samples: Float32Array, sampleRate: number, limit: number = FLAT_LIMIT): boolean {
  return spectralFlatness(samples, sampleRate) >= limit
}
