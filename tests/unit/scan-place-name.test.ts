import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  forgetPlaceNames,
  lookupPlaceName,
  parsePlaceName,
  placeLookupUrl,
  rememberedPlaceName,
  rememberPlaceName,
  resolvePlaceName,
} from '../../src/features/scan/placeName'

describe('placeLookupUrl', () => {
  it('asks in Czech and sends only a coarse position (two decimals, about a kilometre)', () => {
    const url = new URL(placeLookupUrl({ lat: 50.083333, lon: 14.433333 }))
    expect(url.origin).toBe('https://nominatim.openstreetmap.org')
    expect(url.pathname).toBe('/reverse')
    expect(url.searchParams.get('lat')).toBe('50.08')
    expect(url.searchParams.get('lon')).toBe('14.43')
    expect(url.searchParams.get('accept-language')).toBe('cs')
    expect(url.searchParams.get('format')).toBe('jsonv2')
  })

  it('does not leak the exact position in any part of the address', () => {
    const text = placeLookupUrl({ lat: 50.123456789, lon: 14.987654321 })
    expect(text).not.toContain('123456')
    expect(text).not.toContain('987654')
  })
})

describe('parsePlaceName', () => {
  it('takes the village, town or city of the address', () => {
    expect(parsePlaceName({ address: { city: 'Praha', suburb: 'Libeň', county: 'okres Praha' } })).toBe('Praha')
    expect(parsePlaceName({ address: { village: 'Hostivice', county: 'okres Praha-západ' } })).toBe('Hostivice')
    expect(parsePlaceName({ address: { town: 'Beroun', county: 'okres Beroun' } })).toBe('Beroun')
  })

  it('prefers the smallest place of the village, town, city kinds', () => {
    expect(parsePlaceName({ address: { hamlet: 'Lhotka', city: 'Praha' } })).toBe('Lhotka')
  })

  it('falls back to the municipality, the suburb, the county and finally the name', () => {
    expect(parsePlaceName({ address: { municipality: 'Obec X', county: 'okres Y' } })).toBe('Obec X')
    expect(parsePlaceName({ address: { suburb: 'Libeň' } })).toBe('Libeň')
    expect(parsePlaceName({ address: { county: 'okres Y' } })).toBe('okres Y')
    expect(parsePlaceName({ address: {}, name: 'Stromovka' })).toBe('Stromovka')
  })

  it('cleans up the text and cuts a very long one', () => {
    expect(parsePlaceName({ address: { city: '  Brno \n ' } })).toBe('Brno')
    const long = parsePlaceName({ address: { city: 'x'.repeat(300) } })
    expect(long?.length).toBeLessThanOrEqual(80)
    expect(long?.endsWith('…')).toBe(true)
  })

  it('says nothing for answers that name no place', () => {
    expect(parsePlaceName(undefined)).toBeUndefined()
    expect(parsePlaceName(null)).toBeUndefined()
    expect(parsePlaceName('Praha')).toBeUndefined()
    expect(parsePlaceName({})).toBeUndefined()
    expect(parsePlaceName({ error: 'Unable to geocode' })).toBeUndefined()
    expect(parsePlaceName({ address: { city: '   ', town: 42 } })).toBeUndefined()
  })
})

describe('lookupPlaceName', () => {
  const where = { lat: 50.08, lon: 14.43 }
  const answer = (body: unknown, status = 200): typeof fetch =>
    vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })) as unknown as typeof fetch

  it('returns the name from the answer', async () => {
    const fetchImpl = answer({ address: { city: 'Praha' } })
    await expect(lookupPlaceName(where, { fetchImpl })).resolves.toBe('Praha')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('never throws: a server error, no network and a broken answer all give undefined', async () => {
    await expect(lookupPlaceName(where, { fetchImpl: answer({}, 500) })).resolves.toBeUndefined()
    await expect(lookupPlaceName(where, { fetchImpl: (() => Promise.reject(new TypeError('Failed to fetch'))) as typeof fetch })).resolves.toBeUndefined()
    const notJson = vi.fn(async () => new Response('<html>', { status: 200 })) as unknown as typeof fetch
    await expect(lookupPlaceName(where, { fetchImpl: notJson })).resolves.toBeUndefined()
  })

  it('does not ask for a position that is not a position', async () => {
    const fetchImpl = answer({ address: { city: 'Praha' } })
    await expect(lookupPlaceName({ lat: Number.NaN, lon: 1 }, { fetchImpl })).resolves.toBeUndefined()
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('gives up when the server is too slow', async () => {
    const slow = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))) as unknown as typeof fetch
    await expect(lookupPlaceName(where, { fetchImpl: slow, timeoutMs: 20 })).resolves.toBeUndefined()
  })

  it('stops when the screen asks it to, without asking the server at all if that came first', async () => {
    const controller = new AbortController()
    controller.abort()
    const fetchImpl = answer({ address: { city: 'Praha' } })
    await expect(lookupPlaceName(where, { fetchImpl, signal: controller.signal })).resolves.toBeUndefined()
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})

describe('the memory of looked-up places', () => {
  beforeEach(() => forgetPlaceNames())

  it('remembers a name per rounded place, and also that there was none', () => {
    expect(rememberedPlaceName({ lat: 50.081, lon: 14.434 })).toBeUndefined()
    rememberPlaceName({ lat: 50.081, lon: 14.434 }, 'Praha')
    expect(rememberedPlaceName({ lat: 50.0804, lon: 14.4349 })).toBe('Praha')
    expect(rememberedPlaceName({ lat: 49.5, lon: 14.4 })).toBeUndefined()
    rememberPlaceName({ lat: 49.5, lon: 14.4 }, undefined)
    expect(rememberedPlaceName({ lat: 49.5, lon: 14.4 })).toBeNull()
  })
})

describe('resolvePlaceName (the lookup at the moment of the catch)', () => {
  const where = { lat: 50.08, lon: 14.43 }
  const answer = (): typeof fetch =>
    vi.fn(async () => new Response(JSON.stringify({ address: { city: 'Praha' } }), { status: 200, headers: { 'Content-Type': 'application/json' } })) as unknown as typeof fetch
  beforeEach(() => forgetPlaceNames())

  it('asks once, remembers the answer and does not ask again for the same place', async () => {
    const fetchImpl = answer()
    await expect(resolvePlaceName(where, { fetchImpl })).resolves.toBe('Praha')
    await expect(resolvePlaceName({ lat: 50.081, lon: 14.434 }, { fetchImpl })).resolves.toBe('Praha')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('asks nothing when there is no position', async () => {
    const fetchImpl = answer()
    await expect(resolvePlaceName(undefined, { fetchImpl })).resolves.toBeUndefined()
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('does not ask while the phone is offline', async () => {
    const fetchImpl = answer()
    vi.stubGlobal('navigator', { onLine: false })
    try {
      await expect(resolvePlaceName(where, { fetchImpl })).resolves.toBeUndefined()
    } finally {
      vi.unstubAllGlobals()
    }
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
