import { parseManifest, type ModelBenchmark } from '../../ml/runtime/modelManifest'
import type { Status } from '../types'

type Accelerator = 'wasm' | 'webgpu'

const MB = 1024 * 1024
const base = import.meta.env.BASE_URL
const absolute = (path: string) => `${location.origin}${base}${path}`

/**
 * The speed tests listed in models/manifest.json (version 2), written by scripts/fetch-models.mjs.
 * `benchmarks` is empty while no models are bundled; `problem` says why when the list exists but cannot be used.
 */
export async function loadBenchmarks(): Promise<{ benchmarks: ModelBenchmark[]; problem?: string }> {
  let json: unknown
  try {
    const response = await fetch(`${base}models/manifest.json`, { cache: 'no-store' })
    if (!response.ok) return { benchmarks: [] }
    json = await response.json()
  } catch {
    return { benchmarks: [] }
  }
  try {
    return { benchmarks: parseManifest(json).benchmarks }
  } catch (error) {
    return { benchmarks: [], problem: error instanceof Error ? error.message : String(error) }
  }
}

/** A tiny, library-free speed test, so there is a number even before any model is bundled. */
export function cpuBaselineMs(): number {
  const n = 1 << 20
  const a = new Float32Array(n)
  const b = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    a[i] = i % 97
    b[i] = (i % 89) / 89
  }
  const started = performance.now()
  let acc = 0
  for (let rep = 0; rep < 40; rep++) for (let i = 0; i < n; i++) acc += a[i] * b[i]
  const elapsed = performance.now() - started
  if (Number.isNaN(acc)) console.warn('unexpected NaN in baseline')
  return elapsed
}

const median = (values: number[]) => [...values].sort((x, y) => x - y)[Math.floor(values.length / 2)]

/** Quiet pseudo-noise in [-0.1, 0.1]. Good enough to time a model; real audio comes in M3. */
function noise(count: number): Float32Array {
  const data = new Float32Array(count)
  let x = 123456789
  for (let i = 0; i < count; i++) {
    x ^= x << 13
    x ^= x >>> 17
    x ^= x << 5
    data[i] = ((x >>> 0) / 4294967295 - 0.5) * 0.2
  }
  return data
}

function describeOutput(values: ArrayLike<number>): string {
  let nan = 0
  let min = Infinity
  let max = -Infinity
  for (let i = 0; i < values.length; i++) {
    const v = values[i]
    if (Number.isNaN(v)) nan++
    else {
      if (v < min) min = v
      if (v > max) max = v
    }
  }
  return `${values.length} values, min ${min.toFixed(3)}, max ${max.toFixed(3)}${nan ? `, ${nan} NaN (bad)` : ''}`
}

async function download(path: string, log: (line: string) => void): Promise<Uint8Array> {
  const started = performance.now()
  const response = await fetch(absolute(path))
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${path}`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  log(`Downloaded ${(bytes.byteLength / MB).toFixed(1)} MB in ${Math.round(performance.now() - started)} ms (instant the second time, it is cached)`)
  return bytes
}

function summarise(label: string, loadMs: number, times: number[], output: string): string {
  const rest = times.slice(1)
  return (
    `${label}: ready in ${Math.round(loadMs)} ms, first run ${Math.round(times[0])} ms, ` +
    `then median ${Math.round(median(rest))} ms (best ${Math.round(Math.min(...rest))}, worst ${Math.round(Math.max(...rest))}). Output: ${output}`
  )
}

type Ort = typeof import('onnxruntime-web/webgpu')
let ortLoading: Promise<Ort> | undefined

/** Loads ONNX Runtime Web from our own vendor/ folder at run time, so it is cached for offline use and not in the app bundle. */
function loadOrt(): Promise<Ort> {
  ortLoading ??= import(/* @vite-ignore */ absolute('vendor/ort/ort.webgpu.min.mjs')) as Promise<Ort>
  return ortLoading
}

async function benchOrt(
  model: ModelBenchmark,
  accelerator: Accelerator,
  bytes: Uint8Array,
  extraFiles: { path: string; data: Uint8Array }[],
  log: (line: string) => void,
): Promise<void> {
  const ort = await loadOrt()
  ort.env.wasm.wasmPaths = absolute('vendor/ort/')
  ort.env.wasm.numThreads = crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 2) : 1
  const loadStarted = performance.now()
  // A model with its weights in a separate file (WingCLIP's .data) gets that file handed over under the same name.
  const session = await ort.InferenceSession.create(bytes, {
    executionProviders: [accelerator],
    ...(extraFiles.length > 0 ? { externalData: extraFiles } : {}),
  })
  const loadMs = performance.now() - loadStarted
  try {
    const count = model.input.shape.reduce((a, b) => a * b, 1)
    const feeds = { [session.inputNames[0]]: new ort.Tensor('float32', noise(count), model.input.shape) }
    const times: number[] = []
    let output = ''
    for (let i = 0; i < 6; i++) {
      const started = performance.now()
      const results = await session.run(feeds)
      const values = (await results[session.outputNames[0]].getData()) as Float32Array
      times.push(performance.now() - started)
      if (i === 0) output = describeOutput(values)
    }
    log(summarise(`ONNX Runtime Web / ${accelerator}`, loadMs, times, output))
  } finally {
    await session.release()
  }
}

let liteRtLoading: Promise<unknown> | undefined

async function benchLiteRt(model: ModelBenchmark, accelerator: Accelerator, bytes: Uint8Array, log: (line: string) => void): Promise<void> {
  const litert = await import('@litertjs/core')
  if (accelerator === 'webgpu' && !litert.isWebGPUSupported()) throw new Error('WebGPU is not supported by this browser')
  liteRtLoading ??= litert.loadLiteRt(absolute('vendor/litert/'), { threads: crossOriginIsolated })
  await liteRtLoading
  const loadStarted = performance.now()
  const compiled = await litert.loadAndCompile(bytes, { accelerator })
  const loadMs = performance.now() - loadStarted
  try {
    const inputs = compiled.getInputDetails()
    log(`LiteRT model input: ${inputs.map((d) => `${d.name} ${d.dtype} [${[...d.shape].join(', ')}]`).join('; ')}`)
    const count = model.input.shape.reduce((a, b) => a * b, 1)
    const times: number[] = []
    let output = ''
    for (let i = 0; i < 6; i++) {
      const input = new litert.Tensor(noise(count), model.input.shape)
      const started = performance.now()
      const results = await compiled.run(input)
      const values = await results[0].data()
      times.push(performance.now() - started)
      if (i === 0) output = describeOutput(values as unknown as ArrayLike<number>)
      results.forEach((tensor) => tensor.delete())
      input.delete()
    }
    log(summarise(`LiteRT.js / ${accelerator}`, loadMs, times, output))
  } finally {
    compiled.delete()
  }
}

/** Times every benchmark in the model list on the runtime it names and every accelerator the phone supports. */
export async function runModelBenchmarks(models: ModelBenchmark[], log: (line: string) => void): Promise<Status> {
  let failures = 0
  for (const model of models) {
    log(`== ${model.label} ==`)
    let bytes: Uint8Array
    const extraFiles: { path: string; data: Uint8Array }[] = []
    try {
      bytes = await download(`models/${model.file}`, log)
      for (const name of model.externalData ?? []) extraFiles.push({ path: name, data: await download(`models/${name}`, log) })
    } catch (error) {
      log(`Could not download: ${String(error)}`)
      failures++
      continue
    }
    for (const accelerator of ['wasm', 'webgpu'] as const) {
      try {
        if (model.runtime === 'ort') await benchOrt(model, accelerator, bytes, extraFiles, log)
        else await benchLiteRt(model, accelerator, bytes, log)
      } catch (error) {
        log(`${model.runtime === 'ort' ? 'ONNX Runtime Web' : 'LiteRT.js'} / ${accelerator}: not working (${error instanceof Error ? error.message : String(error)})`)
        // A missing WebGPU is expected on some phones. Only the CPU path (wasm) must work.
        if (accelerator === 'wasm') failures++
      }
    }
  }
  return failures === 0 ? 'pass' : 'fail'
}
