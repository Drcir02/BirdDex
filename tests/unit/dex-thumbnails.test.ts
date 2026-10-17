// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { Blob as NodeBlob } from 'node:buffer'
import { cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { addCatch, deleteAllCatches } from '../../src/db'
import { SMALL_ENOUGH_BYTES, forgetAllThumbnails, forgetThumbnail, getThumbnail, peekThumbnail, useThumbnail } from '../../src/features/dex/thumbnails'

// fake-indexeddb copies jsdom's Blob as an empty object, so the tests use Node's own Blob.
beforeAll(() => {
  vi.stubGlobal('Blob', NodeBlob)
})

let counter = 0
beforeEach(async () => {
  forgetAllThumbnails()
  URL.createObjectURL = vi.fn(() => `blob:fake/${(counter += 1)}`)
  URL.revokeObjectURL = vi.fn()
  await deleteAllCatches()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.stubGlobal('Blob', NodeBlob)
})

const photo = async (size: number, kind: 'image' | 'audio' = 'image') => {
  const saved = await addCatch(
    { speciesId: 'parus-major', method: kind === 'image' ? 'photo' : 'sound', confidence: 0.9 },
    { kind, blob: new Blob([new Uint8Array(size)], { type: kind === 'image' ? 'image/jpeg' : 'audio/wav' }) },
  )
  return saved.mediaId as string
}

describe('thumbnails of the photos a person caught', () => {
  it('shows a small photo as it is, without shrinking it', async () => {
    const mediaId = await photo(SMALL_ENOUGH_BYTES - 10)
    const draw = vi.fn(async () => new Blob([new Uint8Array(5)]))
    const url = await getThumbnail(mediaId, draw)
    expect(url).toMatch(/^blob:fake\//)
    expect(draw).not.toHaveBeenCalled()
    expect(peekThumbnail(mediaId)).toBe(url)
  })

  it('shrinks a big photo and gives the address of the small copy', async () => {
    const mediaId = await photo(SMALL_ENOUGH_BYTES * 20)
    const draw = vi.fn(async (blob: Blob) => new Blob([new Uint8Array(Math.round(blob.size / 20))]))
    const url = await getThumbnail(mediaId, draw)
    expect(draw).toHaveBeenCalledTimes(1)
    expect(url).toMatch(/^blob:fake\//)
    const made = (URL.createObjectURL as unknown as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0] as Blob
    expect(made.size).toBe(SMALL_ENOUGH_BYTES)
  })

  it('makes one small copy for many questions about the same photo', async () => {
    const mediaId = await photo(SMALL_ENOUGH_BYTES * 3)
    const draw = vi.fn(async () => new Blob([new Uint8Array(10)]))
    const [a, b, c] = await Promise.all([getThumbnail(mediaId, draw), getThumbnail(mediaId, draw), getThumbnail(mediaId, draw)])
    expect(a).toBe(b)
    expect(b).toBe(c)
    expect(draw).toHaveBeenCalledTimes(1)
    expect(await getThumbnail(mediaId, draw)).toBe(a)
    expect(draw).toHaveBeenCalledTimes(1)
  })

  it('shrinks one photo at a time, so a fast scroll does not use up the memory of a cheap phone', async () => {
    const ids = await Promise.all([photo(SMALL_ENOUGH_BYTES * 2), photo(SMALL_ENOUGH_BYTES * 2), photo(SMALL_ENOUGH_BYTES * 2)])
    let running = 0
    let peak = 0
    const draw = vi.fn(async () => {
      running += 1
      peak = Math.max(peak, running)
      await new Promise((resolve) => setTimeout(resolve, 5))
      running -= 1
      return new Blob([new Uint8Array(10)])
    })
    await Promise.all(ids.map((id) => getThumbnail(id, draw)))
    expect(draw).toHaveBeenCalledTimes(3)
    expect(peak).toBe(1)
  })

  it('falls back to the original when the browser cannot shrink it', async () => {
    const mediaId = await photo(SMALL_ENOUGH_BYTES * 2)
    const url = await getThumbnail(mediaId, async () => {
      throw new Error('cannot decode')
    })
    expect(url).toMatch(/^blob:fake\//)
    const used = (URL.createObjectURL as unknown as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0] as Blob
    expect(used.size).toBe(SMALL_ENOUGH_BYTES * 2)
  })

  it('has nothing for a recording, a missing photo or a failed read', async () => {
    const draw = vi.fn(async () => new Blob([]))
    expect(await getThumbnail(await photo(100, 'audio'), draw)).toBeUndefined()
    expect(await getThumbnail('no-such-media', draw)).toBeUndefined()
    expect(draw).not.toHaveBeenCalled()
  })

  it('lets go of the small copy when its photo is deleted, and makes a new one if asked again', async () => {
    const mediaId = await photo(SMALL_ENOUGH_BYTES - 1)
    const first = await getThumbnail(mediaId)
    forgetThumbnail(mediaId)
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(first)
    expect(peekThumbnail(mediaId)).toBeUndefined()
    expect(await getThumbnail(mediaId)).not.toBe(first)
  })

  it('is available to a component once it is ready, and not before it is asked for', async () => {
    const mediaId = await photo(SMALL_ENOUGH_BYTES - 1)
    const { result, rerender } = renderHook(({ enabled }) => useThumbnail(mediaId, enabled), { initialProps: { enabled: false } })
    expect(result.current).toBeUndefined()
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(result.current).toBeUndefined()
    rerender({ enabled: true })
    await waitFor(() => expect(result.current).toMatch(/^blob:fake\//))
    // A card that appears later gets it at once.
    const again = renderHook(() => useThumbnail(mediaId, true))
    expect(again.result.current).toBe(result.current)
  })

  it('gives nothing for no photo', () => {
    const { result } = renderHook(() => useThumbnail(undefined, true))
    expect(result.current).toBeUndefined()
  })
})
