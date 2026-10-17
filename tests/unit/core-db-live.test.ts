// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { Blob as NodeBlob } from 'node:buffer'
import { cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  addCatch,
  createLiveStore,
  deleteAllCatches,
  deleteCatch,
  getDb,
  useCaughtSummary,
  useMediaUrl,
  useRecentCatches,
  useSpeciesCatches,
} from '../../src/db'

// jsdom's Blob cannot be stored by fake-indexeddb (it is copied as an empty object), so use Node's own Blob here.
beforeAll(() => {
  vi.stubGlobal('Blob', NodeBlob)
})

beforeEach(async () => {
  await deleteAllCatches()
})

// Vitest runs without globals here, so Testing Library cannot clean up after each test by itself.
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('useCaughtSummary', () => {
  it('starts empty, becomes ready, and follows catches as they are added and deleted', async () => {
    const { result } = renderHook(() => useCaughtSummary())
    expect(result.current.ready).toBe(false)
    expect(result.current.speciesCount).toBe(0)

    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(result.current.bySpecies.size).toBe(0)
    expect(result.current.catchCount).toBe(0)

    const first = await addCatch({ speciesId: 'parus-major', method: 'sound', confidence: 0.9, caughtAt: 1000 })
    await waitFor(() => expect(result.current.bySpecies.get('parus-major')?.count).toBe(1))

    await addCatch({ speciesId: 'parus-major', method: 'photo', confidence: 0.8, caughtAt: 5000 }, { kind: 'image', blob: new Blob([new Uint8Array([1])], { type: 'image/jpeg' }) })
    await addCatch({ speciesId: 'turdus-merula', method: 'sound', confidence: 0.8, caughtAt: 2000 })
    await waitFor(() => expect(result.current.speciesCount).toBe(2))
    expect(result.current.catchCount).toBe(3)
    const tit = result.current.bySpecies.get('parus-major')
    expect(tit).toMatchObject({ count: 2, firstCaughtAt: 1000, lastCaughtAt: 5000, mediaKind: 'image' })
    expect(tit?.mediaId).toBeTruthy()

    await deleteCatch(first.id)
    await waitFor(() => expect(result.current.bySpecies.get('parus-major')?.count).toBe(1))
    expect(result.current.bySpecies.get('parus-major')?.firstCaughtAt).toBe(5000)
  })

  it('hands React the same object until the data changes', async () => {
    const { result, rerender } = renderHook(() => useCaughtSummary())
    await waitFor(() => expect(result.current.ready).toBe(true))
    const before = result.current
    rerender()
    rerender()
    expect(result.current).toBe(before)
    await addCatch({ speciesId: 'a', method: 'sound', confidence: 0.9 })
    await waitFor(() => expect(result.current).not.toBe(before))
  })

  it('updates every screen that uses it, and catches up after being unmounted', async () => {
    const one = renderHook(() => useCaughtSummary())
    const two = renderHook(() => useCaughtSummary())
    await waitFor(() => expect(one.result.current.ready && two.result.current.ready).toBe(true))
    await addCatch({ speciesId: 'a', method: 'sound', confidence: 0.9 })
    await waitFor(() => expect(one.result.current.speciesCount).toBe(1))
    await waitFor(() => expect(two.result.current.speciesCount).toBe(1))

    one.unmount()
    two.unmount()
    await addCatch({ speciesId: 'b', method: 'sound', confidence: 0.9 })
    const again = renderHook(() => useCaughtSummary())
    await waitFor(() => expect(again.result.current.speciesCount).toBe(2))
    again.unmount()
  })

  it('reports a failing database through `error` instead of crashing', async () => {
    const spy = vi.spyOn(getDb().catches, 'toArray').mockRejectedValueOnce(new Error('storage blocked'))
    // Earlier tests left the store with no subscribers, so this render starts a fresh query, which fails.
    const { result } = renderHook(() => useCaughtSummary())
    await waitFor(() => expect(result.current.error?.message).toBe('storage blocked'))
    expect(result.current.ready).toBe(true)
    spy.mockRestore()
  })
})

describe('createLiveStore failures', () => {
  it('keeps showing the last answer when the query fails, and says what went wrong', async () => {
    let fail = false
    const store = createLiveStore(async () => {
      await getDb().catches.count()
      if (fail) throw new Error('database closed')
      return 'fine'
    }, 'start')
    const stop = store.subscribe(() => undefined)
    await waitFor(() => expect(store.getSnapshot()).toEqual({ ready: true, value: 'fine' }))
    stop()

    fail = true
    const stopAgain = store.subscribe(() => undefined)
    await waitFor(() => expect(store.getSnapshot().error?.message).toBe('database closed'))
    expect(store.getSnapshot()).toMatchObject({ ready: true, value: 'fine' })
    stopAgain()
  })
})

describe('useSpeciesCatches and useRecentCatches', () => {
  it('lists the catches of one species, newest first, and follows a change of species', async () => {
    await addCatch({ speciesId: 'parus-major', method: 'sound', confidence: 0.9, caughtAt: 100 })
    await addCatch({ speciesId: 'parus-major', method: 'photo', confidence: 0.9, caughtAt: 300 })
    await addCatch({ speciesId: 'turdus-merula', method: 'sound', confidence: 0.9, caughtAt: 200 })

    const { result, rerender } = renderHook(({ id }) => useSpeciesCatches(id), { initialProps: { id: 'parus-major' } })
    expect(result.current.ready).toBe(false)
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(result.current.catches.map((record) => record.caughtAt)).toEqual([300, 100])

    rerender({ id: 'turdus-merula' })
    await waitFor(() => expect(result.current.catches.map((record) => record.caughtAt)).toEqual([200]))

    await addCatch({ speciesId: 'turdus-merula', method: 'sound', confidence: 0.9, caughtAt: 400 })
    await waitFor(() => expect(result.current.catches.map((record) => record.caughtAt)).toEqual([400, 200]))
  })

  it('lists the newest catches with a limit', async () => {
    for (const caughtAt of [10, 40, 20, 30]) await addCatch({ speciesId: 'a', method: 'sound', confidence: 0.9, caughtAt })
    const { result } = renderHook(() => useRecentCatches(2))
    await waitFor(() => expect(result.current.catches.map((record) => record.caughtAt)).toEqual([40, 30]))
    await addCatch({ speciesId: 'a', method: 'sound', confidence: 0.9, caughtAt: 50 })
    await waitFor(() => expect(result.current.catches.map((record) => record.caughtAt)).toEqual([50, 40]))
  })
})

describe('createLiveStore', () => {
  it('runs the query only while somebody listens, and keeps the last answer', async () => {
    const query = vi.fn(async () => (await getDb().catches.count()))
    const store = createLiveStore(query, -1)
    expect(query).not.toHaveBeenCalled()
    expect(store.getSnapshot()).toEqual({ ready: false, value: -1 })

    const listener = vi.fn()
    const stop = store.subscribe(listener)
    await waitFor(() => expect(store.getSnapshot()).toEqual({ ready: true, value: 0 }))
    expect(listener).toHaveBeenCalled()

    stop()
    const calls = query.mock.calls.length
    await addCatch({ speciesId: 'a', method: 'sound', confidence: 0.9 })
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(query.mock.calls.length).toBe(calls)
    expect(store.getSnapshot().value).toBe(0)

    const stopAgain = store.subscribe(() => undefined)
    await waitFor(() => expect(store.getSnapshot().value).toBe(1))
    stopAgain()
  })
})

describe('useMediaUrl', () => {
  let counter = 0
  const created: Blob[] = []
  const revoked: string[] = []

  beforeEach(() => {
    counter = 0
    created.length = 0
    revoked.length = 0
    URL.createObjectURL = vi.fn((blob: Blob) => {
      created.push(blob)
      return `blob:fake/${++counter}`
    }) as typeof URL.createObjectURL
    URL.revokeObjectURL = vi.fn((url: string) => {
      revoked.push(url)
    })
  })

  it('gives an address for a saved clip and releases it when the screen goes away', async () => {
    const saved = await addCatch({ speciesId: 'a', method: 'sound', confidence: 0.9 }, { kind: 'audio', blob: new Blob([new Uint8Array([1, 2])], { type: 'audio/wav' }), durationS: 3 })
    const { result, unmount } = renderHook(() => useMediaUrl(saved.mediaId))
    expect(result.current).toMatchObject({ loading: true, missing: false })
    await waitFor(() => expect(result.current.url).toBe('blob:fake/1'))
    expect(result.current).toMatchObject({ kind: 'audio', durationS: 3, loading: false, missing: false })
    expect(created).toHaveLength(1)
    expect(revoked).toEqual([])
    unmount()
    expect(revoked).toEqual(['blob:fake/1'])
  })

  it('swaps the address when the id changes and releases the old one', async () => {
    const a = await addCatch({ speciesId: 'a', method: 'photo', confidence: 0.9 }, { kind: 'image', blob: new Blob([new Uint8Array([1])], { type: 'image/jpeg' }) })
    const b = await addCatch({ speciesId: 'b', method: 'photo', confidence: 0.9 }, { kind: 'image', blob: new Blob([new Uint8Array([2])], { type: 'image/jpeg' }) })
    const { result, rerender, unmount } = renderHook(({ id }) => useMediaUrl(id), { initialProps: { id: a.mediaId } })
    await waitFor(() => expect(result.current.url).toBe('blob:fake/1'))
    rerender({ id: b.mediaId })
    // The old address is never shown for the new id.
    expect(result.current.url).toBeUndefined()
    expect(result.current.loading).toBe(true)
    await waitFor(() => expect(result.current.url).toBe('blob:fake/2'))
    expect(revoked).toEqual(['blob:fake/1'])
    unmount()
    expect(revoked).toEqual(['blob:fake/1', 'blob:fake/2'])
  })

  it('says "missing" for an id the database does not know, and does nothing without an id', async () => {
    const { result } = renderHook(() => useMediaUrl('no-such-media'))
    await waitFor(() => expect(result.current.missing).toBe(true))
    expect(result.current).toMatchObject({ loading: false, url: undefined })

    const none = renderHook(() => useMediaUrl(undefined))
    expect(none.result.current).toEqual({ loading: false, missing: false })
    expect(URL.createObjectURL).not.toHaveBeenCalled()
  })
})
