// The list of model files, models/manifest.json (version 2), written by scripts/fetch-models.mjs.
//
//   { version: 2,
//     files: [{ id, file, bytes, sha256, label }],                  every file the app can download
//     benchmarks: [{ id, label, runtime, file, input, externalData? }] what the Field check times }
//
// `file` is a file name inside the models/ folder. `externalData` lists extra files the model needs next to it
// (the WingCLIP graph keeps its weights in a separate .data file).

import { ModelDownloadError } from './modelErrors'

export const MANIFEST_VERSION = 2

export interface ModelFile {
  /** Stable id that code uses to ask for the file, for example "birdnet-fp16". */
  id: string
  /** File name inside the models/ folder. */
  file: string
  bytes: number
  /** Lower-case hex SHA-256 of the file. */
  sha256: string
  /** A short name for logs and the Field check. Screens use their own Czech texts keyed by `id`. */
  label: string
}

export interface ModelBenchmark {
  id: string
  label: string
  runtime: 'litert' | 'ort'
  /** File name inside the models/ folder. */
  file: string
  input: { shape: number[]; dtype: 'float32' }
  /** Extra files (names inside the models/ folder) that must be handed to the runtime together with the model. */
  externalData?: string[]
}

export interface ModelManifest {
  version: typeof MANIFEST_VERSION
  files: ModelFile[]
  benchmarks: ModelBenchmark[]
}

const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const SHA256 = /^[0-9a-f]{64}$/

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

function bad(message: string): never {
  throw new ModelDownloadError(`The model list is not usable: ${message}`, { reason: 'manifest' })
}

function parseFile(value: unknown, index: number): ModelFile {
  const where = `files[${index}]`
  if (!isRecord(value)) return bad(`${where} is not an object`)
  const { id, file, bytes, sha256, label } = value
  if (typeof id !== 'string' || id === '') return bad(`${where}.id`)
  if (typeof file !== 'string' || !SAFE_NAME.test(file)) return bad(`${where}.file must be a plain file name`)
  if (typeof bytes !== 'number' || !Number.isInteger(bytes) || bytes <= 0) return bad(`${where}.bytes`)
  if (typeof sha256 !== 'string' || !SHA256.test(sha256)) return bad(`${where}.sha256 must be 64 lower-case hex digits`)
  return { id, file, bytes, sha256, label: typeof label === 'string' ? label : id }
}

/** Benchmarks only feed the Field check, so a broken entry is dropped instead of making the whole list unusable. */
function parseBenchmark(value: unknown): ModelBenchmark | undefined {
  if (!isRecord(value)) return undefined
  const { id, label, runtime, file, input, externalData } = value
  if (typeof id !== 'string' || typeof file !== 'string' || !SAFE_NAME.test(file)) return undefined
  if (runtime !== 'litert' && runtime !== 'ort') return undefined
  if (!isRecord(input) || input.dtype !== 'float32' || !Array.isArray(input.shape)) return undefined
  const shape = input.shape
  if (shape.length === 0 || !shape.every((n) => typeof n === 'number' && Number.isInteger(n) && n > 0)) return undefined
  const benchmark: ModelBenchmark = {
    id,
    label: typeof label === 'string' ? label : id,
    runtime,
    file,
    input: { shape: [...(shape as number[])], dtype: 'float32' },
  }
  if (Array.isArray(externalData)) {
    const names = externalData.filter((name): name is string => typeof name === 'string' && SAFE_NAME.test(name))
    if (names.length > 0) benchmark.externalData = names
  }
  return benchmark
}

/** Checks a parsed manifest.json and returns it in a clean shape. Throws ModelDownloadError (reason 'manifest') otherwise. */
export function parseManifest(json: unknown): ModelManifest {
  if (!isRecord(json)) return bad('it is not an object')
  if (json.version !== MANIFEST_VERSION) return bad(`expected version ${MANIFEST_VERSION}, found ${String(json.version)}`)
  if (!Array.isArray(json.files)) return bad('"files" is missing')
  const files = json.files.map(parseFile)
  const ids = new Set<string>()
  for (const file of files) {
    if (ids.has(file.id)) return bad(`the id "${file.id}" appears twice`)
    ids.add(file.id)
  }
  const benchmarks = (Array.isArray(json.benchmarks) ? json.benchmarks : [])
    .map(parseBenchmark)
    .filter((benchmark): benchmark is ModelBenchmark => benchmark !== undefined)
  return { version: MANIFEST_VERSION, files, benchmarks }
}
