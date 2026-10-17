import type { Status } from '../types'

const DB_NAME = 'birddex-fieldcheck'
const STORE = 'chunks'
const CACHE_NAME = 'birddex-fieldcheck'
const META_KEY = 'birddex:fieldcheck:storage'

export const CHUNK_BYTES = 4 * 1024 * 1024
const MB = 1024 * 1024

export interface StorageMeta {
  createdAt: string
  megabytes: number
  chunks: number
  sums: number[]
}

/** Deterministic pseudo-random bytes, so a chunk can be checked after it has been read back. */
export function makeChunk(index: number): ArrayBuffer {
  const words = new Uint32Array(CHUNK_BYTES / 4)
  let x = (Math.imul(index + 1, 2654435761) >>> 0) || 1
  for (let i = 0; i < words.length; i++) {
    x ^= x << 13
    x >>>= 0
    x ^= x >>> 17
    x ^= x << 5
    x >>>= 0
    words[i] = x
  }
  return words.buffer
}

/** Cheap checksum over every 16th word. Enough to notice truncated or missing data. */
export function checksum(buffer: ArrayBuffer): number {
  const words = new Uint32Array(buffer)
  let hash = 2166136261
  for (let i = 0; i < words.length; i += 16) {
    hash ^= words[i]
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

export function humanAge(ms: number): string {
  const minutes = Math.floor(ms / 60000)
  if (minutes < 1) return 'less than a minute'
  if (minutes < 120) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `${hours} h`
  return `${Math.floor(hours / 24)} days`
}

const cacheUrl = (index: number) => `${location.origin}${import.meta.env.BASE_URL}__fieldcheck/${index}`

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function putChunk(db: IDBDatabase, index: number, buffer: ArrayBuffer): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(buffer, index)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}

function getChunk(db: IDBDatabase, index: number): Promise<ArrayBuffer | undefined> {
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE).objectStore(STORE).get(index)
    request.onsuccess = () => resolve(request.result as ArrayBuffer | undefined)
    request.onerror = () => reject(request.error)
  })
}

function countChunks(db: IDBDatabase): Promise<number> {
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE).objectStore(STORE).count()
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function clearChunks(db: IDBDatabase): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).clear()
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

function readMeta(): StorageMeta | undefined {
  try {
    const raw = localStorage.getItem(META_KEY)
    return raw ? (JSON.parse(raw) as StorageMeta) : undefined
  } catch {
    return undefined
  }
}

/** Writes test data to IndexedDB (where catches will live) and Cache Storage (where models will live). */
export async function runStorageWrite(
  megabytes: number,
  onProgress: (writtenBytes: number) => void,
  log: (line: string) => void,
): Promise<Status> {
  const chunks = Math.ceil((megabytes * MB) / CHUNK_BYTES)
  const db = await openDb()
  let written = 0
  try {
    await clearChunks(db)
    await caches.delete(CACHE_NAME)
    localStorage.removeItem(META_KEY)
    const cache = await caches.open(CACHE_NAME)
    const sums: number[] = []
    const started = performance.now()
    for (let i = 0; i < chunks; i++) {
      const buffer = makeChunk(i)
      sums.push(checksum(buffer))
      await putChunk(db, i, buffer)
      await cache.put(cacheUrl(i), new Response(buffer, { headers: { 'content-type': 'application/octet-stream' } }))
      written += CHUNK_BYTES
      onProgress(written)
    }
    localStorage.setItem(META_KEY, JSON.stringify({ createdAt: new Date().toISOString(), megabytes, chunks, sums } satisfies StorageMeta))
    log(`Wrote ${Math.round(written / MB)} MB to IndexedDB and to Cache Storage in ${((performance.now() - started) / 1000).toFixed(1)} s`)
    log('Next: press Verify, then close the app completely, reopen it, and look at this card again. Check again tomorrow too.')
    return 'pass'
  } catch (error) {
    const reason = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
    log(`Stopped after ${Math.round(written / MB)} of ${megabytes} MB: ${reason}`)
    return 'fail'
  } finally {
    db.close()
  }
}

/** Quick look (no big reads) at what is left of an earlier test. Runs when the page opens. */
export async function inspectStorage(): Promise<{ status: Status; lines: string[] }> {
  const meta = readMeta()
  if (!meta) return { status: 'idle', lines: ['No test data written yet.'] }
  const db = await openDb()
  try {
    const inDb = await countChunks(db)
    const inCache = 'caches' in self ? (await (await caches.open(CACHE_NAME)).keys()).length : 0
    const age = humanAge(Date.now() - Date.parse(meta.createdAt))
    const intact = inDb === meta.chunks && inCache === meta.chunks
    return {
      status: intact ? 'pass' : 'fail',
      lines: [
        `Earlier test: ${meta.megabytes} MB written ${age} ago.`,
        `Still there: ${inDb}/${meta.chunks} pieces in IndexedDB, ${inCache}/${meta.chunks} in Cache Storage.` + (intact ? '' : ' DATA WAS LOST.'),
      ],
    }
  } finally {
    db.close()
  }
}

/** Reads every piece back and compares checksums. */
export async function verifyStorage(onProgress: (readBytes: number) => void, log: (line: string) => void): Promise<Status> {
  const meta = readMeta()
  if (!meta) {
    log('Nothing to verify. Write test data first.')
    return 'warn'
  }
  const db = await openDb()
  try {
    const cache = await caches.open(CACHE_NAME)
    let bad = 0
    let read = 0
    for (let i = 0; i < meta.chunks; i++) {
      const fromDb = await getChunk(db, i)
      const response = await cache.match(cacheUrl(i))
      const fromCache = response ? await response.arrayBuffer() : undefined
      if (!fromDb || checksum(fromDb) !== meta.sums[i]) bad++
      if (!fromCache || checksum(fromCache) !== meta.sums[i]) bad++
      read += CHUNK_BYTES
      onProgress(read)
    }
    if (bad === 0) {
      log(`All ${meta.chunks} pieces read back correctly from both places.`)
      return 'pass'
    }
    log(`${bad} pieces were missing or damaged.`)
    return 'fail'
  } catch (error) {
    log(`Failed: ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`)
    return 'fail'
  } finally {
    db.close()
  }
}

export async function requestPersistence(log: (line: string) => void): Promise<Status> {
  if (!navigator.storage?.persist) {
    log('Persistent storage request is not supported here.')
    return 'warn'
  }
  const granted = await navigator.storage.persist()
  log(`Persistent storage ${granted ? 'granted' : 'not granted'} (the browser may grant it only to installed apps or after some use).`)
  return granted ? 'pass' : 'warn'
}
