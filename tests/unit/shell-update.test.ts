// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createElement as h } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  applyIfIdle,
  hashPath,
  isSafeToReload,
  isUpdateWaiting,
  resetUpdateState,
  setUpdateWaiting,
  shouldCheckForUpdate,
  UPDATE_CHECK_EVERY_MS,
} from '../../src/app/appUpdate'
import { UpdateBanner } from '../../src/app/UpdateBanner'
import { clearPending, setPending } from '../../src/state/pending'

const idle = { path: '/', hasPending: false, downloading: false }

beforeEach(() => {
  resetUpdateState()
  clearPending()
})

afterEach(() => {
  cleanup()
  resetUpdateState()
  clearPending()
})

describe('when the page may reload for a new version', () => {
  it('is fine on the Dex, the settings and the scan hub', () => {
    for (const path of ['/', '/species/parus-major', '/scan', '/settings', '/about']) expect(isSafeToReload({ ...idle, path })).toBe(true)
  })

  it('is not fine during a scan or on the result screen', () => {
    for (const path of ['/scan/sound', '/scan/photo', '/scan/live', '/result']) expect(isSafeToReload({ ...idle, path })).toBe(false)
  })

  it('is not fine while a result waits for the decision or a model download runs', () => {
    expect(isSafeToReload({ ...idle, hasPending: true })).toBe(false)
    expect(isSafeToReload({ ...idle, downloading: true })).toBe(false)
  })

  it('reads the route out of a hash address', () => {
    expect(hashPath('#/scan/sound')).toBe('/scan/sound')
    expect(hashPath('#/result?x=1')).toBe('/result')
    expect(hashPath('')).toBe('/')
    expect(hashPath('#')).toBe('/')
  })
})

describe('applying a waiting version', () => {
  it('does nothing while no version waits', () => {
    expect(applyIfIdle({ ...idle })).toBe(false)
    expect(isUpdateWaiting()).toBe(false)
  })

  it('applies it when idle and keeps waiting in the middle of a scan', () => {
    const apply = vi.fn()
    setUpdateWaiting(apply)
    expect(isUpdateWaiting()).toBe(true)
    expect(applyIfIdle({ ...idle, path: '/scan/sound' })).toBe(false)
    expect(applyIfIdle({ ...idle, path: '/result' })).toBe(false)
    expect(applyIfIdle({ ...idle, downloading: true })).toBe(false)
    expect(apply).not.toHaveBeenCalled()
    expect(applyIfIdle({ ...idle })).toBe(true)
    expect(apply).toHaveBeenCalledTimes(1)
  })

  it('asks the server for news at most every ten minutes', () => {
    expect(shouldCheckForUpdate(1_000, 1_000 + UPDATE_CHECK_EVERY_MS - 1)).toBe(false)
    expect(shouldCheckForUpdate(1_000, 1_000 + UPDATE_CHECK_EVERY_MS)).toBe(true)
  })
})

describe('the "new version" banner', () => {
  const show = (path: string) => render(h(MemoryRouter, { initialEntries: [path] }, h(UpdateBanner)))

  it('is not there without a waiting version', () => {
    show('/')
    expect(screen.queryByTestId('update-banner')).toBeNull()
  })

  it('appears on the Dex and loads the new version from its button', () => {
    const apply = vi.fn()
    show('/')
    act(() => setUpdateWaiting(apply))
    expect(screen.getByTestId('update-banner').textContent).toContain('Je tu nová verze')
    fireEvent.click(screen.getByRole('button', { name: 'Načíst znovu' }))
    expect(apply).toHaveBeenCalledTimes(1)
  })

  it('stays away during a scan and on the result screen, so nothing is lost', () => {
    setUpdateWaiting(vi.fn())
    show('/scan/sound')
    expect(screen.queryByTestId('update-banner')).toBeNull()
    cleanup()
    show('/result')
    expect(screen.queryByTestId('update-banner')).toBeNull()
  })

  it('stays away while a result is waiting, wherever the person is', () => {
    setPending({ method: 'sound', candidates: [{ speciesId: 'parus-major', confidence: 0.9 }], createdAt: 1 })
    setUpdateWaiting(vi.fn())
    show('/settings')
    expect(screen.queryByTestId('update-banner')).toBeNull()
  })
})
