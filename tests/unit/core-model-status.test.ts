// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ModelStoreStatus } from '../../src/ml/runtime/modelStore'
import { createModelStatusStore, useModelStatusFrom } from '../../src/state/modelStatus'

const status = (state: ModelStoreStatus['state'], readyBytes = 0): ModelStoreStatus => ({
  state,
  files: [],
  totalBytes: 100,
  readyBytes,
  persistent: true,
})

function fakeSource(initial: ModelStoreStatus) {
  let push: (status: ModelStoreStatus) => void = () => undefined
  const stop = vi.fn()
  const source = {
    getStatus: vi.fn(async () => initial),
    subscribe: vi.fn((listener: (status: ModelStoreStatus) => void) => {
      push = listener
      return stop
    }),
  }
  return { source, stop, push: (next: ModelStoreStatus) => push(next) }
}

afterEach(() => cleanup())

describe('model status store', () => {
  it('knows nothing until somebody looks, then looks the status up and follows the download', async () => {
    const { source, push } = fakeSource(status('missing'))
    const store = createModelStatusStore(source)
    expect(store.getSnapshot()).toBeUndefined()
    expect(source.getStatus).not.toHaveBeenCalled()

    const listener = vi.fn()
    const unsubscribe = store.subscribe(listener)
    expect(source.subscribe).toHaveBeenCalledTimes(1)
    await vi.waitFor(() => expect(store.getSnapshot()?.state).toBe('missing'))

    push(status('downloading', 40))
    expect(store.getSnapshot()).toMatchObject({ state: 'downloading', readyBytes: 40 })
    expect(listener).toHaveBeenCalled()
    unsubscribe()
  })

  it('listens to the model store only while a screen shows it', async () => {
    const { source, stop } = fakeSource(status('ready'))
    const store = createModelStatusStore(source)
    const a = store.subscribe(() => undefined)
    const b = store.subscribe(() => undefined)
    expect(source.subscribe).toHaveBeenCalledTimes(1)
    a()
    expect(stop).not.toHaveBeenCalled()
    b()
    expect(stop).toHaveBeenCalledTimes(1)
    store.subscribe(() => undefined)()
    expect(source.subscribe).toHaveBeenCalledTimes(2)
  })

  it('can look again on request', async () => {
    const { source } = fakeSource(status('missing'))
    const store = createModelStatusStore(source)
    await store.refresh()
    expect(store.getSnapshot()?.state).toBe('missing')
    source.getStatus.mockResolvedValueOnce(status('ready', 100))
    await store.refresh()
    expect(store.getSnapshot()).toMatchObject({ state: 'ready', readyBytes: 100 })
  })

  it('updates a screen that shows it', async () => {
    const { source, push } = fakeSource(status('partial', 20))
    const store = createModelStatusStore(source)
    const { result } = renderHook(() => useModelStatusFrom(store))
    expect(result.current).toBeUndefined()
    await waitFor(() => expect(result.current?.state).toBe('partial'))
    act(() => push(status('ready', 100)))
    expect(result.current?.state).toBe('ready')
  })
})
