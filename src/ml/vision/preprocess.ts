// CLIP preprocessing for WingCLIP: shorter side to 248 (bicubic), centre crop 224, CLIP mean and std, NCHW float32.
//
// The recipe and the reasons behind it (248 and not 224, floor for the resize, half-to-even for the crop, Pillow and not
// the canvas for resampling) come from WingDex, MIT licensed, https://github.com/jlian/wingdex (src/lib/clip-preprocess.ts).
// This is a fresh implementation. WingDex resamples in floating point; the model was calibrated on timm's Pillow
// pipeline, and WingDex's own golden vectors show that its floating point version differs from Pillow by one grey level
// in about 13 percent of the values. This module ports Pillow's 8-bit resampler instead (fixed point coefficients and an
// 8-bit intermediate image, as in Pillow's Resample.c), so the result is identical to Pillow, bit for bit, and the
// normalisation repeats torch's float32 arithmetic through a lookup table. It also only computes the pixels that
// survive the crop, and keeps the intermediate image in bytes, which makes it several times faster.
//
// Pure functions, no DOM: they run in the worker, on the main thread and in unit tests.

export const CLIP_MEAN = [0.48145466, 0.4578275, 0.40821073] as const
export const CLIP_STD = [0.26862954, 0.26130258, 0.27577711] as const
/** The checkpoint's timm config resizes the shorter side to 248, not 224. See the WingDex file for the measurements. */
export const CLIP_RESIZE = 248
/** Centre crop, and the width and height of the model input. */
export const CLIP_CROP = 224

/** Pillow's fixed point precision for 8-bit images (PRECISION_BITS = 32 - 8 - 2). */
const PRECISION_BITS = 22
const FIXED_ONE = 1 << PRECISION_BITS
const ROUNDING = 1 << (PRECISION_BITS - 1)

export interface PixelImage {
  /** Packed pixels, row by row: RGB (3 channels) or RGBA (4 channels, what a canvas gives). Alpha is ignored. */
  data: ArrayLike<number>
  width: number
  height: number
  /** Bytes per pixel in `data`. Default 3. */
  channels?: 3 | 4
}

// ---------- Sizes ----------

/** torchvision's Resize(size) for one number: the shorter side becomes `size`, the other is floored (not rounded). */
export function resizedSize(width: number, height: number, size: number): { width: number; height: number } {
  if (width <= height) return { width: size, height: Math.floor((size * height) / width) }
  return { width: Math.floor((size * width) / height), height: size }
}

/** Python's round(): halves go to the even number (52.5 gives 52, 53.5 gives 54), unlike Math.round. */
export function bankersRound(value: number): number {
  const floor = Math.floor(value)
  const rest = value - floor
  if (rest > 0.5) return floor + 1
  if (rest < 0.5) return floor
  return floor % 2 === 0 ? floor : floor + 1
}

/** torchvision's CenterCrop: where the crop starts inside the resized image. */
export function cropOffset(resized: number, crop: number): number {
  return bankersRound((resized - crop) / 2)
}

// ---------- Pillow's resampler ----------

/** Pillow's bicubic filter (a = -0.5). The order of the operations is Pillow's, so the doubles come out the same. */
function bicubic(x: number): number {
  const a = -0.5
  if (x < 0) x = -x
  if (x < 1) return ((a + 2) * x - (a + 3)) * x * x + 1
  if (x < 2) return (((x - 5) * x + 8) * x - 4) * a
  return 0
}

/** For a run of output positions: which source positions feed each, with Pillow's fixed point weights. */
export interface Taps {
  /** First source position of each output position. */
  starts: Int32Array
  /** How many source positions each output position uses. */
  counts: Int32Array
  /** `ksize` fixed point weights for each output position. */
  weights: Int32Array
  ksize: number
}

/**
 * Pillow's precompute_coeffs and normalize_coeffs_8bpc for the output positions first..first+count-1 of an axis that is
 * resized from `inSize` to `outSize`. The positions are independent of each other, so asking for only the part that
 * the crop keeps gives the same numbers as computing all of them.
 */
export function computeTaps(inSize: number, outSize: number, first: number, count: number): Taps {
  const scale = inSize / outSize
  const filterScale = scale < 1 ? 1 : scale
  const support = 2 * filterScale
  const ksize = Math.ceil(support) * 2 + 1
  const starts = new Int32Array(count)
  const counts = new Int32Array(count)
  const weights = new Int32Array(count * ksize)
  const real = new Float64Array(ksize)
  const stretch = 1 / filterScale
  for (let i = 0; i < count; i++) {
    const center = (first + i + 0.5) * scale
    let start = Math.trunc(center - support + 0.5)
    if (start < 0) start = 0
    let end = Math.trunc(center + support + 0.5)
    if (end > inSize) end = inSize
    const used = end - start
    let total = 0
    for (let x = 0; x < used; x++) {
      const w = bicubic((x + start - center + 0.5) * stretch)
      real[x] = w
      total += w
    }
    const base = i * ksize
    for (let x = 0; x < used; x++) {
      const w = total !== 0 ? real[x] / total : real[x]
      weights[base + x] = w < 0 ? Math.trunc(-0.5 + w * FIXED_ONE) : Math.trunc(0.5 + w * FIXED_ONE)
    }
    starts[i] = start
    counts[i] = used
  }
  return { starts, counts, weights, ksize }
}

/** Horizontal pass over the source rows rowStart..rowEnd-1, for the output columns in `taps`. Result: RGB bytes. */
function resampleRows(src: ArrayLike<number>, srcWidth: number, channels: number, rowStart: number, rowEnd: number, taps: Taps): Uint8Array {
  const outWidth = taps.starts.length
  const rows = rowEnd - rowStart
  const out = new Uint8Array(rows * outWidth * 3)
  const { starts, counts, weights, ksize } = taps
  let o = 0
  for (let y = 0; y < rows; y++) {
    const rowBase = (rowStart + y) * srcWidth * channels
    for (let d = 0; d < outWidth; d++) {
      const n = counts[d]
      const wBase = d * ksize
      let p = rowBase + starts[d] * channels
      let r = ROUNDING
      let g = ROUNDING
      let b = ROUNDING
      for (let t = 0; t < n; t++, p += channels) {
        const w = weights[wBase + t]
        r += src[p] * w
        g += src[p + 1] * w
        b += src[p + 2] * w
      }
      r >>= PRECISION_BITS
      g >>= PRECISION_BITS
      b >>= PRECISION_BITS
      out[o++] = r < 0 ? 0 : r > 255 ? 255 : r
      out[o++] = g < 0 ? 0 : g > 255 ? 255 : g
      out[o++] = b < 0 ? 0 : b > 255 ? 255 : b
    }
  }
  return out
}

/** Vertical pass: `rows` is the result of resampleRows (its first row is source row `rowStart`), `taps` the output rows. */
function resampleColumns(rows: Uint8Array, width: number, rowStart: number, taps: Taps): Uint8Array {
  const outHeight = taps.starts.length
  const out = new Uint8Array(outHeight * width * 3)
  const { starts, counts, weights, ksize } = taps
  const stride = width * 3
  let o = 0
  for (let y = 0; y < outHeight; y++) {
    const n = counts[y]
    const wBase = y * ksize
    const first = (starts[y] - rowStart) * stride
    for (let x = 0; x < stride; x += 3) {
      let r = ROUNDING
      let g = ROUNDING
      let b = ROUNDING
      let p = first + x
      for (let t = 0; t < n; t++, p += stride) {
        const w = weights[wBase + t]
        r += rows[p] * w
        g += rows[p + 1] * w
        b += rows[p + 2] * w
      }
      r >>= PRECISION_BITS
      g >>= PRECISION_BITS
      b >>= PRECISION_BITS
      out[o++] = r < 0 ? 0 : r > 255 ? 255 : r
      out[o++] = g < 0 ? 0 : g > 255 ? 255 : g
      out[o++] = b < 0 ? 0 : b > 255 ? 255 : b
    }
  }
  return out
}

/**
 * Resizes the shorter side to `resize` (bicubic, like Pillow) and cuts out the centre `crop` x `crop` square.
 * Returns RGB bytes, row by row: exactly what PIL's `Resize(resize, BICUBIC)` then `CenterCrop(crop)` gives.
 */
export function resizeAndCrop(image: PixelImage, resize = CLIP_RESIZE, crop = CLIP_CROP): Uint8Array {
  const { width, height, data } = image
  const channels = image.channels ?? 3
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new RangeError(`The picture has an impossible size: ${width} x ${height}`)
  }
  if (data.length < width * height * channels) throw new RangeError('The picture has fewer pixels than its size says')
  if (resize < crop) throw new RangeError('The resize target must not be smaller than the crop')
  const resized = resizedSize(width, height, resize)
  const left = cropOffset(resized.width, crop)
  const top = cropOffset(resized.height, crop)

  const columns = computeTaps(width, resized.width, left, crop)
  const lines = computeTaps(height, resized.height, top, crop)
  // Only the source rows that the kept output rows touch are needed.
  let rowStart = height
  let rowEnd = 0
  for (let i = 0; i < crop; i++) {
    if (lines.starts[i] < rowStart) rowStart = lines.starts[i]
    const last = lines.starts[i] + lines.counts[i]
    if (last > rowEnd) rowEnd = last
  }
  const wide = resampleRows(data, width, channels, rowStart, rowEnd, columns)
  return resampleColumns(wide, crop, rowStart, lines)
}

// ---------- Normalisation ----------

/** torch's float32 arithmetic for one value: ((v / 255) - mean) / std, each step rounded to float32. */
function buildLookup(channel: 0 | 1 | 2): Float32Array {
  const table = new Float32Array(256)
  const mean = Math.fround(CLIP_MEAN[channel])
  const std = Math.fround(CLIP_STD[channel])
  for (let v = 0; v < 256; v++) table[v] = Math.fround(Math.fround(Math.fround(v / 255) - mean) / std)
  return table
}

const LOOKUPS = [buildLookup(0), buildLookup(1), buildLookup(2)] as const

/** RGB bytes (row by row) to the model's NCHW float32 tensor: 3 x crop x crop values, one colour after the other. */
export function normalize(rgb: Uint8Array, crop = CLIP_CROP): Float32Array {
  const plane = crop * crop
  const out = new Float32Array(3 * plane)
  const [lr, lg, lb] = LOOKUPS
  for (let i = 0, p = 0; i < plane; i++, p += 3) {
    out[i] = lr[rgb[p]]
    out[plane + i] = lg[rgb[p + 1]]
    out[2 * plane + i] = lb[rgb[p + 2]]
  }
  return out
}

/** Standard deviation of the brightness (0 to 255) of RGB bytes. A flat picture, for example a covered lens, has none. */
export function brightnessSpread(rgb: Uint8Array): number {
  const pixels = Math.floor(rgb.length / 3)
  if (pixels === 0) return 0
  let sum = 0
  let sumSquares = 0
  for (let p = 0; p < rgb.length; p += 3) {
    const v = (rgb[p] + rgb[p + 1] + rgb[p + 2]) / 3
    sum += v
    sumSquares += v * v
  }
  const mean = sum / pixels
  return Math.sqrt(Math.max(0, sumSquares / pixels - mean * mean))
}

export interface Preprocessed {
  /** [1, 3, 224, 224] float32, ready for the model. */
  tensor: Float32Array
  /** Spread of the brightness in the crop, 0 to 255. Tiny means a blank picture. */
  spread: number
}

/** The whole preprocessing, with the brightness spread of the crop as a by-product (the engine uses it to spot blank frames). */
export function preprocessWithStats(image: PixelImage, resize = CLIP_RESIZE, crop = CLIP_CROP): Preprocessed {
  const rgb = resizeAndCrop(image, resize, crop)
  return { tensor: normalize(rgb, crop), spread: brightnessSpread(rgb) }
}

/** The tensor alone: `[1, 3, crop, crop]` as one Float32Array. */
export function preprocess(image: PixelImage, resize = CLIP_RESIZE, crop = CLIP_CROP): Float32Array {
  return normalize(resizeAndCrop(image, resize, crop), crop)
}
