// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { createElement as h } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ModelFileStatus, ModelStoreStatus } from '../../src/ml/runtime/modelStore'

// What the model store says is under the test's control (for the real engines); the fake engines pretend by themselves.
let storeStatus: ModelStoreStatus | undefined
vi.mock('../../src/state/modelStatus', () => ({ useModelStatus: () => storeStatus }))

import { resetFakePrepared } from '../../src/features/scan/modelReadiness'
import { resetEngines } from '../../src/ml/engines'
import ScanPage from '../../src/pages/ScanPage'
import { resetPersistentStorageRequest } from '../../src/state/storage'

const MB = 1_000_000

function file(id: string, bytes: number, state: ModelFileStatus['state'], loadedBytes = state === 'ready' ? bytes : 0): ModelFileStatus {
  return { id, label: id, file: id, bytes, state, loadedBytes }
}

function status(states: Array<ModelFileStatus['state']>, loaded: number[] = []): ModelStoreStatus {
  const sizes: Array<[string, number]> = [
    ['birdnet-fp16', 26 * MB],
    ['birdnet-geo-fp16', 15 * MB],
    ['wingclip-onnx', 14 * MB],
    ['wingclip-data', 25 * MB],
    ['wingclip-text', 8 * MB],
  ]
  const files = sizes.map(([id, bytes], index) => file(id, bytes, states[index], loaded[index]))
  const total = files.reduce((sum, f) => sum + f.bytes, 0)
  return { state: 'missing', files, totalBytes: total, readyBytes: files.reduce((sum, f) => sum + f.loadedBytes, 0), persistent: true }
}

beforeEach(() => {
  window.localStorage.clear()
  resetEngines()
  resetFakePrepared()
  resetPersistentStorageRequest()
  storeStatus = undefined
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  Reflect.deleteProperty(navigator, 'storage')
})

function renderHub() {
  return render(h(MemoryRouter, { initialEntries: ['/scan'] }, h(ScanPage)))
}

describe('the three ways', () => {
  it('has one big button for each, with a short explanation, linking to its screen', () => {
    storeStatus = status(['ready', 'ready', 'ready', 'ready', 'ready'])
    renderHub()
    expect(screen.getByRole('heading', { level: 1, name: 'Skenovat' })).toBeTruthy()
    const sound = screen.getByTestId('tile-sound')
    expect(sound.getAttribute('href')).toBe('/scan/sound')
    expect(within(sound).getByText('Poslouchat')).toBeTruthy()
    expect(within(sound).getByText(/Nech telefon poslouchat zpěv/)).toBeTruthy()
    const photo = screen.getByTestId('tile-photo')
    expect(photo.getAttribute('href')).toBe('/scan/photo')
    expect(within(photo).getByText('Vyfotit nebo z galerie')).toBeTruthy()
    const live = screen.getByTestId('tile-live')
    expect(live.getAttribute('href')).toBe('/scan/live')
    expect(within(live).getByText('Živá kamera')).toBeTruthy()
  })

  it('says that everything stays on the phone', () => {
    storeStatus = status(['ready', 'ready', 'ready', 'ready', 'ready'])
    renderHub()
    expect(screen.getByText(/Všechno se počítá přímo v tvém telefonu/)).toBeTruthy()
  })
})

describe('the bird brain banner (real engines: the model store knows what is on the phone)', () => {
  it('says it is checking while the model store has not answered', () => {
    renderHub()
    expect(screen.getByText('Zjišťuju, co už mám v telefonu…')).toBeTruthy()
    expect(screen.queryByTestId('model-download')).toBeNull()
  })

  it('offers the download the first time: about 90 MB, best on Wi-Fi, and works offline afterwards', () => {
    storeStatus = status(['missing', 'missing', 'missing', 'missing', 'missing'])
    renderHub()
    const banner = screen.getByTestId('model-banner')
    expect(within(banner).getByText('Ptačí mozek')).toBeTruthy()
    expect(within(banner).getByRole('button', { name: 'Stáhnout ptačí mozek' })).toBeTruthy()
    expect(within(banner).getByText('(asi 90 MB, nejlépe přes Wi-Fi)')).toBeTruthy()
    expect(within(banner).getByText(/potom ptáky poznávám i bez internetu/i)).toBeTruthy()
  })

  it('asks only for what is missing when part of it is already there', () => {
    storeStatus = status(['ready', 'ready', 'missing', 'missing', 'missing'])
    renderHub()
    // 47 MB are still to come: the banner rounds to the nearest 5 MB.
    expect(screen.getByText('(asi 45 MB, nejlépe přes Wi-Fi)')).toBeTruthy()
  })

  it('shows the progress of a download that is going on (also one that another screen started)', () => {
    storeStatus = status(['downloading', 'missing', 'missing', 'missing', 'missing'], [13 * MB])
    renderHub()
    expect(screen.getByText('Stahuju ptačí mozek…')).toBeTruthy()
    const bar = screen.getByRole('progressbar', { name: 'Stahování ptačího mozku' })
    expect(bar.getAttribute('aria-valuenow')).toBe('15')
    expect(screen.getByText('13 z 88 MB')).toBeTruthy()
    expect(screen.getByText(/Nech aplikaci otevřenou/)).toBeTruthy()
  })

  it('says that all is well, without a button, once everything is on the phone', () => {
    storeStatus = status(['ready', 'ready', 'ready', 'ready', 'ready'])
    renderHub()
    expect(screen.getByTestId('model-ready').textContent).toBe('Ptačí mozek je připravený. Funguje i\u00A0bez internetu.')
    expect(screen.queryByTestId('model-download')).toBeNull()
  })

  it('does not start the engines (and so does not fill the phone memory) just because the hub is open', () => {
    storeStatus = status(['ready', 'ready', 'ready', 'ready', 'ready'])
    renderHub()
    // Nothing is "working": no spinner message about starting the engine, only the quiet "ready" line.
    expect(screen.queryByText('Rozjíždím ptačí mozek…')).toBeNull()
  })

  it('explains when the list of models cannot be read, with a way to try again', () => {
    storeStatus = { state: 'unavailable', files: [], totalBytes: 0, readyBytes: 0, persistent: true }
    renderHub()
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain('Nepodařilo se stáhnout rozpoznávací model')
    expect(within(alert).getByRole('button', { name: 'Zkusit znovu' })).toBeTruthy()
  })
})

describe('downloading (fake engines pretend, with the real sizes)', () => {
  beforeEach(() => {
    window.localStorage.setItem('birddex:engines', 'fake')
    window.localStorage.setItem('birddex:fakeDelay', '8')
    resetEngines()
  })

  it('shows the bar, then says the bird brain is ready', async () => {
    window.localStorage.setItem('birddex:fakeDelay', '80')
    resetEngines()
    renderHub()
    fireEvent.click(screen.getByTestId('model-download'))
    // The bar is there at once (at zero), before the engines have said anything.
    expect(screen.getByRole('progressbar', { name: 'Stahování ptačího mozku' })).toBeTruthy()
    await waitFor(() => expect(screen.getByText(/z 89 MB/)).toBeTruthy(), { timeout: 3000 })
    await waitFor(() => expect(screen.getByTestId('model-ready')).toBeTruthy(), { timeout: 5000 })
    expect(screen.queryByTestId('model-banner')).toBeNull()
  })

  it('asks the browser to keep the data (navigator.storage.persist) after the first successful download', async () => {
    const persist = vi.fn(async () => true)
    Object.defineProperty(navigator, 'storage', { configurable: true, value: { persist, persisted: vi.fn(async () => false) } })
    renderHub()
    fireEvent.click(screen.getByTestId('model-download'))
    await waitFor(() => expect(screen.getByTestId('model-ready')).toBeTruthy(), { timeout: 3000 })
    await waitFor(() => expect(persist).toHaveBeenCalledTimes(1))
  })

  it('does not ask for persistent storage when the download failed', async () => {
    window.localStorage.setItem('birddex:fake', 'download-error')
    resetEngines()
    const persist = vi.fn(async () => true)
    Object.defineProperty(navigator, 'storage', { configurable: true, value: { persist, persisted: vi.fn(async () => false) } })
    renderHub()
    fireEvent.click(screen.getByTestId('model-download'))
    await screen.findByRole('alert')
    expect(persist).not.toHaveBeenCalled()
  })

  it('shows a failed download calmly and "Zkusit znovu" finishes it', async () => {
    window.localStorage.setItem('birddex:fake', 'download-error')
    resetEngines()
    renderHub()
    fireEvent.click(screen.getByTestId('model-download'))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Nepodařilo se stáhnout rozpoznávací model. Zkontroluj připojení a zkus to znovu.')
    // Each pretend engine fails once: the sound model first, and after "try again" the photo model.
    fireEvent.click(within(alert).getByRole('button', { name: 'Zkusit znovu' }))
    const second = await screen.findByRole('alert')
    expect(second.textContent).toContain('Zkontroluj připojení')
    fireEvent.click(within(second).getByRole('button', { name: 'Zkusit znovu' }))
    await waitFor(() => expect(screen.getByTestId('model-ready')).toBeTruthy(), { timeout: 5000 })
  })

  it('tells that the phone is full', async () => {
    window.localStorage.setItem('birddex:fake', 'storage-full')
    resetEngines()
    renderHub()
    fireEvent.click(screen.getByTestId('model-download'))
    expect((await screen.findByRole('alert')).textContent).toContain('V telefonu došlo místo')
  })
})
