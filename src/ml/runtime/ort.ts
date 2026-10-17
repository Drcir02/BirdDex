// Lazy loader for ONNX Runtime Web, the runtime that runs the WingCLIP image model (the photo and live camera engines).
//
//   const encoder = await createImageEncoder(graphBytes, { path: 'wingclip_visual_int8.data', data: weightBytes })
//   const embedding = await encoder.run(tensor)      // Float32Array [1, 3, 224, 224] in, 768 floats out
//   await encoder.release()                          // frees the model's memory inside WebAssembly
//
// - ONNX Runtime Web is not part of the app bundle. It is loaded with a plain import() of our own copy in vendor/ort/
//   (scripts/copy-vendor.mjs) the first time a model is created, exactly like the Field check does, so it is cached by
//   the service worker for offline use and costs nothing at start-up.
// - It runs on the CPU in WebAssembly ("wasm" provider), on one thread. Threads need SharedArrayBuffer, which GitHub Pages
//   cannot enable (no COOP and COEP headers). WebGPU is left out on purpose: WingDex measured 516 ms against 318 ms per
//   picture and 1753 ms against 192 ms to start for this model, because the int8 operators fall back to the CPU and the
//   copies cost more than the maths. If the Field check on a real phone shows the opposite, add 'webgpu' in front of
//   'wasm' in `executionProviders` below.
// - This module has no DOM dependency: it also runs inside the Web Worker that the photo and live engines use.
// - Two builds of the runtime are tried in turn: the plain WebAssembly build (14 MB, the one we want) and the WebGPU build
//   that the Field check loads (27 MB, slower to start). The second is only a fallback for a vendor folder without the first.

import type { InferenceSession, Tensor } from 'onnxruntime-web'

type OrtModule = typeof import('onnxruntime-web')

/** Where the files of ONNX Runtime Web are served from. BASE_URL ends with a slash ("/birddex/" on GitHub Pages). */
export const ORT_VENDOR_PATH = `${import.meta.env.BASE_URL}vendor/ort/`

/** The runtime or the model would not start. Screens show `common.errors.modelLoad` for it. (Same name as in litert.ts.) */
export class ModelLoadError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'ModelLoadError'
  }
}

export type OrtBuildId = 'wasm' | 'webgpu-build'

interface OrtBuild {
  id: OrtBuildId
  /** The loader script in vendor/ort/. Its WebAssembly files sit next to it. */
  script: string
}

/** In the order they are tried. */
export const ORT_BUILDS: readonly OrtBuild[] = [
  { id: 'wasm', script: 'ort.wasm.min.mjs' },
  { id: 'webgpu-build', script: 'ort.webgpu.min.mjs' },
]

/** An absolute address inside vendor/ort/. Works in a page and in a worker (both resolve against their own address). */
export function ortUrl(file: string): string {
  return new URL(`${ORT_VENDOR_PATH}${file}`, globalThis.location.href).href
}

async function importBuild(build: OrtBuild): Promise<OrtModule> {
  const ort = (await import(/* @vite-ignore */ ortUrl(build.script))) as OrtModule
  ort.env.wasm.wasmPaths = ortUrl('')
  // One thread: no SharedArrayBuffer on GitHub Pages or in iOS home-screen apps. proxy would start yet another worker.
  ort.env.wasm.numThreads = 1
  ort.env.wasm.proxy = false
  ort.env.logLevel = 'error'
  return ort
}

/** A model with one float32 input and one float32 output (the WingCLIP image tower). */
export interface ImageEncoder {
  /** Which build of the runtime is running. */
  readonly build: OrtBuildId
  /** Version of ONNX Runtime Web. */
  readonly version: string
  /** The shape the model expects, for example [1, 3, 224, 224]. */
  readonly inputShape: readonly number[]
  /** Runs the model once. Callers must not overlap runs (the engine's core queues them). Returns a copy of the output. */
  run(input: Float32Array): Promise<Float32Array>
  /** Frees the model. Further calls to run() fail. */
  release(): Promise<void>
}

export interface ExternalFile {
  /** Must equal the file name written inside the graph, for WingCLIP "wingclip_visual_int8.data". */
  path: string
  data: Uint8Array
}

export interface EncoderOptions {
  /** Shape of the input. Default [1, 3, 224, 224]. */
  inputShape?: readonly number[]
}

async function openSession(ort: OrtModule, graph: Uint8Array, external: ExternalFile): Promise<InferenceSession> {
  return ort.InferenceSession.create(graph, {
    executionProviders: ['wasm'],
    externalData: [{ path: external.path, data: external.data }],
    graphOptimizationLevel: 'all',
    logSeverityLevel: 3,
  })
}

function wrap(ort: OrtModule, session: InferenceSession, build: OrtBuildId, inputShape: readonly number[]): ImageEncoder {
  const inputName = session.inputNames[0]
  const outputName = session.outputNames[0]
  let released = false
  return {
    build,
    version: ort.env.versions.web ?? 'unknown',
    inputShape,
    async run(input) {
      if (released) throw new ModelLoadError('The model was already released')
      const tensor: Tensor = new ort.Tensor('float32', input, [...inputShape])
      const outputs = await session.run({ [inputName]: tensor })
      const output = outputs[outputName]
      const copy = new Float32Array(output.data as Float32Array)
      output.dispose()
      return copy
    },
    async release() {
      if (released) return
      released = true
      await session.release()
    },
  }
}

/**
 * Starts ONNX Runtime Web (once per page or worker) and creates the model. `graph` is the .onnx file, `external` the
 * .data file with its weights. Throws ModelLoadError when no build of the runtime can run the model.
 */
export async function createImageEncoder(graph: Uint8Array, external: ExternalFile, options: EncoderOptions = {}): Promise<ImageEncoder> {
  const inputShape = options.inputShape ?? [1, 3, 224, 224]
  let failure: unknown
  for (const build of ORT_BUILDS) {
    try {
      const ort = await importBuild(build)
      const session = await openSession(ort, graph, external)
      return wrap(ort, session, build.id, inputShape)
    } catch (error) {
      failure = error
    }
  }
  throw new ModelLoadError('ONNX Runtime Web could not run the model', { cause: failure })
}
