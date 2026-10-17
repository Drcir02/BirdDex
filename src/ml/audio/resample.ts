// High-quality sample rate conversion to the 48 kHz that BirdNET needs.
//
// Almost every phone already delivers 48 kHz (the audio context is created at that rate, so the browser does the
// conversion). This is the safety net for phones that hand us 44.1 kHz, 16 kHz, 96 kHz or something else, and it is
// also what the tests use to prove that conversion keeps bird sounds intact.
//
// Method: windowed-sinc interpolation. Every output sample is a weighted sum of the input samples around its exact
// position; the weights are a low-pass filter (Kaiser window, 16 zero crossings on each side) whose cutoff sits just
// below the lower of the two Nyquist frequencies, so converting down does not fold high tones back into the band.
// The weights for 512 fractional positions are computed once and interpolated linearly.
//
// It works on a stream: feed blocks of any size to process(), call flush() at the end. The output does not depend on
// how the input was cut into blocks.

export const TARGET_SAMPLE_RATE = 48000

/** Zero crossings of the low-pass filter on each side of the output position. More is sharper and slower. */
const ZERO_CROSSINGS = 16
/** The filter passes up to this fraction of the lower Nyquist frequency (about 21 kHz when converting 44.1 kHz). */
const CUTOFF = 0.95
/** Fractional positions in the weight table. */
const PHASES = 512
/** Kaiser window shape: about 90 dB of attenuation outside the pass band. */
const KAISER_BETA = 9

/** Modified Bessel function of the first kind, order 0 (power series). */
function besselI0(x: number): number {
  let sum = 1
  let term = 1
  const quarter = (x * x) / 4
  for (let k = 1; k < 60; k++) {
    term *= quarter / (k * k)
    sum += term
    if (term < sum * 1e-17) break
  }
  return sum
}

const sinc = (x: number) => (x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x))

interface Kernel {
  /** Taps on each side of the output position. */
  half: number
  /** (PHASES + 1) rows of 2 * half weights. */
  table: Float32Array
}

const kernelCache = new Map<string, Kernel>()

function kernelFor(inRate: number, outRate: number): Kernel {
  const key = `${inRate}>${outRate}`
  const cached = kernelCache.get(key)
  if (cached) return cached

  const scale = Math.min(1, outRate / inRate) * CUTOFF
  const width = ZERO_CROSSINGS / scale // half width of the filter in input samples
  const half = Math.ceil(width)
  const taps = 2 * half
  const table = new Float32Array((PHASES + 1) * taps)
  const norm = 1 / besselI0(KAISER_BETA)
  const row = new Float64Array(taps)

  for (let phase = 0; phase <= PHASES; phase++) {
    const fraction = phase / PHASES
    let sum = 0
    for (let tap = 0; tap < taps; tap++) {
      // Distance in input samples between the output position and this tap.
      const distance = fraction + half - 1 - tap
      const ratio = distance / width
      const window = Math.abs(ratio) < 1 ? besselI0(KAISER_BETA * Math.sqrt(1 - ratio * ratio)) * norm : 0
      row[tap] = scale * sinc(scale * distance) * window
      sum += row[tap]
    }
    // Every row adds up to exactly one, so a constant (DC) input comes out unchanged at every position.
    for (let tap = 0; tap < taps; tap++) table[phase * taps + tap] = row[tap] / sum
  }
  const kernel = { half, table }
  kernelCache.set(key, kernel)
  return kernel
}

function assertRate(rate: number, what: string): void {
  if (!Number.isFinite(rate) || rate < 1000 || rate > 768000) throw new RangeError(`Unusable ${what} sample rate: ${rate}`)
}

export class Resampler {
  readonly inRate: number
  readonly outRate: number
  private readonly ratio: number
  private readonly kernel: Kernel | undefined
  /** Input waiting to be used, starting at absolute input index `bufferStart` (it begins with zeros before the first sample). */
  private buffer: Float32Array
  private bufferStart: number
  private totalIn = 0
  private nextOut = 0

  constructor(inRate: number, outRate: number = TARGET_SAMPLE_RATE) {
    assertRate(inRate, 'input')
    assertRate(outRate, 'output')
    this.inRate = inRate
    this.outRate = outRate
    this.ratio = inRate / outRate
    this.kernel = inRate === outRate ? undefined : kernelFor(inRate, outRate)
    const lead = this.kernel ? this.kernel.half - 1 : 0
    this.buffer = new Float32Array(lead)
    this.bufferStart = -lead
  }

  /** Converts a block. The result can be shorter or longer than expected: the filter needs samples from both sides. */
  process(input: Float32Array): Float32Array {
    if (!this.kernel) {
      this.totalIn += input.length
      this.nextOut += input.length
      return input.slice()
    }
    this.append(input)
    this.totalIn += input.length
    return this.produce(Number.POSITIVE_INFINITY)
  }

  /** Converts the last samples (the filter sees silence after the end). Call once, when the input is over. */
  flush(): Float32Array {
    if (!this.kernel) return new Float32Array(0)
    this.append(new Float32Array(this.kernel.half))
    const totalOut = Math.floor((this.totalIn * this.outRate) / this.inRate + 1e-6)
    return this.produce(totalOut)
  }

  private append(input: Float32Array): void {
    if (input.length === 0) return
    const joined = new Float32Array(this.buffer.length + input.length)
    joined.set(this.buffer)
    joined.set(input, this.buffer.length)
    this.buffer = joined
  }

  private produce(limit: number): Float32Array {
    const { half, table } = this.kernel as Kernel
    const taps = 2 * half
    const bufferEnd = this.bufferStart + this.buffer.length // one past the last absolute index we hold
    // Upper bound for the number of outputs we can make, to allocate once.
    const room = Math.max(0, Math.min(limit - this.nextOut, Math.floor((bufferEnd - half) / this.ratio) + 2 - this.nextOut))
    const out = new Float32Array(room)
    let count = 0
    while (count < room) {
      const position = this.nextOut * this.ratio
      const base = Math.floor(position)
      if (base + half >= bufferEnd) break // the right side of the filter is not here yet
      const phasePosition = (position - base) * PHASES
      const phase = Math.min(PHASES - 1, Math.floor(phasePosition))
      const blend = phasePosition - phase
      const first = phase * taps
      const second = first + taps
      const start = base - half + 1 - this.bufferStart
      let a = 0
      let b = 0
      for (let tap = 0; tap < taps; tap++) {
        const sample = this.buffer[start + tap]
        a += table[first + tap] * sample
        b += table[second + tap] * sample
      }
      out[count++] = a + blend * (b - a)
      this.nextOut++
    }

    // Forget the input that no later output can reach.
    const keepFrom = Math.floor(this.nextOut * this.ratio) - half + 1
    const drop = Math.min(keepFrom - this.bufferStart, this.buffer.length)
    if (drop >= 4096 || (drop > 0 && drop > this.buffer.length / 2)) {
      this.buffer = this.buffer.slice(drop)
      this.bufferStart += drop
    }
    return count === room ? out : out.slice(0, count)
  }
}

/** Converts a whole recording. */
export function resample(input: Float32Array, inRate: number, outRate: number = TARGET_SAMPLE_RATE): Float32Array {
  if (inRate === outRate) return input.slice()
  const resampler = new Resampler(inRate, outRate)
  const body = resampler.process(input)
  const tail = resampler.flush()
  const joined = new Float32Array(body.length + tail.length)
  joined.set(body)
  joined.set(tail, body.length)
  return joined
}

/** Converts a recording to the 48 kHz mono BirdNET expects (mono in, mono out). */
export function resampleTo48k(input: Float32Array, inRate: number): Float32Array {
  return resample(input, inRate, TARGET_SAMPLE_RATE)
}
