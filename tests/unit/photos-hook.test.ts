// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createReferencePhotoService, PhotoLookupError, useReferencePhoto, type ReferencePhoto, type ReferencePhotoService } from '../../src/features/photos'

const PHOTO: ReferencePhoto = {
  speciesId: 'parus-major',
  thumbnailUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Tit.jpg/330px-Tit.jpg',
  imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Tit.jpg/500px-Tit.jpg',
  author: 'Jan Novák',
  licence: 'CC BY-SA 4.0',
  link: 'https://commons.wikimedia.org/wiki/File:Tit.jpg',
}

/** A service that answers when the test says so. */
function controllable(initial?: ReferencePhoto | null) {
  const known = new Map<string, ReferencePhoto | null>()
  if (initial !== undefined) known.set('parus-major', initial)
  const waiting: Array<{ resolve: (photo: ReferencePhoto | null) => void; reject: (error: unknown) => void; signal?: AbortSignal; force?: boolean }> = []
  const service: ReferencePhotoService = {
    peek: (id) => known.get(id),
    get: vi.fn(
      (id, options) =>
        new Promise<ReferencePhoto | null>((resolve, reject) => {
          waiting.push({
            resolve: (photo) => {
              known.set(id, photo)
              resolve(photo)
            },
            reject,
            signal: options?.signal,
            force: options?.force,
          })
        }),
    ),
    reset: () => known.clear(),
  }
  return { service, waiting }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('useReferencePhoto', () => {
  it('starts loading, then has the photo, without blocking the first render', async () => {
    const { service, waiting } = controllable()
    const { result } = renderHook(() => useReferencePhoto('parus-major', { service }))
    expect(result.current).toEqual({ photo: undefined, status: 'loading' })
    await act(async () => {
      waiting[0].resolve(PHOTO)
    })
    expect(result.current).toEqual({ photo: PHOTO, status: 'ready' })
  })

  it('has a known photo on the very first render and asks for nothing', () => {
    const { service } = controllable(PHOTO)
    const { result } = renderHook(() => useReferencePhoto('parus-major', { service }))
    expect(result.current).toEqual({ photo: PHOTO, status: 'ready' })
    expect(service.get).not.toHaveBeenCalled()
  })

  it('says "none" for a bird without a usable photo', async () => {
    const { service, waiting } = controllable()
    const { result } = renderHook(() => useReferencePhoto('parus-major', { service }))
    await act(async () => {
      waiting[0].resolve(null)
    })
    expect(result.current).toEqual({ photo: undefined, status: 'none' })
  })

  it('says "error" when the lookup fails and tries again when the phone is back online', async () => {
    const { service, waiting } = controllable()
    const { result } = renderHook(() => useReferencePhoto('parus-major', { service }))
    await act(async () => {
      waiting[0].reject(new PhotoLookupError('offline'))
    })
    expect(result.current.status).toBe('error')
    await act(async () => {
      window.dispatchEvent(new Event('online'))
    })
    expect(waiting).toHaveLength(2)
    expect(waiting[1].force).toBe(true)
    await act(async () => {
      waiting[1].resolve(PHOTO)
    })
    expect(result.current).toEqual({ photo: PHOTO, status: 'ready' })
  })

  it('does nothing until it is enabled, and does not look up without a bird', async () => {
    const { service, waiting } = controllable()
    const { result, rerender } = renderHook(({ enabled }) => useReferencePhoto('parus-major', { service, enabled }), { initialProps: { enabled: false } })
    expect(result.current.status).toBe('idle')
    expect(service.get).not.toHaveBeenCalled()
    rerender({ enabled: true })
    expect(result.current.status).toBe('loading')
    expect(waiting).toHaveLength(1)

    const none = renderHook(() => useReferencePhoto(undefined, { service }))
    expect(none.result.current.status).toBe('idle')
    expect(waiting).toHaveLength(1)
  })

  it('tells the service nobody waits any more when the component goes away, and ignores a late answer', async () => {
    const { service, waiting } = controllable()
    const { result, unmount } = renderHook(() => useReferencePhoto('parus-major', { service }))
    unmount()
    expect(waiting[0].signal?.aborted).toBe(true)
    await act(async () => {
      waiting[0].resolve(PHOTO)
    })
    expect(result.current.status).toBe('loading')
  })

  it('does not show the photo of the previous bird while the next one is loading', async () => {
    const first = controllable(PHOTO)
    const { result, rerender } = renderHook(({ id }) => useReferencePhoto(id, { service: first.service }), { initialProps: { id: 'parus-major' } })
    expect(result.current.status).toBe('ready')
    rerender({ id: 'turdus-merula' })
    expect(result.current.status).toBe('loading')
    expect(result.current.photo).toBeUndefined()
  })

  it('works with the real service and a mocked network', async () => {
    const service = createReferencePhotoService({
      fetchImpl: (async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.includes('/summary/')) {
          return new Response(JSON.stringify({ thumbnail: { source: PHOTO.thumbnailUrl } }), { status: 200 })
        }
        return new Response(
          JSON.stringify({ query: { pages: [{ imageinfo: [{ extmetadata: { LicenseShortName: { value: 'CC BY 4.0' }, License: { value: 'cc-by-4.0' }, Artist: { value: 'Eva' } } }] }] } }),
          { status: 200 },
        )
      }) as typeof fetch,
      cache: { get: async () => undefined, put: async () => undefined },
      findSpecies: async (id) => ({
        id,
        dexNumber: 1,
        scientificName: 'Parus major',
        czechName: 'Sýkora koňadra',
        englishName: 'Great Tit',
        family: 'Paridae',
        inCzechia: true,
        inEurope: true,
        rarity: 'common',
        birdnetIndex: 1,
        wingclipIndex: 1,
        wikiTitle: 'Great tit',
      }),
    })
    const { result } = renderHook(() => useReferencePhoto('parus-major', { service }))
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(result.current.photo).toMatchObject({ author: 'Eva', licence: 'CC BY 4.0', thumbnailUrl: PHOTO.thumbnailUrl })
  })
})
