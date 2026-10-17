import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ModelProgress } from '../../src/domain/types'
import {
  createModelStore,
  MODEL_CACHE_NAME,
  ModelChecksumError,
  ModelDownloadError,
  ModelStorageFullError,
  ModelStoreError,
  parseManifest,
  type ModelStoreOptions,
  type ModelStoreStatus,
} from '../../src/ml/runtime/modelStore'
import { bytesFor, FakeCacheStorage, FakeServer, sha256, type Served } from './helpers/fake-model-server'

const BASE = 'https://birddex.test/app/models/'

const FILES = [
  { id: 'audio', file: 'audio.tflite', bytes: bytesFor(70_000, 1), label: 'Audio model' },
  { id: 'geo', file: 'geo.tflite', bytes: bytesFor(30_000, 2), label: 'Location model' },
  { id: 'graph', file: 'photo.onnx', bytes: bytesFor(20_000, 3), label: 'Photo graph' },
  { id: 'weights', file: 'photo.data', bytes: bytesFor(50_000, 4), label: 'Photo weights' },
]

function setup(options: Partial<ModelStoreOptions> = {}, files = FILES) {
  const server = new FakeServer(BASE)
  for (const file of files) server.add(file.file, file.bytes)
  server.manifestBody = {
    version: 2,
    files: files.map((file) => ({ id: file.id, file: file.file, bytes: file.bytes.length, sha256: sha256(file.bytes), label: file.label })),
    benchmarks: [{ id: 'audio', label: 'Audio', runtime: 'litert', file: 'audio.tflite', input: { shape: [1, 144000], dtype: 'float32' } }],
  }
  const caches = new FakeCacheStorage()
  const make = (extra: Partial<ModelStoreOptions> = {}) =>
    createModelStore({
      modelsUrl: BASE,
      fetch: server.fetch,
      getCaches: () => caches.asCacheStorage(),
      retryDelaysMs: [1, 1],
      // Long enough that a slow machine never trips it by accident; the stall tests ask for a short one.
      stallTimeoutMs: 3000,
      estimateStorage: async () => undefined,
      isOnline: () => true,
      ...options,
      ...extra,
    })
  return { server, caches, store: make(), make }
}

const modelCache = (caches: FakeCacheStorage) => caches.caches.get(MODEL_CACHE_NAME)
const audio = FILES[0]

afterEach(() => vi.useRealTimers())

describe('the model list', () => {
  it('is read from manifest.json, once', async () => {
    const { store, server } = setup()
    const manifest = await store.getManifest()
    expect(manifest.version).toBe(2)
    expect(manifest.files.map((file) => file.id)).toEqual(['audio', 'geo', 'graph', 'weights'])
    expect(manifest.files[0]).toEqual({ id: 'audio', file: 'audio.tflite', bytes: 70_000, sha256: sha256(audio.bytes), label: 'Audio model' })
    expect(manifest.benchmarks[0]).toMatchObject({ id: 'audio', runtime: 'litert', input: { shape: [1, 144000], dtype: 'float32' } })
    await store.getManifest()
    expect(server.requestsFor('manifest.json')).toHaveLength(1)
  })

  it.each([
    ['an old version', { version: 1, models: [] }],
    ['no files', { version: 2 }],
    ['a file without a checksum', { version: 2, files: [{ id: 'a', file: 'a.bin', bytes: 5, label: 'A' }] }],
    ['an upper-case checksum', { version: 2, files: [{ id: 'a', file: 'a.bin', bytes: 5, sha256: 'A'.repeat(64), label: 'A' }] }],
    ['a file path instead of a name', { version: 2, files: [{ id: 'a', file: '../a.bin', bytes: 5, sha256: 'a'.repeat(64), label: 'A' }] }],
    ['a size of zero', { version: 2, files: [{ id: 'a', file: 'a.bin', bytes: 0, sha256: 'a'.repeat(64), label: 'A' }] }],
    ['a fractional size', { version: 2, files: [{ id: 'a', file: 'a.bin', bytes: 1.5, sha256: 'a'.repeat(64), label: 'A' }] }],
    ['the same id twice', { version: 2, files: [1, 2].map(() => ({ id: 'a', file: 'a.bin', bytes: 5, sha256: 'a'.repeat(64), label: 'A' })) }],
    ['something that is not an object', 'models'],
    ['null', null],
  ])('rejects a list with %s', (_label, body) => {
    expect(() => parseManifest(body)).toThrow(ModelDownloadError)
    try {
      parseManifest(body)
    } catch (error) {
      expect(error).toMatchObject({ reason: 'manifest' })
    }
  })

  it('drops a broken benchmark but keeps the files and the good benchmarks', () => {
    const manifest = parseManifest({
      version: 2,
      files: [{ id: 'a', file: 'a.bin', bytes: 5, sha256: 'a'.repeat(64), label: 'A' }],
      benchmarks: [
        { id: 'good', label: 'Good', runtime: 'ort', file: 'a.bin', input: { shape: [1, 3, 224, 224], dtype: 'float32' }, externalData: ['a.data', '../evil'] },
        { id: 'no-runtime', file: 'a.bin', input: { shape: [1], dtype: 'float32' } },
        { id: 'bad-shape', runtime: 'ort', file: 'a.bin', input: { shape: [1, 0], dtype: 'float32' } },
        { id: 'bad-type', runtime: 'ort', file: 'a.bin', input: { shape: [1], dtype: 'int8' } },
        'junk',
      ],
    })
    expect(manifest.files).toHaveLength(1)
    expect(manifest.benchmarks).toEqual([
      { id: 'good', label: 'Good', runtime: 'ort', file: 'a.bin', input: { shape: [1, 3, 224, 224], dtype: 'float32' }, externalData: ['a.data'] },
    ])
  })

  it('works with a manifest that has no benchmarks at all', () => {
    expect(parseManifest({ version: 2, files: [] }).benchmarks).toEqual([])
  })

  it('reports a missing list as a ModelDownloadError, and tries again next time', async () => {
    const { store, server } = setup()
    server.manifestStatus = 404
    const error = await store.getManifest().catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ModelDownloadError)
    expect(error).toMatchObject({ reason: 'manifest', status: 404 })
    server.manifestStatus = 200
    expect((await store.getManifest()).files).toHaveLength(4)
  })

  it('reports a list that is not JSON (a page served instead) as unusable', async () => {
    const { store, server } = setup({
      fetch: async (input, init) => (input.endsWith('manifest.json') ? new Response('<!doctype html><title>BirdDex</title>') : server.fetch(input, init)),
    })
    await expect(store.getManifest()).rejects.toMatchObject({ name: 'ModelDownloadError', reason: 'manifest' })
  })

  it('falls back to the copy kept from the last time when the network is gone', async () => {
    const { store, make, server } = setup()
    await store.getManifest()
    server.manifestStatus = 500
    const offline = make({
      fetch: async () => {
        throw new TypeError('Failed to fetch')
      },
    })
    expect((await offline.getManifest()).files).toHaveLength(4)
  })

  it('says "offline" when there is no list to fall back on and the phone has no network', async () => {
    const { make } = setup()
    const store = make({
      isOnline: () => false,
      getCaches: () => undefined,
      fetch: async () => {
        throw new TypeError('Failed to fetch')
      },
    })
    await expect(store.getManifest()).rejects.toMatchObject({ reason: 'offline' })
  })
})

describe('getModelBytes', () => {
  it('downloads a file with progress, checks it, and keeps it for later', async () => {
    const { store, server, caches } = setup()
    const progress: [number, number][] = []
    const bytes = await store.getModelBytes('audio', (loaded, total) => progress.push([loaded, total]))
    expect(Array.from(bytes.subarray(0, 100))).toEqual(Array.from(audio.bytes.subarray(0, 100)))
    expect(bytes.length).toBe(70_000)
    expect(sha256(bytes)).toBe(sha256(audio.bytes))

    expect(progress[0]).toEqual([0, 70_000])
    expect(progress.at(-1)).toEqual([70_000, 70_000])
    expect(progress.length).toBeGreaterThan(3)
    for (let i = 1; i < progress.length; i++) expect(progress[i][0]).toBeGreaterThanOrEqual(progress[i - 1][0])

    expect(server.requestsFor('audio.tflite')).toHaveLength(1)
    const stored = modelCache(caches)?.entries.get(`${BASE}audio.tflite`)
    expect(stored?.bytes.length).toBe(70_000)
    expect(stored?.headers).toContainEqual(['x-birddex-sha256', sha256(audio.bytes)])
  })

  it('reports progress a hundred times at most per file, however many chunks arrive', async () => {
    const big = bytesFor(1_500_000, 5)
    const { store, server } = setup({}, [...FILES, { id: 'big', file: 'big.bin', bytes: big, label: 'Big' }])
    server.script('big.bin', { chunk: 1000 })
    const progress: number[] = []
    await store.getModelBytes('big', (loaded) => progress.push(loaded))
    expect(progress[0]).toBe(0)
    expect(progress.at(-1)).toBe(1_500_000)
    expect(progress.length).toBeGreaterThan(50)
    expect(progress.length).toBeLessThan(260)
    for (let i = 1; i < progress.length; i++) expect(progress[i]).toBeGreaterThan(progress[i - 1])
  })

  it('asks for an address that changes with the file, so no cache on the way can serve an old version', async () => {
    const { store, server } = setup()
    await store.getModelBytes('geo')
    expect(server.requestsFor('geo.tflite')[0].url).toBe(`${BASE}geo.tflite?v=${sha256(FILES[1].bytes).slice(0, 16)}`)
  })

  it('does not use the network again once the file is on the phone, not even after the app restarts', async () => {
    const { store, make, server } = setup()
    await store.getModelBytes('audio')
    const progress: [number, number][] = []
    const again = await store.getModelBytes('audio', (loaded, total) => progress.push([loaded, total]))
    expect(again.length).toBe(70_000)
    expect(progress).toEqual([[70_000, 70_000]])

    const restarted = make()
    expect((await restarted.getModelBytes('audio')).length).toBe(70_000)
    expect(server.requestsFor('audio.tflite')).toHaveLength(1)
  })

  it('works offline once the files are on the phone', async () => {
    const { store, make } = setup()
    await store.getModelBytes('audio')
    await store.getModelBytes('geo')
    const offline = make({
      isOnline: () => false,
      fetch: async () => {
        throw new TypeError('Failed to fetch')
      },
    })
    expect((await offline.getModelBytes('audio')).length).toBe(70_000)
    expect((await offline.getModelBytes('geo')).length).toBe(30_000)
  })

  it('refuses an unknown file', async () => {
    const { store, server } = setup()
    await expect(store.getModelBytes('nope')).rejects.toMatchObject({ name: 'ModelDownloadError', reason: 'unknown-file' })
    expect(server.requestsFor('audio.tflite')).toHaveLength(0)
  })

  it('lets callers who ask for the same file at the same time share one download', async () => {
    const { store, server } = setup()
    const first: number[] = []
    const second: number[] = []
    const [a, b] = await Promise.all([store.getModelBytes('audio', (l) => first.push(l)), store.getModelBytes('audio', (l) => second.push(l))])
    expect(server.requestsFor('audio.tflite')).toHaveLength(1)
    expect(a.length).toBe(b.length)
    expect(first.at(-1)).toBe(70_000)
    expect(second.at(-1)).toBe(70_000)
  })

  it('downloads another file in the meantime without disturbing the first', async () => {
    const { store } = setup()
    const [a, b] = await Promise.all([store.getModelBytes('audio'), store.getModelBytes('weights')])
    expect(sha256(a)).toBe(sha256(FILES[0].bytes))
    expect(sha256(b)).toBe(sha256(FILES[3].bytes))
  })

  it('throws away a kept file that is the wrong version, and downloads the right one', async () => {
    const { store, caches, server } = setup()
    await store.getModelBytes('audio')
    const cache = modelCache(caches)
    const entry = cache?.entries.get(`${BASE}audio.tflite`)
    cache?.entries.set(`${BASE}audio.tflite`, { ...(entry as NonNullable<typeof entry>), headers: [['x-birddex-sha256', 'f'.repeat(64)]] })
    await store.getModelBytes('audio')
    expect(server.requestsFor('audio.tflite')).toHaveLength(2)
  })

  it('downloads again when the kept file has the wrong size', async () => {
    const { store, caches, server } = setup()
    await store.getModelBytes('audio')
    const cache = modelCache(caches)
    const entry = cache?.entries.get(`${BASE}audio.tflite`) as NonNullable<ReturnType<NonNullable<typeof cache>['entries']['get']>>
    cache?.entries.set(`${BASE}audio.tflite`, { ...entry, bytes: entry.bytes.slice(0, 1000) })
    expect((await store.getModelBytes('audio')).length).toBe(70_000)
    expect(server.requestsFor('audio.tflite')).toHaveLength(2)
  })
})

describe('getModelBytes and a bad connection', () => {
  it('resumes a download that broke off, asking only for the rest', async () => {
    const { store, server } = setup()
    server.script('audio.tflite', { cutAfter: 30_000 })
    const progress: number[] = []
    const bytes = await store.getModelBytes('audio', (loaded) => progress.push(loaded))
    expect(sha256(bytes)).toBe(sha256(audio.bytes))
    const requests = server.requestsFor('audio.tflite')
    expect(requests).toHaveLength(2)
    expect(requests[0].headers.range).toBeUndefined()
    expect(requests[1].headers.range).toBe('bytes=30000-')
    // The progress never goes backwards when resuming.
    for (let i = 1; i < progress.length; i++) expect(progress[i]).toBeGreaterThanOrEqual(progress[i - 1])
  })

  it('resumes after a download that ended early without an error', async () => {
    const { store, server } = setup()
    server.script('audio.tflite', { cutAfter: 12_345, cutMode: 'close' })
    expect(sha256(await store.getModelBytes('audio'))).toBe(sha256(audio.bytes))
    expect(server.requestsFor('audio.tflite')[1].headers.range).toBe('bytes=12345-')
  })

  it('starts again from the beginning when the server ignores the resume request', async () => {
    const { store, server } = setup()
    server.script('audio.tflite', { cutAfter: 20_000 }, { ignoreRange: true })
    expect(sha256(await store.getModelBytes('audio'))).toBe(sha256(audio.bytes))
    expect(server.requestsFor('audio.tflite')).toHaveLength(2)
  })

  it('starts again when the server cannot resume (416)', async () => {
    const { store, server } = setup()
    server.script('audio.tflite', { cutAfter: 20_000 }, { status: 416 })
    expect(sha256(await store.getModelBytes('audio'))).toBe(sha256(audio.bytes))
    expect(server.requestsFor('audio.tflite')).toHaveLength(3)
    expect(server.requestsFor('audio.tflite')[2].headers.range).toBeUndefined()
  })

  it('tries again after a busy server (503, 429)', async () => {
    const { store, server } = setup()
    server.script('geo.tflite', { status: 503 }, { status: 429 })
    expect(sha256(await store.getModelBytes('geo'))).toBe(sha256(FILES[1].bytes))
    expect(server.requestsFor('geo.tflite')).toHaveLength(3)
  })

  it('tries again after the connection fails to open', async () => {
    const { store, server } = setup()
    server.script('geo.tflite', { networkError: true })
    expect(sha256(await store.getModelBytes('geo'))).toBe(sha256(FILES[1].bytes))
    expect(server.requestsFor('geo.tflite')).toHaveLength(2)
  })

  it('gives up on a server that keeps failing, with the status in the error', async () => {
    const { store, server } = setup()
    server.script('geo.tflite', { status: 503 }, { status: 503 }, { status: 503 }, { status: 503 })
    const error = await store.getModelBytes('geo').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ModelDownloadError)
    expect(error).toMatchObject({ reason: 'http', status: 503, fileId: 'geo' })
    expect(server.requestsFor('geo.tflite')).toHaveLength(3)
  })

  it('does not retry a file that is not there (404)', async () => {
    const { store, server } = setup()
    server.script('geo.tflite', { status: 404 })
    await expect(store.getModelBytes('geo')).rejects.toMatchObject({ name: 'ModelDownloadError', reason: 'http', status: 404 })
    expect(server.requestsFor('geo.tflite')).toHaveLength(1)
  })

  it('reports a connection that never works as a network problem', async () => {
    const { store, server } = setup()
    server.script('geo.tflite', { networkError: true }, { networkError: true }, { networkError: true })
    await expect(store.getModelBytes('geo')).rejects.toMatchObject({ name: 'ModelDownloadError', reason: 'network' })
  })

  it('reports a connection that keeps ending early as incomplete', async () => {
    const { store, server } = setup()
    server.script('geo.tflite', { cutAfter: 100, cutMode: 'close' }, { cutAfter: 100, cutMode: 'close' }, { cutAfter: 100, cutMode: 'close' })
    await expect(store.getModelBytes('geo')).rejects.toMatchObject({ name: 'ModelDownloadError', reason: 'incomplete' })
  })

  it('says "offline" without even trying when the phone has no network', async () => {
    const { make, server } = setup()
    const store = make({ isOnline: () => false })
    await expect(store.getModelBytes('audio')).rejects.toMatchObject({ name: 'ModelDownloadError', reason: 'offline', fileId: 'audio' })
    expect(server.requestsFor('audio.tflite')).toHaveLength(0)
  })

  it('says "offline" when the network drops in the middle of a download, and does not keep retrying', async () => {
    let online = true
    const { make, server } = setup()
    const store = make({ isOnline: () => online })
    server.script('audio.tflite', { cutAfter: 20_000 })
    const error = await store
      .getModelBytes('audio', (loaded) => {
        if (loaded > 0) online = false
      })
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ModelDownloadError)
    expect(error).toMatchObject({ reason: 'offline', fileId: 'audio' })
    expect(server.requestsFor('audio.tflite')).toHaveLength(1)
  })

  it('gives up on a download that stalls, and tries again', async () => {
    const { store, server } = setup({ stallTimeoutMs: 80 })
    server.script('geo.tflite', { hang: 'before-headers' })
    expect(sha256(await store.getModelBytes('geo'))).toBe(sha256(FILES[1].bytes))
    expect(server.requestsFor('geo.tflite')).toHaveLength(2)
  })

  it('gives up on a stream that stalls halfway, and resumes', async () => {
    const { store, server } = setup({ stallTimeoutMs: 80 })
    server.script('audio.tflite', { hang: 'in-body', chunk: 10_000 })
    expect(sha256(await store.getModelBytes('audio'))).toBe(sha256(audio.bytes))
    const requests = server.requestsFor('audio.tflite')
    expect(requests).toHaveLength(2)
    expect(requests[1].headers.range).toBe('bytes=10000-')
  })
})

describe('getModelBytes and damaged files', () => {
  it('downloads a damaged file again and succeeds when the second copy is good', async () => {
    const { store, server, caches } = setup()
    const damaged = audio.bytes.slice()
    damaged[500] ^= 0xff
    server.script('audio.tflite', { bytes: damaged })
    expect(sha256(await store.getModelBytes('audio'))).toBe(sha256(audio.bytes))
    expect(server.requestsFor('audio.tflite')).toHaveLength(2)
    expect(modelCache(caches)?.entries.has(`${BASE}audio.tflite`)).toBe(true)
  })

  it('throws a ModelChecksumError when the file stays wrong, and keeps nothing', async () => {
    const { store, server, caches } = setup()
    const damaged = audio.bytes.slice()
    damaged[500] ^= 0xff
    server.script('audio.tflite', { bytes: damaged }, { bytes: damaged }, { bytes: damaged })
    const error = await store.getModelBytes('audio').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ModelChecksumError)
    expect(error).toBeInstanceOf(ModelStoreError)
    expect(error).toMatchObject({ expected: sha256(audio.bytes), actual: sha256(damaged), fileId: 'audio' })
    expect(modelCache(caches)?.entries.size ?? 0).toBeLessThanOrEqual(1) // at most the model list
    expect(modelCache(caches)?.entries.has(`${BASE}audio.tflite`)).toBeFalsy()
  })

  it('stops at once when the server sends more than the file should hold (a wrong file)', async () => {
    const { store, server } = setup()
    server.script('geo.tflite', { bytes: bytesFor(60_000, 9) })
    await expect(store.getModelBytes('geo')).rejects.toBeInstanceOf(ModelChecksumError)
    expect(server.requestsFor('geo.tflite')).toHaveLength(1)
  })
})

describe('getModelBytes and the phone running out of room', () => {
  it('throws a ModelStorageFullError when the phone refuses to keep the file', async () => {
    const { store, caches } = setup()
    await store.getManifest()
    const cache = await caches.open(MODEL_CACHE_NAME)
    cache.failNextPut = new DOMException('no room', 'QuotaExceededError')
    const error = await store.getModelBytes('audio').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ModelStorageFullError)
    expect(error).toMatchObject({ fileId: 'audio', neededBytes: 70_000 })
    expect(cache.entries.has(`${BASE}audio.tflite`)).toBe(false)
    // Once there is room again, a new try works.
    expect((await store.getModelBytes('audio')).length).toBe(70_000)
  })

  it('checks the free space before downloading anything', async () => {
    const { make, server } = setup()
    const store = make({ estimateStorage: async () => ({ quota: 100_000, usage: 60_000 }) })
    const error = await store.getModelBytes('audio').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ModelStorageFullError)
    expect(error).toMatchObject({ neededBytes: 70_000, availableBytes: 40_000 })
    expect(server.requestsFor('audio.tflite')).toHaveLength(0)
  })

  it('does not trust an estimate it cannot make sense of', async () => {
    const { make } = setup()
    for (const estimate of [undefined, {}, { quota: 0, usage: 0 }, { quota: Number.NaN, usage: 1 }]) {
      const store = make({ estimateStorage: async () => estimate })
      expect((await store.getModelBytes('geo')).length).toBe(30_000)
    }
    const failing = make({
      estimateStorage: async () => {
        throw new Error('not supported')
      },
    })
    expect((await failing.getModelBytes('geo')).length).toBe(30_000)
  })

  it('still hands over the bytes where Cache Storage does not work, but downloads again next time', async () => {
    const { make, server } = setup()
    const store = make({ getCaches: () => undefined })
    expect((await store.getModelBytes('geo')).length).toBe(30_000)
    expect((await store.getModelBytes('geo')).length).toBe(30_000)
    expect(server.requestsFor('geo.tflite')).toHaveLength(2)
    expect((await store.getStatus()).persistent).toBe(false)
  })

  it('still hands over the bytes when Cache Storage fails for another reason', async () => {
    const { store, caches } = setup()
    await store.getManifest()
    const cache = await caches.open(MODEL_CACHE_NAME)
    cache.failNextPut = new DOMException('blocked', 'SecurityError')
    expect((await store.getModelBytes('geo')).length).toBe(30_000)
    expect((await store.getStatus()).persistent).toBe(false)
  })

  it('treats a Cache Storage that throws on open like an empty one', async () => {
    const { make } = setup()
    const store = make({
      getCaches: () =>
        ({
          open: async () => {
            throw new DOMException('denied', 'SecurityError')
          },
        }) as unknown as CacheStorage,
    })
    expect((await store.getModelBytes('geo')).length).toBe(30_000)
  })
})

describe('ensureModels', () => {
  const photoSet = ['graph', 'weights']

  it('downloads the missing files one after the other with one combined progress', async () => {
    const { store, server } = setup()
    const events: ModelProgress[] = []
    await store.ensureModels(photoSet, { modelId: 'photo', onProgress: (p) => events.push(p) })
    expect(events[0]).toEqual({ modelId: 'photo', stage: 'downloading', loadedBytes: 0, totalBytes: 70_000 })
    expect(events.at(-1)).toEqual({ modelId: 'photo', stage: 'downloading', loadedBytes: 70_000, totalBytes: 70_000 })
    expect(events.every((p) => p.modelId === 'photo' && p.stage === 'downloading' && p.totalBytes === 70_000)).toBe(true)
    for (let i = 1; i < events.length; i++) expect(events[i].loadedBytes).toBeGreaterThanOrEqual(events[i - 1].loadedBytes)
    // Sequential: the second file is not requested before the first one has arrived.
    const order = server.requests.filter((r) => r.path !== 'manifest.json').map((r) => r.path)
    expect(order).toEqual(['photo.onnx', 'photo.data'])
    expect(await store.isCached(photoSet)).toBe(true)
  })

  it('counts the files that are already there, and skips them', async () => {
    const { store, server } = setup()
    await store.getModelBytes('graph')
    const events: ModelProgress[] = []
    await store.ensureModels(photoSet, { onProgress: (p) => events.push(p) })
    expect(events[0]).toMatchObject({ modelId: 'graph+weights', loadedBytes: 20_000, totalBytes: 70_000 })
    expect(events.at(-1)?.loadedBytes).toBe(70_000)
    expect(server.requestsFor('photo.onnx')).toHaveLength(1)
    expect(server.requestsFor('photo.data')).toHaveLength(1)
  })

  it('reports done straight away, and does not touch the network, when everything is already there', async () => {
    const { store, server } = setup()
    await store.ensureModels(photoSet)
    const requestsBefore = server.requests.length
    const events: ModelProgress[] = []
    await store.ensureModels(photoSet, { modelId: 'photo', onProgress: (p) => events.push(p) })
    expect(events).toEqual([{ modelId: 'photo', stage: 'downloading', loadedBytes: 70_000, totalBytes: 70_000 }])
    expect(server.requests.length).toBe(requestsBefore)
  })

  it('works without a progress callback, and with the same id twice', async () => {
    const { store } = setup()
    await store.ensureModels(['geo', 'geo'])
    expect(await store.isCached(['geo'])).toBe(true)
  })

  it('fails with "offline" before downloading when the phone has no network', async () => {
    const { make, server } = setup()
    const store = make({ isOnline: () => false })
    await expect(store.ensureModels(photoSet)).rejects.toMatchObject({ name: 'ModelDownloadError', reason: 'offline' })
    expect(server.requests.filter((r) => r.path !== 'manifest.json')).toHaveLength(0)
  })

  it('fails with a ModelStorageFullError before downloading when the missing files do not fit', async () => {
    const { make, server } = setup()
    const store = make({ estimateStorage: async () => ({ quota: 100_000, usage: 50_000 }) })
    await expect(store.ensureModels(photoSet)).rejects.toBeInstanceOf(ModelStorageFullError)
    expect(server.requests.filter((r) => r.path !== 'manifest.json')).toHaveLength(0)
  })

  it('stops at the first file that cannot be downloaded', async () => {
    const { store, server } = setup()
    server.script('photo.onnx', { status: 404 })
    await expect(store.ensureModels(photoSet)).rejects.toMatchObject({ reason: 'http', status: 404 })
    expect(server.requestsFor('photo.data')).toHaveLength(0)
  })

  it('rejects an unknown file name', async () => {
    const { store } = setup()
    await expect(store.ensureModels(['graph', 'ghost'])).rejects.toMatchObject({ reason: 'unknown-file' })
  })
})

describe('planDownload and isCached', () => {
  it('tells how much is still missing', async () => {
    const { store } = setup()
    expect(await store.planDownload(['audio', 'geo'])).toMatchObject({ totalBytes: 100_000, missingBytes: 100_000 })
    await store.getModelBytes('audio')
    const plan = await store.planDownload(['audio', 'geo'])
    expect(plan).toMatchObject({ totalBytes: 100_000, missingBytes: 30_000 })
    expect(plan.missing.map((file) => file.id)).toEqual(['geo'])
    expect(await store.isCached(['audio'])).toBe(true)
    expect(await store.isCached(['audio', 'geo'])).toBe(false)
  })
})

describe('status', () => {
  it('starts with everything missing, and follows the downloads', async () => {
    const { store } = setup()
    const first = await store.getStatus()
    expect(first).toMatchObject({ state: 'missing', totalBytes: 170_000, readyBytes: 0, persistent: true })
    expect(first.files.map((file) => file.state)).toEqual(['missing', 'missing', 'missing', 'missing'])

    await store.getModelBytes('audio')
    const partial = await store.getStatus()
    expect(partial.state).toBe('partial')
    expect(partial.readyBytes).toBe(70_000)
    expect(partial.files[0]).toMatchObject({ id: 'audio', state: 'ready', loadedBytes: 70_000, label: 'Audio model' })

    await store.ensureModels(['geo', 'graph', 'weights'])
    expect(await store.getStatus()).toMatchObject({ state: 'ready', readyBytes: 170_000 })
  })

  it('notifies listeners about the download as it happens', async () => {
    const { store } = setup()
    await store.getManifest()
    const seen: ModelStoreStatus[] = []
    const stop = store.subscribe((status) => seen.push(status))
    await store.getModelBytes('audio')
    stop()

    expect(seen[0].state).toBe('downloading')
    expect(seen[0].files[0]).toMatchObject({ id: 'audio', state: 'downloading' })
    const last = seen.at(-1) as ModelStoreStatus
    expect(last.state).toBe('partial')
    expect(last.files[0]).toMatchObject({ state: 'ready', loadedBytes: 70_000 })
    const loaded = seen.map((status) => status.files[0].loadedBytes)
    for (let i = 1; i < loaded.length; i++) expect(loaded[i]).toBeGreaterThanOrEqual(i === loaded.length - 1 ? 0 : loaded[i - 1])

    const count = seen.length
    await store.getModelBytes('geo')
    expect(seen.length).toBe(count)
  })

  it('shows a failed download with its error, until the next try works', async () => {
    const { store, server } = setup()
    server.script('geo.tflite', { status: 404 })
    await store.getModelBytes('geo').catch(() => undefined)
    const failed = await store.getStatus()
    expect(failed.state).toBe('failed')
    expect(failed.files[1]).toMatchObject({ id: 'geo', state: 'failed' })
    expect(failed.files[1].error).toBeInstanceOf(ModelDownloadError)

    await store.getModelBytes('geo')
    const fixed = await store.getStatus()
    expect(fixed.files[1].state).toBe('ready')
    expect(fixed.state).toBe('partial')
  })

  it('is "unavailable" when the model list cannot be read', async () => {
    const { store, server } = setup()
    server.manifestStatus = 404
    const status = await store.getStatus()
    expect(status).toMatchObject({ state: 'unavailable', files: [], totalBytes: 0 })
    expect(status.error).toBeInstanceOf(ModelDownloadError)
  })

  it('sees files that were downloaded by an earlier run of the app', async () => {
    const { store, make } = setup()
    await store.ensureModels(['audio', 'geo'])
    expect(await make().getStatus()).toMatchObject({ state: 'partial', readyBytes: 100_000 })
  })
})

describe('deleteCached', () => {
  it('frees the space and forgets the files', async () => {
    const { store, caches, server } = setup()
    await store.ensureModels(['audio', 'geo'])
    expect((await store.getStatus()).state).toBe('partial')

    const seen: ModelStoreStatus[] = []
    store.subscribe((status) => seen.push(status))
    await store.deleteCached()
    expect(caches.caches.has(MODEL_CACHE_NAME)).toBe(false)
    expect((await store.getStatus()).state).toBe('missing')
    // Looking at the status must not bring back an empty cache.
    expect(caches.caches.has(MODEL_CACHE_NAME)).toBe(false)
    expect(await store.planDownload(['audio'])).toMatchObject({ missingBytes: 70_000 })
    expect(caches.caches.has(MODEL_CACHE_NAME)).toBe(false)
    expect(seen.at(-1)?.state).toBe('missing')

    await store.getModelBytes('audio')
    expect(server.requestsFor('audio.tflite')).toHaveLength(2)
  })

  it('also empties the service worker\'s copy of the model files, but not its model list', async () => {
    const { store, caches } = setup()
    const worker = await caches.open('birddex-heavy-v1')
    await worker.put(`${BASE}audio.tflite?v=abc`, new Response('x'))
    await worker.put(`${BASE}geo.tflite`, new Response('x'))
    await worker.put(`${BASE}manifest.json`, new Response('{}'))
    await worker.put('https://birddex.test/app/vendor/ort/ort.mjs', new Response('x'))
    await store.deleteCached()
    expect([...worker.entries.keys()].sort()).toEqual(['https://birddex.test/app/models/manifest.json', 'https://birddex.test/app/vendor/ort/ort.mjs'])
  })

  it('does not fail when there is nothing to delete or no Cache Storage', async () => {
    const { make } = setup()
    await expect(make().deleteCached()).resolves.toBeUndefined()
    await expect(make({ getCaches: () => undefined }).deleteCached()).resolves.toBeUndefined()
  })

  it('does not put back a file whose download was running while the models were deleted', async () => {
    const { store, server, caches } = setup()
    await store.getManifest()
    let release: () => void = () => undefined
    server.script('audio.tflite', { gate: new Promise<void>((resolve) => (release = resolve)) })
    const slow = store.getModelBytes('audio')
    await vi.waitFor(() => expect(server.requestsFor('audio.tflite')).toHaveLength(1))
    await store.deleteCached()
    release()
    // The caller still gets the bytes it asked for, but the phone does not keep them.
    expect((await slow).length).toBe(70_000)
    expect(modelCache(caches)?.entries.has(`${BASE}audio.tflite`) ?? false).toBe(false)
    expect((await store.getStatus()).state).toBe('missing')
  })
})

describe('ModelStoreError classes', () => {
  it('can be told apart and share a base class', () => {
    const download = new ModelDownloadError('a', { reason: 'offline' })
    const checksum = new ModelChecksumError('b', { expected: 'x', actual: 'y' })
    const full = new ModelStorageFullError('c')
    for (const error of [download, checksum, full]) {
      expect(error).toBeInstanceOf(Error)
      expect(error).toBeInstanceOf(ModelStoreError)
    }
    expect([download.name, checksum.name, full.name]).toEqual(['ModelDownloadError', 'ModelChecksumError', 'ModelStorageFullError'])
    expect(download).not.toBeInstanceOf(ModelChecksumError)
    expect(new ModelDownloadError('d', { reason: 'http', status: 500, cause: new Error('x') }).cause).toBeInstanceOf(Error)
  })
})

describe('served helpers behave', () => {
  it('serves ranges like a real server (guards the tests above)', async () => {
    const { server } = setup()
    const response = await server.fetch(`${BASE}geo.tflite`, { headers: { Range: 'bytes=100-' } })
    expect(response.status).toBe(206)
    expect(response.headers.get('Content-Range')).toBe('bytes 100-29999/30000')
    expect((await response.arrayBuffer()).byteLength).toBe(29_900)
    const cut: Served = { cutAfter: 10, cutMode: 'close' }
    server.script('geo.tflite', cut)
    expect((await (await server.fetch(`${BASE}geo.tflite`)).arrayBuffer()).byteLength).toBe(10)
  })
})
