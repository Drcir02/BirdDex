// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PendingIdentification } from '../../src/domain/types'
import { clearPending, getPending, getPendingCatchId, setPending, subscribePending, usePending } from '../../src/state/pending'

const pending = (overrides: Partial<PendingIdentification> = {}): PendingIdentification => ({
  method: 'sound',
  candidates: [
    { speciesId: 'parus-major', confidence: 0.93 },
    { speciesId: 'cyanistes-caeruleus', confidence: 0.04 },
  ],
  createdAt: 1_700_000_000_000,
  ...overrides,
})

beforeEach(() => clearPending())
afterEach(() => cleanup())

describe('pending identification', () => {
  it('is empty at first', () => {
    expect(getPending()).toBeUndefined()
  })

  it('holds what was set until it is cleared', () => {
    const value = pending({ location: { lat: 50, lon: 14 } })
    setPending(value)
    expect(getPending()).toBe(value)
    clearPending()
    expect(getPending()).toBeUndefined()
  })

  it('keeps the photo or clip it was given', () => {
    const blob = new Blob(['x'], { type: 'image/jpeg' })
    setPending(pending({ method: 'photo', media: { kind: 'image', blob, mime: 'image/jpeg' } }))
    expect(getPending()?.media?.blob).toBe(blob)
  })

  it('replaces an older identification with a newer one', () => {
    setPending(pending({ createdAt: 1 }))
    const newer = pending({ createdAt: 2 })
    setPending(newer)
    expect(getPending()).toBe(newer)
  })

  it('has a catch id that stays the same for one identification and changes with the next', () => {
    expect(getPendingCatchId()).toBeUndefined()
    setPending(pending())
    const first = getPendingCatchId()
    expect(first).toMatch(/^[0-9a-f-]{36}$/)
    expect(getPendingCatchId()).toBe(first)
    setPending(pending())
    expect(getPendingCatchId()).not.toBe(first)
    clearPending()
    expect(getPendingCatchId()).toBeUndefined()
  })

  it('tells listeners about changes, and not about clearing an empty store', () => {
    const listener = vi.fn()
    const stop = subscribePending(listener)
    clearPending()
    expect(listener).not.toHaveBeenCalled()
    setPending(pending())
    expect(listener).toHaveBeenCalledTimes(1)
    clearPending()
    expect(listener).toHaveBeenCalledTimes(2)
    stop()
    setPending(pending())
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('updates a screen that shows it', () => {
    const { result } = renderHook(() => usePending())
    expect(result.current).toBeUndefined()
    const value = pending({ method: 'live' })
    act(() => setPending(value))
    expect(result.current).toBe(value)
    act(() => clearPending())
    expect(result.current).toBeUndefined()
  })

  it('is visible to a screen that opens after it was set', () => {
    const value = pending()
    setPending(value)
    const { result } = renderHook(() => usePending())
    expect(result.current).toBe(value)
  })
})
