import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PhotoCacheRecord } from '../../src/db'
import type { Species } from '../../src/domain/types'
import { createLimiter } from '../../src/features/photos/limiter'
import { fetchJson, HttpStatusError, retryAfterMs } from '../../src/features/photos/http'
import {
  BREAKER_PAUSE_MS,
  BREAKER_THRESHOLD,
  FAILURE_COOL_DOWN_MS,
  HIT_TTL_MS,
  MISS_TTL_MS,
  createReferencePhotoService,
  type PhotoCache,
} from '../../src/features/photos/referencePhotos'
import { PhotoLookupError } from '../../src/features/photos/types'

// ---------- A pretend Wikipedia and Commons ----------

const THUMB = 'https://upload.wikimedia.org/wikipedia/commons/thumb/6/6c/Parus_major_2.jpg/330px-Parus_major_2.jpg'
const ORIGINAL = 'https://upload.wikimedia.org/wikipedia/commons/6/6c/Parus_major_2.jpg'

function bird(id: string, wikiTitle: string | null = 'Great tit'): Species {
  return {
    id,
    dexNumber: 1,
    scientificName: id.replace('-', ' ').replace(/^./, (c) => c.toUpperCase()),
    czechName: 'Sýkora koňadra',
    englishName: 'Great Tit',
    family: 'Paridae',
    inCzechia: true,
    inEurope: true,
    rarity: 'common',
    birdnetIndex: 1,
    wingclipIndex: 1,
    wikiTitle,
  }
}

const json = (body: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' }, ...init })

const summaryBody = (thumbnail = THUMB, original = ORIGINAL) => ({
  type: 'standard',
  thumbnail: { source: thumbnail, width: 330, height: 220 },
  originalimage: { source: original },
  content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/Great_tit' } },
})

const creditBody = (meta: Record<string, string>) => ({
  query: { pages: [{ title: 'File:Parus major 2.jpg', imageinfo: [{ extmetadata: Object.fromEntries(Object.entries(meta).map(([k, v]) => [k, { value: v }])) }] }] },
})

const CC_BY_SA = { Artist: '<a href="//commons.wikimedia.org/wiki/User:Foo">Foo Bar</a>', LicenseShortName: 'CC BY-SA 4.0', License: 'cc-by-sa-4.0' }

type Handler = (url: string) => Response | Promise<Response>

/** A fetch that answers from a table by the start of the address and records every call. */
function makeFetch(handler: Handler) {
  const calls: string[] = []
  const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    calls.push(url)
    return handler(url)
  }) as unknown as typeof fetch
  return { fetchImpl, calls }
}

const answers = (credit: Record<string, string> = CC_BY_SA): Handler => (url) => {
  if (url.includes('/page/summary/')) return json(summaryBody())
  if (url.includes('/w/api.php')) return json(creditBody(credit))
  return new Response('?', { status: 500 })
}

function memoryCache(initial: PhotoCacheRecord[] = []) {
  const rows = new Map(initial.map((row) => [row.speciesId, row]))
  const cache: PhotoCache = {
    get: async (id) => rows.get(id),
    put: async (record) => {
      rows.set(record.speciesId, record)
    },
  }
  return { cache, rows }
}

interface Setup {
  fetchImpl: typeof fetch
  clock?: { t: number }
  online?: { value: boolean }
  cache?: PhotoCache
  species?: Species[]
  concurrency?: number
  retries?: number
}

function makeService(setup: Setup) {
  const species = setup.species ?? [bird('parus-major')]
  const clock = setup.clock ?? { t: 1_000_000 }
  const online = setup.online ?? { value: true }
  const sleeps: number[] = []
  const service = createReferencePhotoService({
    fetchImpl: setup.fetchImpl,
    cache: setup.cache ?? memoryCache().cache,
    findSpecies: async (id) => species.find((entry) => entry.id === id),
    now: () => clock.t,
    isOnline: () => online.value,
    sleep: async (ms) => {
      sleeps.push(ms)
    },
    random: () => 0.5,
    concurrency: setup.concurrency,
    retries: setup.retries,
    baseDelayMs: 100,
  })
  return { service, clock, online, sleeps }
}

let consoleError: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
})
afterEach(() => {
  expect(consoleError).not.toHaveBeenCalled()
  vi.restoreAllMocks()
})

// ---------- The service ----------

describe('looking up a photo', () => {
  it('finds the lead picture, its author and its licence, and keeps the answer', async () => {
    const { fetchImpl, calls } = makeFetch(answers())
    const { cache, rows } = memoryCache()
    const { service, clock } = makeService({ fetchImpl, cache })

    expect(service.peek('parus-major')).toBeUndefined()
    const photo = await service.get('parus-major')

    expect(photo).toEqual({
      speciesId: 'parus-major',
      thumbnailUrl: THUMB,
      imageUrl: THUMB.replace('/330px-', '/500px-'),
      author: 'Foo Bar',
      licence: 'CC BY-SA 4.0',
      link: 'https://commons.wikimedia.org/wiki/File:Parus_major_2.jpg',
    })
    expect(calls).toHaveLength(2)
    expect(calls[0]).toBe('https://en.wikipedia.org/api/rest_v1/page/summary/Great_tit')
    expect(calls[1]).toContain('https://commons.wikimedia.org/w/api.php?')
    expect(calls[1]).toContain('origin=*')
    expect(service.peek('parus-major')).toEqual(photo)
    expect(rows.get('parus-major')).toEqual({
      speciesId: 'parus-major',
      thumbnailUrl: THUMB,
      author: 'Foo Bar',
      licence: 'CC BY-SA 4.0',
      link: 'https://commons.wikimedia.org/wiki/File:Parus_major_2.jpg',
      fetchedAt: clock.t,
    })

    // The second question is answered from memory.
    expect(await service.get('parus-major')).toEqual(photo)
    expect(calls).toHaveLength(2)
  })

  it('answers from the saved copy after a restart, with no network', async () => {
    const first = makeFetch(answers())
    const { cache } = memoryCache()
    const a = makeService({ fetchImpl: first.fetchImpl, cache })
    const photo = await a.service.get('parus-major')

    const second = makeFetch(() => {
      throw new Error('the network must not be used')
    })
    const b = makeService({ fetchImpl: second.fetchImpl, cache, clock: a.clock })
    expect(await b.service.get('parus-major')).toEqual(photo)
    expect(second.calls).toHaveLength(0)
  })

  it('accepts CC0 and public domain and shows the public domain name', async () => {
    for (const [credit, name] of [
      [{ LicenseShortName: 'CC0', License: 'cc-zero' }, 'CC0'],
      [{ LicenseShortName: 'Public domain', License: 'pd', Artist: 'NASA' }, 'Public domain'],
      [{ LicenseShortName: 'CC BY 2.0', License: 'cc-by-2.0' }, 'CC BY 2.0'],
    ] as const) {
      const { fetchImpl } = makeFetch(answers(credit))
      const photo = await makeService({ fetchImpl }).service.get('parus-major')
      expect(photo?.licence).toBe(name)
    }
  })

  it.each([
    ['CC BY-NC 2.0', 'cc-by-nc-2.0'],
    ['CC BY-ND 4.0', 'cc-by-nd-4.0'],
    ['GFDL 1.2', 'gfdl'],
    ['Fair use', 'fair-use'],
  ])('shows no photo when the licence is %s, and remembers that', async (shortName, license) => {
    const { fetchImpl, calls } = makeFetch(answers({ LicenseShortName: shortName, License: license }))
    const { cache, rows } = memoryCache()
    const { service } = makeService({ fetchImpl, cache })
    expect(await service.get('parus-major')).toBeNull()
    expect(service.peek('parus-major')).toBeNull()
    expect(rows.get('parus-major')?.thumbnailUrl).toBe('')
    expect(calls).toHaveLength(2)
    expect(await service.get('parus-major')).toBeNull()
    expect(calls).toHaveLength(2)
  })

  it('tries the scientific name when the article under the Wikipedia title does not exist', async () => {
    const { fetchImpl, calls } = makeFetch((url) => {
      if (url.endsWith('/Great_tit')) return new Response('not found', { status: 404 })
      return answers()(url)
    })
    const photo = await makeService({ fetchImpl }).service.get('parus-major')
    expect(photo?.author).toBe('Foo Bar')
    expect(calls[0]).toContain('/Great_tit')
    expect(calls[1]).toContain('/Parus_major')
    expect(calls).toHaveLength(3)
  })

  it('has no photo when the article has no picture, or is a disambiguation page', async () => {
    const { fetchImpl } = makeFetch((url) => (url.includes('/page/summary/') ? json({ type: 'standard', title: 'X' }) : new Response('x', { status: 500 })))
    expect(await makeService({ fetchImpl }).service.get('parus-major')).toBeNull()

    const other = makeFetch((url) => (url.includes('/page/summary/') ? json({ type: 'disambiguation', thumbnail: { source: THUMB } }) : new Response('x', { status: 500 })))
    expect(await makeService({ fetchImpl: other.fetchImpl }).service.get('parus-major')).toBeNull()
  })

  it('has no photo when the picture does not come from Wikimedia (nobody to credit)', async () => {
    const { fetchImpl, calls } = makeFetch((url) =>
      url.includes('/page/summary/') ? json(summaryBody('https://example.com/a/330px-x.jpg', 'https://example.com/a/x.jpg')) : new Response('x', { status: 500 }),
    )
    expect(await makeService({ fetchImpl }).service.get('parus-major')).toBeNull()
    expect(calls.every((url) => url.includes('/page/summary/'))).toBe(true)
  })

  it('has no photo for an id that is not in the Dex, without any request', async () => {
    const { fetchImpl, calls } = makeFetch(answers())
    expect(await makeService({ fetchImpl }).service.get('unknown-bird')).toBeNull()
    expect(calls).toHaveLength(0)
  })

  it('shares one lookup between simultaneous questions', async () => {
    const { fetchImpl, calls } = makeFetch(answers())
    const { service } = makeService({ fetchImpl })
    const [a, b, c] = await Promise.all([service.get('parus-major'), service.get('parus-major'), service.get('parus-major')])
    expect(a).toBe(b)
    expect(b).toBe(c)
    expect(calls).toHaveLength(2)
  })
})

describe('how long answers are kept', () => {
  const stored = (patch: Partial<PhotoCacheRecord>): PhotoCacheRecord => ({
    speciesId: 'parus-major',
    thumbnailUrl: THUMB,
    author: 'Old Author',
    licence: 'CC BY 2.0',
    link: 'https://commons.wikimedia.org/wiki/File:Old.jpg',
    fetchedAt: 1_000_000,
    ...patch,
  })

  it('looks a found photo up again after its time is over', async () => {
    const { fetchImpl, calls } = makeFetch(answers())
    const { cache, rows } = memoryCache([stored({})])
    const { service, clock } = makeService({ fetchImpl, cache })
    clock.t += HIT_TTL_MS - 1000
    expect((await service.get('parus-major'))?.author).toBe('Old Author')
    expect(calls).toHaveLength(0)

    service.reset()
    clock.t += 2000
    expect((await service.get('parus-major'))?.author).toBe('Foo Bar')
    expect(calls).toHaveLength(2)
    expect(rows.get('parus-major')?.fetchedAt).toBe(clock.t)
  })

  it('asks again about a bird without a photo after a week', async () => {
    const { fetchImpl, calls } = makeFetch(answers())
    const { cache } = memoryCache([stored({ thumbnailUrl: '', author: '', licence: '', link: '' })])
    const { service, clock } = makeService({ fetchImpl, cache })
    expect(await service.get('parus-major')).toBeNull()
    expect(calls).toHaveLength(0)

    service.reset()
    clock.t += MISS_TTL_MS + 1
    expect((await service.get('parus-major'))?.author).toBe('Foo Bar')
  })

  it('does not trust a saved answer from the future', async () => {
    const { fetchImpl, calls } = makeFetch(answers())
    const { cache } = memoryCache([stored({ fetchedAt: 1_000_000 + 400 * 24 * 3600 * 1000 })])
    const { service } = makeService({ fetchImpl, cache })
    expect((await service.get('parus-major'))?.author).toBe('Foo Bar')
    expect(calls).toHaveLength(2)
  })

  it('shows an old answer when the phone is offline, and fails clearly when there is none', async () => {
    const { fetchImpl, calls } = makeFetch(answers())
    const { cache } = memoryCache([stored({})])
    const { service, clock, online } = makeService({ fetchImpl, cache })
    online.value = false
    clock.t += HIT_TTL_MS * 2
    expect((await service.get('parus-major'))?.author).toBe('Old Author')
    expect(calls).toHaveLength(0)

    const fresh = makeService({ fetchImpl })
    fresh.online.value = false
    await expect(fresh.service.get('parus-major')).rejects.toMatchObject({ name: 'PhotoLookupError', reason: 'offline' })
    expect(calls).toHaveLength(0)
    expect(fresh.service.peek('parus-major')).toBeUndefined()
  })

  it('keeps working when the saved answers cannot be read or written', async () => {
    const { fetchImpl } = makeFetch(answers())
    const broken: PhotoCache = {
      get: async () => {
        throw new Error('database closed')
      },
      put: async () => {
        throw new Error('disk full')
      },
    }
    const photo = await makeService({ fetchImpl, cache: broken }).service.get('parus-major')
    expect(photo?.author).toBe('Foo Bar')
  })
})

describe('when the network misbehaves', () => {
  it('tries three times with growing pauses, then reports a lookup error and keeps nothing', async () => {
    const { fetchImpl, calls } = makeFetch(() => new Response('busy', { status: 503 }))
    const { cache, rows } = memoryCache()
    const { service, sleeps } = makeService({ fetchImpl, cache })
    await expect(service.get('parus-major')).rejects.toBeInstanceOf(PhotoLookupError)
    expect(calls).toHaveLength(3)
    expect(sleeps).toEqual([100, 200])
    expect(rows.size).toBe(0)
    expect(service.peek('parus-major')).toBeUndefined()
  })

  it('treats a lost connection the same way', async () => {
    const { fetchImpl, calls } = makeFetch(() => {
      throw new TypeError('Failed to fetch')
    })
    const { service } = makeService({ fetchImpl })
    await expect(service.get('parus-major')).rejects.toMatchObject({ reason: 'network' })
    expect(calls).toHaveLength(3)
  })

  it('recovers when the second try works', async () => {
    let tries = 0
    const { fetchImpl } = makeFetch((url) => {
      if (url.includes('/page/summary/') && tries++ === 0) return new Response('busy', { status: 502 })
      return answers()(url)
    })
    const photo = await makeService({ fetchImpl }).service.get('parus-major')
    expect(photo?.author).toBe('Foo Bar')
  })

  it('does not ask again for a while after a failure, unless forced', async () => {
    let up = false
    const { fetchImpl, calls } = makeFetch((url) => (up ? answers()(url) : new Response('busy', { status: 503 })))
    const { service, clock } = makeService({ fetchImpl })
    await expect(service.get('parus-major')).rejects.toBeInstanceOf(PhotoLookupError)
    const before = calls.length

    up = true
    await expect(service.get('parus-major')).rejects.toBeInstanceOf(PhotoLookupError)
    expect(calls).toHaveLength(before)

    clock.t += FAILURE_COOL_DOWN_MS + 1
    expect((await service.get('parus-major'))?.author).toBe('Foo Bar')
  })

  it('a forced question skips the cool-down (the phone came back online)', async () => {
    let up = false
    const { fetchImpl } = makeFetch((url) => (up ? answers()(url) : new Response('busy', { status: 503 })))
    const { service } = makeService({ fetchImpl })
    await expect(service.get('parus-major')).rejects.toBeInstanceOf(PhotoLookupError)
    up = true
    expect((await service.get('parus-major', { force: true }))?.author).toBe('Foo Bar')
  })

  it('does not retry an answer that will not change', async () => {
    const { fetchImpl, calls } = makeFetch((url) => (url.includes('/page/summary/') ? json(summaryBody()) : new Response('forbidden', { status: 403 })))
    const { service } = makeService({ fetchImpl })
    await expect(service.get('parus-major')).rejects.toBeInstanceOf(PhotoLookupError)
    // one summary question, one credit question (403 is final), no retries
    expect(calls).toHaveLength(2)
  })

  it('does not accept an answer that is not JSON as "no photo"', async () => {
    const { fetchImpl } = makeFetch(() => new Response('<html>captive portal</html>', { status: 200 }))
    const { service } = makeService({ fetchImpl })
    await expect(service.get('parus-major')).rejects.toMatchObject({ reason: 'bad-response' })
    expect(service.peek('parus-major')).toBeUndefined()
  })

  it('stops asking for a minute after many failures in a row', async () => {
    const ids = Array.from({ length: BREAKER_THRESHOLD + 2 }, (_, index) => `bird-${index}`)
    const { fetchImpl, calls } = makeFetch(() => new Response('down', { status: 500 }))
    const { service, clock } = makeService({ fetchImpl, species: ids.map((id) => bird(id)), retries: 0 })

    for (const id of ids.slice(0, BREAKER_THRESHOLD)) await expect(service.get(id)).rejects.toMatchObject({ reason: 'network' })
    expect(calls).toHaveLength(BREAKER_THRESHOLD)

    await expect(service.get(ids[BREAKER_THRESHOLD])).rejects.toMatchObject({ reason: 'paused' })
    expect(calls).toHaveLength(BREAKER_THRESHOLD)

    clock.t += BREAKER_PAUSE_MS + 1
    await expect(service.get(ids[BREAKER_THRESHOLD])).rejects.toMatchObject({ reason: 'network' })
    expect(calls).toHaveLength(BREAKER_THRESHOLD + 1)
  })
})

describe('queueing', () => {
  it('never has more than four lookups at the same time', async () => {
    const ids = Array.from({ length: 12 }, (_, index) => `bird-${index}`)
    let running = 0
    let peak = 0
    const gates: Array<() => void> = []
    const { fetchImpl } = makeFetch(async (url) => {
      running += 1
      peak = Math.max(peak, running)
      await new Promise<void>((resolve) => gates.push(resolve))
      running -= 1
      return answers()(url)
    })
    const { service } = makeService({ fetchImpl, species: ids.map((id) => bird(id)) })
    const all = Promise.all(ids.map((id) => service.get(id)))

    // Let every lookup that can start do so, and release the requests one by one.
    for (let guard = 0; guard < 200; guard += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0))
      const gate = gates.shift()
      if (gate) gate()
      else if (guard > 50 && running === 0) break
    }
    const photos = await all
    expect(photos.every((photo) => photo !== null)).toBe(true)
    expect(peak).toBeLessThanOrEqual(4)
    expect(peak).toBeGreaterThan(1)
  })

  it('skips a lookup that nobody waits for any more, before it starts', async () => {
    const gate: { open: () => void } = { open: () => undefined }
    const blocker = new Promise<void>((resolve) => {
      gate.open = resolve
    })
    const { fetchImpl, calls } = makeFetch(async (url) => {
      if (url.includes('Great_tit')) await blocker
      return answers()(url)
    })
    const { service } = makeService({ fetchImpl, species: [bird('first', 'Great tit'), bird('second', 'Blue tit')], concurrency: 1 })

    const first = service.get('first')
    await new Promise((resolve) => setTimeout(resolve, 5))
    const controller = new AbortController()
    const second = service.get('second', { signal: controller.signal })
    second.catch(() => undefined)
    await new Promise((resolve) => setTimeout(resolve, 5))
    controller.abort()
    gate.open()

    await expect(second).rejects.toMatchObject({ name: 'AbortError' })
    expect((await first)?.author).toBe('Foo Bar')
    expect(calls.some((url) => url.includes('Blue_tit'))).toBe(false)
  })

  it('still runs a lookup when only one of two waiters leaves', async () => {
    const { fetchImpl } = makeFetch(answers())
    const { service } = makeService({ fetchImpl })
    const controller = new AbortController()
    const leaving = service.get('parus-major', { signal: controller.signal })
    leaving.catch(() => undefined)
    const staying = service.get('parus-major')
    controller.abort()
    expect((await staying)?.author).toBe('Foo Bar')
  })

  it('refuses at once when the signal is already aborted', async () => {
    const { fetchImpl, calls } = makeFetch(answers())
    const { service } = makeService({ fetchImpl })
    const controller = new AbortController()
    controller.abort()
    await expect(service.get('parus-major', { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
    expect(calls).toHaveLength(0)
  })
})

// ---------- The small tools ----------

describe('createLimiter', () => {
  it('runs the newest waiting task first by default and the oldest first on request', async () => {
    for (const [order, expected] of [
      ['newest', ['a', 'd', 'c', 'b']],
      ['oldest', ['a', 'b', 'c', 'd']],
    ] as const) {
      const limiter = createLimiter(1, { order })
      const started: string[] = []
      const releases: Array<() => void> = []
      const task = (name: string) => () => {
        started.push(name)
        return new Promise<void>((resolve) => releases.push(resolve))
      }
      const done = ['a', 'b', 'c', 'd'].map((name) => limiter.run(task(name)))
      expect(limiter.active).toBe(1)
      expect(limiter.waiting).toBe(3)
      for (let index = 0; index < 4; index += 1) {
        await new Promise((resolve) => setTimeout(resolve, 0))
        releases[index]?.()
      }
      await Promise.all(done)
      expect(started).toEqual(expected)
    }
  })

  it('passes results and errors through and keeps going after a failure', async () => {
    const limiter = createLimiter(2)
    await expect(limiter.run(async () => 7)).resolves.toBe(7)
    await expect(
      limiter.run(async () => {
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')
    await expect(
      limiter.run(() => {
        throw new Error('sync boom')
      }),
    ).rejects.toThrow('sync boom')
    await expect(limiter.run(async () => 'still works')).resolves.toBe('still works')
    expect(limiter.active).toBe(0)
  })

  it('refuses a silly limit', () => {
    expect(() => createLimiter(0)).toThrow(RangeError)
    expect(() => createLimiter(1.5)).toThrow(RangeError)
  })
})

describe('fetchJson', () => {
  it('honours Retry-After and caps the pause', async () => {
    const sleeps: number[] = []
    let calls = 0
    const fetchImpl = (async () => {
      calls += 1
      return calls < 3 ? new Response('slow down', { status: 429, headers: { 'Retry-After': calls === 1 ? '2' : '120' } }) : json({ ok: true })
    }) as typeof fetch
    const result = await fetchJson('https://x.test/', { fetchImpl, sleep: async (ms) => void sleeps.push(ms), maxDelayMs: 8000, retries: 3 })
    expect(result).toEqual({ ok: true })
    expect(sleeps).toEqual([2000, 8000])
  })

  it('gives up on a request that never answers, and tries again', async () => {
    let calls = 0
    const fetchImpl = ((_input: RequestInfo | URL, init?: RequestInit) => {
      calls += 1
      if (calls === 1) {
        // The first try hangs until the timeout aborts it.
        return new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))
      }
      return Promise.resolve(json({ ok: true }))
    }) as typeof fetch
    const sleeps: number[] = []
    const result = await fetchJson('https://x.test/', { fetchImpl, timeoutMs: 20, baseDelayMs: 5, sleep: async (ms) => void sleeps.push(ms), random: () => 0.5 })
    expect(result).toEqual({ ok: true })
    expect(calls).toBe(2)
    expect(sleeps).toEqual([5])
  })

  it('reports a lost connection after the last try when every try times out', async () => {
    const fetchImpl = ((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))) as typeof fetch
    await expect(fetchJson('https://x.test/', { fetchImpl, timeoutMs: 10, retries: 1, sleep: async () => undefined })).rejects.toMatchObject({ name: 'PhotoLookupError', reason: 'network' })
  })

  it('also gives up when the answer starts but its body never ends', async () => {
    let calls = 0
    const fetchImpl = ((_input: RequestInfo | URL, init?: RequestInit) => {
      calls += 1
      const body = new ReadableStream({
        start(controller) {
          if (calls === 1) init?.signal?.addEventListener('abort', () => controller.error(new DOMException('aborted', 'AbortError')))
          else {
            controller.enqueue(new TextEncoder().encode('{"fine":true}'))
            controller.close()
          }
        },
      })
      return Promise.resolve(new Response(body, { status: 200 }))
    }) as typeof fetch
    expect(await fetchJson('https://x.test/', { fetchImpl, timeoutMs: 20, sleep: async () => undefined })).toEqual({ fine: true })
    expect(calls).toBe(2)
  })

  it('gives the status of a final failure', async () => {
    const fetchImpl = (async () => new Response('gone', { status: 404 })) as typeof fetch
    await expect(fetchJson('https://x.test/', { fetchImpl })).rejects.toMatchObject({ name: 'HttpStatusError', status: 404 })
    expect(new HttpStatusError(410, 'u').status).toBe(410)
  })

  it('reads Retry-After as seconds or as a date', () => {
    expect(retryAfterMs('3')).toBe(3000)
    expect(retryAfterMs('0')).toBe(0)
    expect(retryAfterMs(null)).toBeUndefined()
    expect(retryAfterMs('soon')).toBeUndefined()
    expect(retryAfterMs('Thu, 01 Jan 1970 00:00:10 GMT', 4000)).toBe(6000)
    expect(retryAfterMs('Thu, 01 Jan 1970 00:00:01 GMT', 4000)).toBe(0)
  })
})
