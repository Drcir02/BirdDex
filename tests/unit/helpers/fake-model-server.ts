// Test helpers for the model store: an in-memory Cache Storage, and a fake web server for model files that can
// misbehave on purpose (break off, stall, answer with errors, ignore Range requests, send damaged bytes).

import { createHash } from 'node:crypto'

const keyOf = (request: RequestInfo | URL): string =>
  typeof request === 'string' ? request : request instanceof URL ? request.href : request.url

export class FakeCache {
  readonly entries = new Map<string, { bytes: Uint8Array; headers: [string, string][]; status: number }>()
  readonly puts: string[] = []
  /** Throw this from the next put(), for example a QuotaExceededError. */
  failNextPut: unknown

  async match(request: RequestInfo | URL): Promise<Response | undefined> {
    const entry = this.entries.get(keyOf(request))
    return entry ? new Response(entry.bytes.slice(), { status: entry.status, headers: entry.headers }) : undefined
  }

  async put(request: RequestInfo | URL, response: Response): Promise<void> {
    if (this.failNextPut) {
      const error = this.failNextPut
      this.failNextPut = undefined
      throw error
    }
    const bytes = new Uint8Array(await response.arrayBuffer())
    this.entries.set(keyOf(request), { bytes, headers: [...response.headers.entries()], status: response.status })
    this.puts.push(keyOf(request))
  }

  async delete(request: RequestInfo | URL): Promise<boolean> {
    return this.entries.delete(keyOf(request))
  }

  async keys(): Promise<Request[]> {
    return [...this.entries.keys()].map((url) => new Request(url))
  }
}

export class FakeCacheStorage {
  readonly caches = new Map<string, FakeCache>()

  async open(name: string): Promise<FakeCache> {
    let cache = this.caches.get(name)
    if (!cache) {
      cache = new FakeCache()
      this.caches.set(name, cache)
    }
    return cache
  }

  async has(name: string): Promise<boolean> {
    return this.caches.has(name)
  }

  async delete(name: string): Promise<boolean> {
    return this.caches.delete(name)
  }

  async keys(): Promise<string[]> {
    return [...this.caches.keys()]
  }

  asCacheStorage(): CacheStorage {
    return this as unknown as CacheStorage
  }
}

export const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

/** Predictable bytes that differ per seed. */
export const bytesFor = (length: number, seed: number) => Uint8Array.from({ length }, (_, i) => (i * 37 + seed * 101 + (i >> 9)) & 0xff)

export interface Served {
  /** Pretend the connection breaks after this many bytes of the answer. */
  cutAfter?: number
  /** How it breaks: an error on the stream (default) or a clean but early end. */
  cutMode?: 'error' | 'close'
  /** Send these bytes instead of the real ones (same length unless you say otherwise). */
  bytes?: Uint8Array
  /** Ignore a Range header and send the whole file with status 200. */
  ignoreRange?: boolean
  /** Answer with this status and an empty body. */
  status?: number
  /** Never send anything until the request is aborted. */
  hang?: 'before-headers' | 'in-body'
  /** Make fetch itself fail, as it does without a network. */
  networkError?: boolean
  chunk?: number
  /** Hold back the first bytes until this promise resolves. */
  gate?: Promise<void>
}

export interface Request1 {
  url: string
  path: string
  headers: Record<string, string>
  signal?: AbortSignal | null
}

export class FakeServer {
  readonly requests: Request1[] = []
  /** What to do with successive requests for each file name. A file with an empty script is served normally. */
  private scripts = new Map<string, Served[]>()
  readonly files = new Map<string, Uint8Array>()
  /** What to answer for manifest.json. Set `manifestStatus` to fail it. */
  manifestBody: unknown
  manifestStatus = 200

  constructor(private readonly base: string) {}

  add(file: string, bytes: Uint8Array): void {
    this.files.set(file, bytes)
  }

  /** The next requests for `file` are handled by these, in order. */
  script(file: string, ...behaviours: Served[]): void {
    this.scripts.set(file, behaviours)
  }

  requestsFor(file: string): Request1[] {
    return this.requests.filter((request) => request.path === file)
  }

  fetch = async (input: string, init?: RequestInit): Promise<Response> => {
    const url = new URL(input)
    const path = url.href.slice(this.base.length).split('?')[0]
    const headers: Record<string, string> = {}
    new Headers(init?.headers).forEach((value, key) => {
      headers[key] = value
    })
    this.requests.push({ url: input, path, headers, signal: init?.signal })

    if (path === 'manifest.json') {
      if (this.manifestStatus !== 200) return new Response('missing', { status: this.manifestStatus })
      return new Response(JSON.stringify(this.manifestBody), { headers: { 'content-type': 'application/json' } })
    }
    const real = this.files.get(path)
    if (!real) return new Response('not found', { status: 404 })

    const behaviour = this.scripts.get(path)?.shift() ?? {}
    if (behaviour.networkError) throw new TypeError('Failed to fetch')
    if (behaviour.hang === 'before-headers') {
      return new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')))
      })
    }
    if (behaviour.status !== undefined) return new Response('', { status: behaviour.status })

    const bytes = behaviour.bytes ?? real
    const range = /^bytes=(\d+)-/.exec(headers.range ?? '')
    const honour = range !== null && !behaviour.ignoreRange
    const start = honour ? Number(range[1]) : 0
    if (honour && start >= bytes.length) return new Response('', { status: 416 })
    const body = bytes.subarray(start)
    const chunk = behaviour.chunk ?? 8192
    let sent = 0
    let gated = behaviour.gate === undefined
    const stream = new ReadableStream<Uint8Array>({
      pull: async (controller) => {
        if (!gated) {
          gated = true
          await behaviour.gate
        }
        if (behaviour.hang === 'in-body' && sent > 0) {
          return new Promise<void>((_, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')))
          })
        }
        if (behaviour.cutAfter !== undefined && sent >= behaviour.cutAfter) {
          if (behaviour.cutMode === 'close') controller.close()
          else controller.error(new TypeError('network error'))
          return undefined
        }
        if (sent >= body.length) {
          controller.close()
          return undefined
        }
        const limit = Math.min(chunk, body.length - sent, behaviour.cutAfter !== undefined ? behaviour.cutAfter - sent : Infinity)
        controller.enqueue(body.slice(sent, sent + limit))
        sent += limit
        return undefined
      },
    })
    const responseHeaders = new Headers({ 'content-type': 'application/octet-stream' })
    if (honour) responseHeaders.set('Content-Range', `bytes ${start}-${bytes.length - 1}/${bytes.length}`)
    return new Response(stream, { status: honour ? 206 : 200, headers: responseHeaders })
  }
}
