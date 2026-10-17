// The WingCLIP species classifier: text_classifier_int8.bin, and the maths on it.
//
// Layout (from WingDex): n rows of 768 int8 values, then n float32 scales, one per row. Row r is q[r] * scale[r]. The first
// n - 1 rows are species (10994 of them) in the order of WingDex's taxonomy; the last row is not a species but the weights
// of the bird / not-bird probe. The rows are unit vectors (before quantising), so a dot product with the L2-normalised image
// embedding is a cosine similarity.
//
// The matrix stays in int8 (8 MB) and is never expanded to float32 (34 MB): a row's similarity is its scale times the sum of
// q * embedding. Pure functions, no DOM: they run in the worker and in unit tests.

import { WINGCLIP } from './constants'

export interface Classifier {
  /** Number of species rows (the probe row is not counted). */
  readonly rows: number
  /** The int8 matrix, rows x 768, species rows only. */
  readonly q: Int8Array
  /** One scale per species row. */
  readonly scales: Float32Array
  /** The dequantised probe row. */
  readonly probe: Float32Array
}

export class ClassifierFormatError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ClassifierFormatError'
  }
}

/**
 * Reads text_classifier_int8.bin. `expectedSpeciesRows` guards against an old or wrong file: a classifier with another number
 * of rows would silently shift every species and hand its last species row to the probe.
 */
export function decodeClassifier(bytes: Uint8Array, expectedSpeciesRows?: number, dim: number = WINGCLIP.embeddingSize): Classifier {
  const rowBytes = dim + 4
  const total = Math.floor(bytes.byteLength / rowBytes)
  if (total < 2 || total * rowBytes !== bytes.byteLength) {
    throw new ClassifierFormatError(`The classifier is ${bytes.byteLength} bytes, not a whole number of ${rowBytes}-byte rows`)
  }
  const rows = total - 1
  if (expectedSpeciesRows !== undefined && rows !== expectedSpeciesRows) {
    throw new ClassifierFormatError(`The classifier has ${rows} species rows, ${expectedSpeciesRows} were expected`)
  }
  // The scales start at total * dim, a multiple of 4. A view needs the file itself to start at a multiple of 4 as well.
  const scaleStart = bytes.byteOffset + total * dim
  const all =
    scaleStart % 4 === 0
      ? new Float32Array(bytes.buffer, scaleStart, total)
      : new Float32Array(bytes.buffer.slice(scaleStart, scaleStart + total * 4))
  const q = new Int8Array(bytes.buffer, bytes.byteOffset, rows * dim)
  const probeRow = new Int8Array(bytes.buffer, bytes.byteOffset + rows * dim, dim)
  const probeScale = all[rows]
  const probe = new Float32Array(dim)
  for (let i = 0; i < dim; i++) probe[i] = probeRow[i] * probeScale
  return { rows, q, scales: all.subarray(0, rows), probe }
}

/** Length of a vector, or 1 for the zero vector (so a dead embedding gives zeros, not NaN). */
export function norm(vector: Float32Array): number {
  let sum = 0
  for (let i = 0; i < vector.length; i++) sum += vector[i] * vector[i]
  return Math.sqrt(sum) || 1
}

/** Cosine similarity of the embedding with every species row. `out` may be reused between calls. */
export function similarities(classifier: Classifier, embedding: Float32Array, out?: Float32Array, dim: number = WINGCLIP.embeddingSize): Float32Array {
  const { rows, q, scales } = classifier
  const result = out && out.length === rows ? out : new Float32Array(rows)
  const inverseNorm = 1 / norm(embedding)
  // Four accumulators so the JIT does not wait on a single one (the idea, and the measurement, are WingDex's).
  const tail = dim % 4
  const main = dim - tail
  for (let r = 0; r < rows; r++) {
    const base = r * dim
    let a = 0
    let b = 0
    let c = 0
    let d = 0
    let i = 0
    for (; i < main; i += 4) {
      a += q[base + i] * embedding[i]
      b += q[base + i + 1] * embedding[i + 1]
      c += q[base + i + 2] * embedding[i + 2]
      d += q[base + i + 3] * embedding[i + 3]
    }
    for (; i < dim; i++) a += q[base + i] * embedding[i]
    result[r] = (a + b + c + d) * scales[r] * inverseNorm
  }
  return result
}

/** The probe's raw output on the normalised embedding: probe . embedding (before bias and sigmoid). */
export function probeDot(classifier: Classifier, embedding: Float32Array): number {
  const { probe } = classifier
  let sum = 0
  for (let i = 0; i < probe.length; i++) sum += probe[i] * embedding[i]
  return sum / norm(embedding)
}
