// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_SETTINGS,
  getSettings,
  reloadSettingsForTests,
  resetSettings,
  sanitizeSettings,
  SETTINGS_KEY,
  subscribeSettings,
  updateSettings,
  useSettings,
} from '../../src/state/settings'

beforeEach(() => {
  localStorage.clear()
  reloadSettingsForTests()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('settings', () => {
  it('starts with normal sensitivity and sound effects on', () => {
    expect(getSettings()).toEqual({ sensitivity: 'normal', soundEffects: true })
    expect(DEFAULT_SETTINGS).toEqual(getSettings())
  })

  it('saves changes to localStorage and loads them again after a restart', () => {
    updateSettings({ sensitivity: 'strict' })
    updateSettings({ soundEffects: false })
    expect(JSON.parse(localStorage.getItem(SETTINGS_KEY) as string)).toEqual({ sensitivity: 'strict', soundEffects: false })

    reloadSettingsForTests()
    expect(getSettings()).toEqual({ sensitivity: 'strict', soundEffects: false })
  })

  it('returns the same object until something changes, and does not notify for a change to the same value', () => {
    const first = getSettings()
    expect(getSettings()).toBe(first)
    const listener = vi.fn()
    const stop = subscribeSettings(listener)
    expect(updateSettings({ sensitivity: 'normal' })).toBe(first)
    expect(listener).not.toHaveBeenCalled()
    const second = updateSettings({ sensitivity: 'easy' })
    expect(second).not.toBe(first)
    expect(getSettings()).toBe(second)
    expect(listener).toHaveBeenCalledTimes(1)
    stop()
    updateSettings({ sensitivity: 'strict' })
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('ignores values that make no sense', () => {
    updateSettings({ sensitivity: 'wild' as never, soundEffects: 'yes' as never })
    expect(getSettings()).toEqual(DEFAULT_SETTINGS)
  })

  it('repairs damaged stored settings field by field', () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ sensitivity: 'easy', soundEffects: 'loud', welcomeSeen: true, mystery: 1 }))
    reloadSettingsForTests()
    expect(getSettings()).toEqual({ sensitivity: 'easy', soundEffects: true })
  })

  it.each(['{not json', 'null', '42', '"text"', '[]'])('falls back to the defaults for stored text %s', (stored) => {
    localStorage.setItem(SETTINGS_KEY, stored)
    reloadSettingsForTests()
    expect(getSettings()).toEqual(DEFAULT_SETTINGS)
  })

  it('still works when localStorage cannot be read or written', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError')
    })
    reloadSettingsForTests()
    expect(getSettings()).toEqual(DEFAULT_SETTINGS)
    expect(() => updateSettings({ sensitivity: 'strict' })).not.toThrow()
    // Not saved, but applied for as long as the app is open.
    expect(getSettings().sensitivity).toBe('strict')
  })

  it('goes back to the defaults on reset', () => {
    updateSettings({ sensitivity: 'easy', soundEffects: false })
    expect(resetSettings()).toEqual(DEFAULT_SETTINGS)
    expect(JSON.parse(localStorage.getItem(SETTINGS_KEY) as string)).toEqual(DEFAULT_SETTINGS)
  })

  it('follows a change made in another tab', () => {
    const listener = vi.fn()
    const stop = subscribeSettings(listener)
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ sensitivity: 'strict', soundEffects: false }))
    window.dispatchEvent(new StorageEvent('storage', { key: SETTINGS_KEY }))
    expect(getSettings()).toEqual({ sensitivity: 'strict', soundEffects: false })
    expect(listener).toHaveBeenCalledTimes(1)

    // Other keys are none of its business, and neither is a storage event that changes nothing.
    window.dispatchEvent(new StorageEvent('storage', { key: 'something-else' }))
    window.dispatchEvent(new StorageEvent('storage', { key: SETTINGS_KEY }))
    expect(listener).toHaveBeenCalledTimes(1)
    stop()
  })

  it('stops listening to other tabs when nobody is subscribed', () => {
    const remove = vi.spyOn(window, 'removeEventListener')
    const stop = subscribeSettings(() => undefined)
    stop()
    expect(remove).toHaveBeenCalledWith('storage', expect.any(Function))
  })
})

describe('sanitizeSettings', () => {
  it('keeps good values and drops the rest', () => {
    expect(sanitizeSettings({ sensitivity: 'strict', soundEffects: false })).toEqual({ sensitivity: 'strict', soundEffects: false })
    expect(sanitizeSettings(undefined)).toEqual(DEFAULT_SETTINGS)
    expect(sanitizeSettings({ sensitivity: null })).toEqual(DEFAULT_SETTINGS)
  })
})

describe('useSettings', () => {
  it('gives the settings and updates the screen when they change', () => {
    const { result } = renderHook(() => useSettings())
    expect(result.current.settings.sensitivity).toBe('normal')
    act(() => result.current.update({ sensitivity: 'easy' }))
    expect(result.current.settings.sensitivity).toBe('easy')
    expect(JSON.parse(localStorage.getItem(SETTINGS_KEY) as string).sensitivity).toBe('easy')
  })

  it('keeps every screen that shows a setting in step', () => {
    const one = renderHook(() => useSettings())
    const two = renderHook(() => useSettings())
    act(() => one.result.current.update({ soundEffects: false }))
    expect(two.result.current.settings.soundEffects).toBe(false)
    act(() => {
      updateSettings({ sensitivity: 'strict' })
    })
    expect(one.result.current.settings.sensitivity).toBe('strict')
    expect(two.result.current.settings.sensitivity).toBe('strict')
  })

  it('returns an update function that stays the same between renders', () => {
    const { result, rerender } = renderHook(() => useSettings())
    const update = result.current.update
    rerender()
    expect(result.current.update).toBe(update)
  })
})
