// Copies the model-runtime files (WebAssembly and loaders) out of node_modules into public/vendor/,
// so the app serves them itself: no CDN, and they work offline once cached.
// Safe to run many times, and safe while another build is running: it only adds or replaces files.
import { cpSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const ortDist = join(root, 'node_modules/onnxruntime-web/dist')
const litertWasm = join(root, 'node_modules/@litertjs/core/wasm')
const out = join(root, 'public/vendor')

if (!existsSync(ortDist) || !existsSync(litertWasm)) {
  console.error('Model runtimes not found. Run "npm install" first.')
  process.exit(1)
}

function copyIfDifferent(from, to) {
  if (existsSync(to) && statSync(to).size === statSync(from).size) return
  mkdirSync(dirname(to), { recursive: true })
  cpSync(from, to)
}

// The WebGPU build of ONNX Runtime Web (import "onnxruntime-web/webgpu") loads these three files.
// They are loaded straight from here at run time, not bundled, so the app itself stays small.
// The plain WebAssembly build (ort.wasm.min.mjs and the two files next to it) is what the photo engine uses
// (src/ml/runtime/ort.ts): it starts about twice as fast and is 12 MB smaller. The WebGPU build stays for the Field check.
for (const file of [
  'ort.webgpu.min.mjs',
  'ort-wasm-simd-threaded.asyncify.mjs',
  'ort-wasm-simd-threaded.asyncify.wasm',
  'ort.wasm.min.mjs',
  'ort-wasm-simd-threaded.mjs',
  'ort-wasm-simd-threaded.wasm',
]) {
  copyIfDifferent(join(ortDist, file), join(out, 'ort', file))
}
// LiteRT.js picks the right variant (plain, threaded, JSPI, compat) from this folder at runtime.
for (const file of readdirSync(litertWasm)) {
  copyIfDifferent(join(litertWasm, file), join(out, 'litert', file))
}

console.log('Model runtimes are in public/vendor/')
