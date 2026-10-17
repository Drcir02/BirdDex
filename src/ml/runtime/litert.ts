// Lazy loader for LiteRT.js, the runtime that runs the BirdNET .tflite files on the phone.
//
//   const model = await compileFloatModel(await getModelBytes('birdnet-fp16'))
//   const scores = await model.run(audioWindow)      // Float32Array in, Float32Array out
//   model.delete()                                   // frees the model's memory inside WebAssembly
//
// - LiteRT.js itself (about 55 KB) and its WebAssembly files (9 MB each) are loaded the first time a model is
//   compiled, never at app start. The WebAssembly files are our own copies in vendor/litert/ (scripts/copy-vendor.mjs),
//   so there is no CDN and the service worker keeps them for offline use.
// - The CPU accelerator ("wasm", XNNPACK) is the default. It runs everywhere. Threads stay off on purpose: GitHub Pages
//   cannot send the headers that SharedArrayBuffer needs, and one code path is the one we can test.
// - LiteRT.js allows one runtime per page and throws when it is started twice, so the start-up is memoised here.
//   A failed start is forgotten, so the next call tries again.
// - Tensors live in WebAssembly memory and are not garbage collected: run() deletes every tensor it creates.

import type { CompiledModel, Tensor } from '@litertjs/core'

type LiteRtModule = typeof import('@litertjs/core')

/** Where the WebAssembly files of LiteRT.js are served from. BASE_URL ends with a slash ("/birddex/" on GitHub Pages). */
export const LITERT_VENDOR_URL = `${import.meta.env.BASE_URL}vendor/litert/`

/** LiteRT.js or the model would not start. Screens show `common.errors.modelLoad` for it. */
export class ModelLoadError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'ModelLoadError'
  }
}

// ---------- Start-up (once per page) ----------

let runtime: Promise<LiteRtModule> | undefined

/**
 * Settings for LiteRT.js's WebAssembly module, which it picks up from the global `Module` object when it starts and
 * clears again afterwards:
 * - where its .wasm file is. Inside a worker the module would look for the file next to the worker script, which is
 *   the wrong folder, so the vendor folder is named explicitly (it is also what the page does anyway).
 * - what to do with its messages. LiteRT.js prints its progress ("INFO: Creating LiteRT environment...") on the error
 *   channel of the browser console, which looks like a failure and fills the console of every test. Real problems stay
 *   errors, the chatter goes to the debug level.
 */
function prepareWasmModule(): void {
  const print = (...args: unknown[]) => console.debug('[litert]', ...args)
  const printErr = (...args: unknown[]) => {
    const text = args.map(String).join(' ')
    if (/^(ERROR|FATAL)/.test(text)) console.error('[litert]', text)
    else console.debug('[litert]', text)
  }
  const locateFile = (file: string) => `${LITERT_VENDOR_URL}${file}`
  const scope = globalThis as { Module?: unknown }
  if (scope.Module === undefined) scope.Module = { print, printErr, locateFile }
}

const describe = (error: unknown): string => (error instanceof Error ? `${error.name}: ${error.message}` : String(error))

async function start(): Promise<LiteRtModule> {
  try {
    const litert = await import('@litertjs/core')
    prepareWasmModule()
    await litert.loadLiteRt(LITERT_VENDOR_URL, { threads: false })
    return litert
  } catch (error) {
    // The loader may have left its half-made module behind; do not let it leak into the next try.
    const scope = globalThis as { Module?: unknown }
    scope.Module = undefined
    throw new ModelLoadError(`LiteRT.js could not be started (${describe(error)})`, { cause: error })
  }
}

/** Starts LiteRT.js (once) and returns its API. Safe to call from many places at the same time. */
export function loadLiteRt(): Promise<LiteRtModule> {
  runtime ??= start().catch((error: unknown) => {
    runtime = undefined
    throw error
  })
  return runtime
}

/** True once LiteRT.js is running. */
export function isLiteRtLoaded(): boolean {
  return runtime !== undefined
}

/** Bytes of WebAssembly memory the runtime has grown to (0 when it is not running). Memory only ever grows. */
export async function wasmMemoryBytes(): Promise<number> {
  if (!runtime) return 0
  const litert = await runtime
  return litert.getGlobalLiteRt().liteRtWasm.HEAPU8.length
}

/** Shuts LiteRT.js down and frees its memory. Everything compiled before becomes unusable. Only tests need this. */
export async function unloadLiteRtRuntime(): Promise<void> {
  const loading = runtime
  runtime = undefined
  if (!loading) return
  try {
    const litert = await loading
    litert.unloadLiteRt()
  } catch {
    // It never started: nothing to shut down.
  }
}

// ---------- Models ----------

/** A compiled model with one float32 input and one float32 output, like BirdNET and its location filter. */
export interface FloatModel {
  /** The shape the model expects, for example [1, 144000]. */
  readonly inputShape: readonly number[]
  /** Number of values in the output, for example 6522. */
  readonly outputLength: number
  /** Runs the model once. Runs are queued one after the other, so callers need not wait for each other. */
  run(input: Float32Array): Promise<Float32Array>
  /** Frees the model. Further calls to run() fail. */
  delete(): void
  readonly deleted: boolean
}

export interface CompileOptions {
  /** "wasm" (CPU, the default) or "webgpu". */
  accelerator?: 'wasm' | 'webgpu'
}

function product(shape: ArrayLike<number>): number {
  let count = 1
  for (let i = 0; i < shape.length; i++) count *= shape[i]
  return count
}

/** Compiles a .tflite file (its bytes) into a model that is ready to run. */
export async function compileFloatModel(bytes: Uint8Array, options: CompileOptions = {}): Promise<FloatModel> {
  const litert = await loadLiteRt()
  let compiled: CompiledModel
  try {
    compiled = await litert.loadAndCompile(bytes, { accelerator: options.accelerator ?? 'wasm' })
  } catch (error) {
    throw new ModelLoadError('The model could not be compiled', { cause: error })
  }

  const inputs = compiled.getInputDetails()
  const outputs = compiled.getOutputDetails()
  if (inputs.length !== 1 || outputs.length !== 1 || inputs[0].dtype !== 'float32' || outputs[0].dtype !== 'float32') {
    compiled.delete()
    throw new ModelLoadError('The model does not have exactly one float32 input and one float32 output')
  }
  const inputShape = Array.from(inputs[0].shape)
  const outputShape = Array.from(outputs[0].shape)
  if ([...inputShape, ...outputShape].some((size) => !(size > 0))) {
    compiled.delete()
    throw new ModelLoadError(`The model has a dynamic shape (in [${inputShape.join(', ')}], out [${outputShape.join(', ')}]); LiteRT.js needs fixed sizes`)
  }
  const inputLength = product(inputShape)
  const outputLength = product(outputShape)

  let deleted = false
  // LiteRT.js runs on the page's single thread. Queue runs so two callers never touch the model at the same time.
  let tail: Promise<unknown> = Promise.resolve()

  async function runOnce(input: Float32Array): Promise<Float32Array> {
    if (deleted) throw new ModelLoadError('The model was already deleted')
    if (input.length !== inputLength) throw new RangeError(`The model needs ${inputLength} values but got ${input.length}`)
    const tensor = new litert.Tensor(input, inputShape)
    let results: Tensor[] | undefined
    try {
      results = await compiled.run(tensor)
      // data() copies the numbers out of WebAssembly memory, so the copy stays valid after the tensors are deleted.
      return (await results[0].data()) as Float32Array
    } finally {
      tensor.delete()
      results?.forEach((result) => result.delete())
    }
  }

  return {
    inputShape,
    outputLength,
    run(input) {
      const result = tail.then(() => runOnce(input))
      tail = result.catch(() => undefined)
      return result
    },
    delete() {
      if (deleted) return
      deleted = true
      // Wait for a run that is still going before freeing the model under it.
      void tail.then(() => compiled.delete())
    },
    get deleted() {
      return deleted
    },
  }
}
