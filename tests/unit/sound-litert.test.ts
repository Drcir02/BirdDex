import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// LiteRT.js itself needs a browser, so here it is replaced by a fake that keeps count of every tensor and model it
// hands out. What is tested is our own care: one start-up, no leaked tensors, runs one after the other.

const fake = vi.hoisted(() => {
  const state = {
    loadCalls: [] as Array<[string, unknown]>,
    loadImpl: undefined as undefined | (() => Promise<unknown>),
    tensors: [] as Array<{ deleted: boolean }>,
    compiled: [] as Array<{ deleted: boolean; runs: number; maxParallel: number }>,
    compileOptions: [] as unknown[],
    inputDetails: [{ name: 'in', dtype: 'float32', shape: Int32Array.of(1, 4) }] as Array<{ name: string; dtype: string; shape: Int32Array }>,
    outputDetails: [{ name: 'out', dtype: 'float32', shape: Int32Array.of(1, 3) }] as Array<{ name: string; dtype: string; shape: Int32Array }>,
    runImpl: undefined as undefined | ((input: Float32Array) => Promise<Float32Array>),
    unloadCalls: 0,
    compileError: undefined as unknown,
  }
  class Tensor {
    deleted = false
    constructor(
      readonly values: Float32Array,
      readonly shape: number[],
    ) {
      state.tensors.push(this)
    }
    async data() {
      return this.values.slice()
    }
    delete() {
      this.deleted = true
    }
  }
  return { state, Tensor }
})

vi.mock('@litertjs/core', () => ({
  Tensor: fake.Tensor,
  unloadLiteRt: () => {
    fake.state.unloadCalls++
  },
  loadLiteRt: async (path: string, options: unknown) => {
    fake.state.loadCalls.push([path, options])
    // Like the real loader, take the global Module object and clear it afterwards.
    const result = await (fake.state.loadImpl ?? (async () => ({})))()
    ;(globalThis as { Module?: unknown }).Module = undefined
    return result
  },
  loadAndCompile: async (_bytes: Uint8Array, options: unknown) => {
    fake.state.compileOptions.push(options)
    if (fake.state.compileError) throw fake.state.compileError
    let running = 0
    const record = { deleted: false, runs: 0, maxParallel: 0 }
    fake.state.compiled.push(record)
    return {
      getInputDetails: () => fake.state.inputDetails,
      getOutputDetails: () => fake.state.outputDetails,
      run: async (input: InstanceType<typeof fake.Tensor>) => {
        running++
        record.runs++
        record.maxParallel = Math.max(record.maxParallel, running)
        try {
          const output = await (fake.state.runImpl ?? (async (values: Float32Array) => Float32Array.from({ length: 3 }, (_, i) => values[i] * 2)))(input.values)
          return [new fake.Tensor(output, [1, output.length])]
        } finally {
          running--
        }
      },
      delete: () => {
        record.deleted = true
      },
    }
  },
}))

import { compileFloatModel, isLiteRtLoaded, LITERT_VENDOR_URL, loadLiteRt, ModelLoadError, unloadLiteRtRuntime } from '../../src/ml/runtime/litert'

beforeEach(async () => {
  await unloadLiteRtRuntime()
  fake.state.loadCalls = []
  fake.state.loadImpl = undefined
  fake.state.tensors = []
  fake.state.compiled = []
  fake.state.compileOptions = []
  fake.state.inputDetails = [{ name: 'in', dtype: 'float32', shape: Int32Array.of(1, 4) }]
  fake.state.outputDetails = [{ name: 'out', dtype: 'float32', shape: Int32Array.of(1, 3) }]
  fake.state.runImpl = undefined
  fake.state.unloadCalls = 0
  fake.state.compileError = undefined
  ;(globalThis as { Module?: unknown }).Module = undefined
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('starting LiteRT.js', () => {
  it('starts once, from our own vendor folder, on the CPU path without threads', async () => {
    const first = loadLiteRt()
    const second = loadLiteRt()
    expect(second).toBe(first) // the same promise for callers that ask at the same time
    await first
    await loadLiteRt()
    expect(fake.state.loadCalls).toEqual([[LITERT_VENDOR_URL, { threads: false }]])
    expect(LITERT_VENDOR_URL).toBe(`${import.meta.env.BASE_URL}vendor/litert/`)
    expect(isLiteRtLoaded()).toBe(true)
  })

  it('moves the chatter of the WebAssembly module away from the error channel, but keeps real errors', async () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => undefined)
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    let printErr: ((...args: unknown[]) => void) | undefined
    fake.state.loadImpl = async () => {
      printErr = (globalThis as unknown as { Module: { printErr: (...args: unknown[]) => void } }).Module.printErr
      return {}
    }
    await loadLiteRt()
    expect(printErr).toBeDefined()
    printErr!('INFO: [environment.cc:36] Creating LiteRT environment with options')
    printErr!('WARNING: [npu_registry.cc:34] NPU accelerator could not be loaded')
    expect(error).not.toHaveBeenCalled()
    expect(debug).toHaveBeenCalledTimes(2)
    printErr!('ERROR: [x.cc:1] out of memory')
    expect(error).toHaveBeenCalledTimes(1)
  })

  it('does not take over a Module someone else has set', async () => {
    const mine = { custom: true }
    ;(globalThis as { Module?: unknown }).Module = mine
    let seen: unknown
    fake.state.loadImpl = async () => {
      seen = (globalThis as { Module?: unknown }).Module
      return {}
    }
    await loadLiteRt()
    expect(seen).toBe(mine)
  })

  it('reports a failed start as a ModelLoadError, cleans up, and starts again next time', async () => {
    fake.state.loadImpl = async () => Promise.reject(new Error('404 for the wasm file'))
    const error = await loadLiteRt().catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ModelLoadError)
    expect((error as ModelLoadError).cause).toBeInstanceOf(Error)
    expect(isLiteRtLoaded()).toBe(false)
    expect((globalThis as { Module?: unknown }).Module).toBeUndefined()

    fake.state.loadImpl = undefined
    await expect(loadLiteRt()).resolves.toBeDefined()
    expect(fake.state.loadCalls).toHaveLength(2)
  })

  it('can shut LiteRT.js down again', async () => {
    await loadLiteRt()
    await unloadLiteRtRuntime()
    expect(fake.state.unloadCalls).toBe(1)
    expect(isLiteRtLoaded()).toBe(false)
    await unloadLiteRtRuntime() // nothing to do, no error
    expect(fake.state.unloadCalls).toBe(1)
  })
})

describe('compileFloatModel', () => {
  const bytes = new Uint8Array(4)

  it('compiles for the CPU by default and reads the shapes', async () => {
    const model = await compileFloatModel(bytes)
    expect(fake.state.compileOptions).toEqual([{ accelerator: 'wasm' }])
    expect(model.inputShape).toEqual([1, 4])
    expect(model.outputLength).toBe(3)
    const gpu = await compileFloatModel(bytes, { accelerator: 'webgpu' })
    expect(fake.state.compileOptions[1]).toEqual({ accelerator: 'webgpu' })
    gpu.delete()
  })

  it('runs the model and returns the numbers', async () => {
    const model = await compileFloatModel(bytes)
    const out = await model.run(Float32Array.of(1, 2, 3, 4))
    expect(Array.from(out)).toEqual([2, 4, 6])
  })

  it('deletes every tensor it makes, after each run', async () => {
    const model = await compileFloatModel(bytes)
    for (let i = 0; i < 5; i++) await model.run(Float32Array.of(1, 2, 3, 4))
    expect(fake.state.tensors).toHaveLength(10) // one input and one output per run
    expect(fake.state.tensors.every((tensor) => tensor.deleted)).toBe(true)
  })

  it('deletes them even when the run fails', async () => {
    const model = await compileFloatModel(bytes)
    fake.state.runImpl = async () => Promise.reject(new Error('out of memory'))
    await expect(model.run(Float32Array.of(1, 2, 3, 4))).rejects.toThrow('out of memory')
    expect(fake.state.tensors.every((tensor) => tensor.deleted)).toBe(true)
    // And the model still works afterwards.
    fake.state.runImpl = undefined
    await expect(model.run(Float32Array.of(1, 2, 3, 4))).resolves.toHaveLength(3)
  })

  it('refuses an input of the wrong size', async () => {
    const model = await compileFloatModel(bytes)
    await expect(model.run(new Float32Array(5))).rejects.toThrow(RangeError)
    expect(fake.state.tensors).toHaveLength(0)
  })

  it('runs one at a time, however many callers ask at once', async () => {
    const model = await compileFloatModel(bytes)
    const results = await Promise.all([1, 2, 3, 4].map((n) => model.run(Float32Array.of(n, n, n, n))))
    expect(results.map((r) => r[0])).toEqual([2, 4, 6, 8])
    expect(fake.state.compiled[0].maxParallel).toBe(1)
  })

  it('refuses models with a dynamic shape or the wrong kind of numbers, and frees them', async () => {
    fake.state.inputDetails = [{ name: 'in', dtype: 'float32', shape: Int32Array.of(-1, 3) }]
    await expect(compileFloatModel(bytes)).rejects.toThrow('dynamic shape')
    expect(fake.state.compiled[0].deleted).toBe(true)

    fake.state.inputDetails = [{ name: 'in', dtype: 'int32', shape: Int32Array.of(1, 4) }]
    await expect(compileFloatModel(bytes)).rejects.toThrow('float32')
    expect(fake.state.compiled[1].deleted).toBe(true)

    fake.state.inputDetails = [
      { name: 'a', dtype: 'float32', shape: Int32Array.of(1, 4) },
      { name: 'b', dtype: 'float32', shape: Int32Array.of(1, 4) },
    ]
    await expect(compileFloatModel(bytes)).rejects.toThrow('exactly one')
  })

  it('wraps a failure to compile', async () => {
    fake.state.compileError = new Error('unsupported op')
    const error = await compileFloatModel(bytes).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ModelLoadError)
    expect((error as ModelLoadError).cause).toBeInstanceOf(Error)
  })

  it('frees the model on delete, once, after a run that is still going', async () => {
    const model = await compileFloatModel(bytes)
    let finish: (() => void) | undefined
    fake.state.runImpl = () =>
      new Promise((resolve) => {
        finish = () => resolve(Float32Array.of(1, 2, 3))
      })
    const running = model.run(Float32Array.of(1, 2, 3, 4))
    await Promise.resolve()
    await Promise.resolve()
    model.delete()
    model.delete()
    expect(model.deleted).toBe(true)
    expect(fake.state.compiled[0].deleted).toBe(false) // the run is not over yet
    finish!()
    await running
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(fake.state.compiled[0].deleted).toBe(true)
    await expect(model.run(Float32Array.of(1, 2, 3, 4))).rejects.toThrow(ModelLoadError)
  })
})
