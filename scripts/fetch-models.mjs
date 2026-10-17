// Gets the bird models into public/models/ and writes public/models/manifest.json (version 2).
// The models are big and have their own licences, so they are not stored in git. CI and developers run this.
//
//   node scripts/fetch-models.mjs               check what is on disk, download what is missing or wrong
//   node scripts/fetch-models.mjs --force       download everything again
//   node scripts/fetch-models.mjs --with-fp32   also get the big FP32 BirdNET model that only the tests use
//   node scripts/fetch-models.mjs --strict      exit with an error when any model is missing (default: only when none is)
//   node scripts/fetch-models.mjs --config my-sources.json --out some/dir   (used by the tests)
//
// Files that are already on disk with the right size and SHA-256 are kept and not downloaded again, so this works
// on a machine that cannot reach the internet but already has the files. Downloads go to a temporary ".part" file
// and replace the real file only after the size and checksum are right.
//
// manifest.json is what the app reads (src/ml/runtime/modelStore.ts):
//   { version: 2,
//     files:      [{ id, file, bytes, sha256, label }],                          every model file the app can download
//     benchmarks: [{ id, label, runtime: 'litert'|'ort', file, input, externalData? }] what the Field check times }
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const flag = (name) => args.includes(name)
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined)

const outDir = option('--out') ?? join(root, 'public', 'models')
const force = flag('--force')
const strict = flag('--strict')
const withFp32 = flag('--with-fp32')
const retryDelayMs = Number(process.env.FETCH_MODELS_RETRY_MS ?? 2000)
const MAX_ATTEMPTS = 3

// Pinned to exact releases and commits, so the files cannot change under us.
const BIRDNET = 'https://github.com/birdnet-team/BirdNET-Analyzer/raw/v1.5.1/birdnet_analyzer/checkpoints/V2.4/'
const WINGCLIP = 'https://github.com/jlian/wingdex/raw/b0dda4b7cb77d86f918c1a75ad662b0f462bb0b2/public/models/'

const DEFAULT_CONFIG = {
  files: [
    {
      id: 'birdnet-fp16',
      label: 'BirdNET V2.4 (sound, FP16)',
      file: 'birdnet-v2.4-fp16.tflite',
      url: `${BIRDNET}BirdNET_GLOBAL_6K_V2.4_Model_FP16.tflite`,
      bytes: 25932528,
      sha256: '5c64ba3ffab264ccbfafe784896392051a86be63b0cc507e7683db7df114546b',
    },
    {
      id: 'birdnet-geo-fp16',
      label: 'BirdNET V2.4 (location filter, FP16)',
      file: 'birdnet-v2.4-geo-fp16.tflite',
      url: `${BIRDNET}BirdNET_GLOBAL_6K_V2.4_MData_Model_V2_FP16.tflite`,
      bytes: 14770468,
      sha256: '1226f23fc20362617deb09178f366111b70cf085c2c82893f2814e5acedce6c2',
    },
    {
      id: 'wingclip-onnx',
      label: 'WingCLIP (photo, graph, int8)',
      file: 'wingclip_visual_int8.onnx',
      url: `${WINGCLIP}wingclip_visual_int8.onnx`,
      bytes: 14386564,
      sha256: '4d9ddfad519b6e80f0c5820d7d89051a55cdf9cb4b59ab8bbfe0a9fcc9dc4d59',
    },
    {
      id: 'wingclip-data',
      label: 'WingCLIP (photo, weights, int8)',
      file: 'wingclip_visual_int8.data',
      url: `${WINGCLIP}wingclip_visual_int8.data`,
      bytes: 25165824,
      sha256: '6bfc8c38271437a04351edbbea9478b29431bc155929da0bebcce68b14090d31',
    },
    {
      id: 'wingclip-text',
      label: 'WingCLIP (species classifier, int8)',
      file: 'text_classifier_int8.bin',
      url: `${WINGCLIP}text_classifier_int8.bin`,
      bytes: 8488140,
      sha256: '5904dc6f5e53fa1aa354749682edd4c4fda4209210882e681b304ca7c4ee6739',
    },
  ],
  // Needed only by the engine tests and for comparisons. Never listed in the manifest, so the app never offers it.
  extras: [
    {
      id: 'birdnet-fp32',
      label: 'BirdNET V2.4 (sound, FP32, tests only)',
      file: 'birdnet-v2.4-fp32.tflite',
      url: `${BIRDNET}BirdNET_GLOBAL_6K_V2.4_Model_FP32.tflite`,
      bytes: 51726412,
      sha256: '55f3e4055b1a13bfa9a2452731d0d34f6a02d6b775a334362665892794165e4c',
    },
  ],
  benchmarks: [
    // BirdNET takes 3 seconds of 48 kHz mono audio (144000 samples) and returns 6522 scores.
    { id: 'birdnet-fp16', label: 'BirdNET V2.4 (LiteRT)', runtime: 'litert', file: 'birdnet-v2.4-fp16.tflite', input: { shape: [1, 144000], dtype: 'float32' } },
    // WingCLIP takes one 224x224 RGB picture and returns a 768-number embedding. Its weights sit in the .data file.
    {
      id: 'wingclip-onnx',
      label: 'WingCLIP (ONNX Runtime)',
      runtime: 'ort',
      file: 'wingclip_visual_int8.onnx',
      input: { shape: [1, 3, 224, 224], dtype: 'float32' },
      externalData: ['wingclip_visual_int8.data'],
    },
  ],
}

function loadConfig() {
  const path = option('--config')
  if (!path) return DEFAULT_CONFIG
  const parsed = JSON.parse(readFileSync(path, 'utf8'))
  const config = Array.isArray(parsed) ? { files: parsed } : parsed
  return { files: config.files ?? [], extras: config.extras ?? [], benchmarks: config.benchmarks ?? [] }
}

const config = loadConfig()

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const megabytes = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`

async function sha256Of(path) {
  const hash = createHash('sha256')
  await pipeline(createReadStream(path), async function* (chunks) {
    for await (const chunk of chunks) hash.update(chunk)
  })
  return hash.digest('hex')
}

/** Looks at a file on disk. `problem` says why it cannot be used, or is undefined when it is good. */
async function inspect(path, source) {
  if (!existsSync(path)) return { problem: 'missing' }
  const bytes = statSync(path).size
  if (source.bytes !== undefined && bytes !== source.bytes) return { bytes, problem: `size is ${bytes}, expected ${source.bytes}` }
  if (bytes === 0) return { bytes, problem: 'empty' }
  const sha256 = await sha256Of(path)
  if (source.sha256 !== undefined && sha256 !== source.sha256) return { bytes, sha256, problem: `checksum mismatch: expected ${source.sha256}, got ${sha256}` }
  return { bytes, sha256 }
}

class Permanent extends Error {}

async function download(url, target) {
  const response = await fetch(url, { redirect: 'follow' })
  if (!response.ok || !response.body) {
    const message = `HTTP ${response.status} for ${url}`
    // A missing or forbidden file will not appear by asking again.
    if (response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 429) throw new Permanent(message)
    throw new Error(message)
  }
  await pipeline(Readable.fromWeb(response.body), createWriteStream(target))
}

/** Gets one model file into outDir. Returns { id, file, bytes, sha256, label }, or throws. */
async function ensureFile(source) {
  const target = join(outDir, source.file)
  const partial = `${target}.part`

  if (!force) {
    const existing = await inspect(target, source)
    if (!existing.problem) {
      console.log(`  already there (${megabytes(existing.bytes)}), checksum ${existing.sha256.slice(0, 12)}... is right`)
      return { id: source.id, file: source.file, bytes: existing.bytes, sha256: existing.sha256, label: source.label }
    }
    if (existing.problem !== 'missing') console.log(`  found a file that cannot be used (${existing.problem}), getting it again`)
  }

  if (!source.url) throw new Error('not on disk, and no download address is given')
  let lastError
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      console.log(`  downloading ${source.url}`)
      await download(source.url, partial)
      const result = await inspect(partial, source)
      if (result.problem) throw new Permanent(result.problem)
      renameSync(partial, target)
      console.log(`  ${megabytes(result.bytes)}, sha256 ${result.sha256}`)
      return { id: source.id, file: source.file, bytes: result.bytes, sha256: result.sha256, label: source.label }
    } catch (error) {
      rmSync(partial, { force: true })
      lastError = error
      if (error instanceof Permanent) break
      console.warn(`  attempt ${attempt} failed: ${error.message}`)
      if (attempt < MAX_ATTEMPTS) await sleep(retryDelayMs * attempt)
    }
  }
  throw lastError
}

mkdirSync(outDir, { recursive: true })

const available = []
const failed = []
for (const source of config.files) {
  console.log(source.label)
  try {
    available.push(await ensureFile(source))
  } catch (error) {
    failed.push(source)
    console.error(`  FAILED: ${error.message}`)
  }
}

if (withFp32) {
  for (const source of config.extras) {
    console.log(source.label)
    try {
      await ensureFile(source)
    } catch (error) {
      console.error(`  FAILED (optional): ${error.message}`)
    }
  }
}

// A benchmark is only offered when the files it needs are all there.
const have = new Set(available.map((entry) => entry.file))
const benchmarks = config.benchmarks.filter((benchmark) => have.has(benchmark.file) && (benchmark.externalData ?? []).every((name) => have.has(name)))

const manifest = { version: 2, files: available, benchmarks }
// Written to a temporary file first, so a program that reads the manifest at the same moment never sees half of it.
const manifestPath = join(outDir, 'manifest.json')
// Lists of numbers (the input shapes) stay on one line, which is easier to read.
const text = JSON.stringify(manifest, null, 2).replace(/\[([\d,\s]+)\]/g, (_, numbers) => `[${numbers.trim().split(/\s*,\s*/).join(', ')}]`)
writeFileSync(`${manifestPath}.tmp`, text + '\n')
renameSync(`${manifestPath}.tmp`, manifestPath)

console.log(`manifest.json lists ${available.length} of ${config.files.length} models and ${benchmarks.length} benchmarks`)
if (failed.length > 0) {
  console.warn(`Missing: ${failed.map((source) => source.file).join(', ')}. The app still works; the Field check and the other screens use what is there.`)
}
if (available.length === 0 || (strict && failed.length > 0)) process.exit(1)
