// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { createElement as h } from 'react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseSpecies, resetSpeciesCache } from '../../src/data/species'

vi.mock('../../src/state/modelStatus', () => ({ useModelStatus: () => undefined }))
vi.mock('../../src/state/location', () => ({
  getCachedLocation: () => ({ lat: 50.08, lon: 14.43 }),
  getCurrentLocation: async () => ({ lat: 50.08, lon: 14.43 }),
}))

import { markPrepared, resetFakePrepared } from '../../src/features/scan/modelReadiness'
import { resetEngines } from '../../src/ml/engines'
import ScanLivePage from '../../src/pages/ScanLivePage'
import { clearPending, getPending } from '../../src/state/pending'
import { resetSettings } from '../../src/state/settings'

// jsdom has a <video> element but no camera and no playback: stand-ins that behave the way a phone does.
interface FakeTrack {
  stop: ReturnType<typeof vi.fn>
}
let tracks: FakeTrack[]
let streams: Array<{ getTracks: () => FakeTrack[] }>
let getUserMedia: ReturnType<typeof vi.fn>
let frames: { count: number }

function cameraWorks() {
  getUserMedia = vi.fn(async () => {
    const track: FakeTrack = { stop: vi.fn() }
    tracks.push(track)
    const stream = { getTracks: () => [track] }
    streams.push(stream)
    return stream
  })
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } })
}

function cameraFails(name: string) {
  getUserMedia = vi.fn(async () => {
    throw Object.assign(new Error(name), { name })
  })
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } })
}

/** The video gets a picture of 640x480, and a new one every 100 ms, as long as `frames.count` keeps growing. */
function videoShowsPictures() {
  Object.defineProperty(HTMLVideoElement.prototype, 'readyState', { configurable: true, get: () => 4 })
  Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', { configurable: true, get: () => 640 })
  Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', { configurable: true, get: () => 480 })
  Object.defineProperty(HTMLVideoElement.prototype, 'currentTime', { configurable: true, get: () => frames.count / 10 })
}

beforeAll(() => {
  resetSpeciesCache(parseSpecies(JSON.parse(readFileSync('public/data/species.json', 'utf8'))))
  HTMLMediaElement.prototype.play = vi.fn(async () => undefined)
  HTMLMediaElement.prototype.pause = vi.fn()
  // No canvas in jsdom: the pretend scanner then uses its stand-in picture for the snapshot.
  HTMLCanvasElement.prototype.getContext = vi.fn(() => null) as unknown as HTMLCanvasElement['getContext']
})

beforeEach(() => {
  window.localStorage.clear()
  window.localStorage.setItem('birddex:engines', 'fake')
  window.localStorage.setItem('birddex:fakeDelay', '5')
  resetEngines()
  resetFakePrepared()
  resetSettings()
  clearPending()
  tracks = []
  streams = []
  frames = { count: 1 }
  cameraWorks()
  videoShowsPictures()
})

afterEach(() => {
  cleanup()
  clearPending()
  vi.useRealTimers()
  vi.restoreAllMocks()
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => false })
})

const Where = () => h('output', { 'data-testid': 'where' }, useLocation().pathname)

function renderLive() {
  return render(
    h(
      MemoryRouter,
      { initialEntries: ['/scan/live'] },
      h(
        Routes,
        null,
        h(Route, { path: '/scan/live', element: h(ScanLivePage) }),
        h(Route, { path: '*', element: h(Where) }),
      ),
    ),
  )
}

const startKey = () => screen.getByTestId('live-start') as HTMLButtonElement
const catchKey = () => screen.getByTestId('live-catch') as HTMLButtonElement

async function prepared() {
  markPrepared('live')
  renderLive()
  await waitFor(() => expect(startKey().disabled).toBe(false))
}

/** Keeps new pictures coming while a test waits (the real camera does that by itself). */
function runCamera() {
  const timer = setInterval(() => (frames.count += 1), 100)
  return () => clearInterval(timer)
}

describe('before the camera is on', () => {
  it('shows a hint and a button that switches the camera on, and needs the download first', async () => {
    renderLive()
    expect(await screen.findByTestId('model-download')).toBeTruthy()
    expect(startKey().disabled).toBe(true)
    expect(screen.getByText('Namiř kameru na ptáka a sleduj, jak ho poznávám.')).toBeTruthy()
    expect(getUserMedia).not.toHaveBeenCalled()
  })

  it('does not ask for the camera before the person taps', async () => {
    await prepared()
    expect(getUserMedia).not.toHaveBeenCalled()
    expect(screen.queryByTestId('reticle')).toBeNull()
  })
})

describe('with the camera on', () => {
  it('asks for the back camera in full HD (zooming in needs the pixels), shows the reticle, and locks on a bird after a few frames', async () => {
    // Slow enough to see the moment before the lock.
    window.localStorage.setItem('birddex:fakeDelay', '150')
    resetEngines()
    await prepared()
    const stopCamera = runCamera()
    try {
      fireEvent.click(startKey())
      expect(getUserMedia).toHaveBeenCalledWith({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      })
      await screen.findByTestId('reticle')
      expect(catchKey().disabled).toBe(true)
      expect(screen.getByText('Tlačítko se odemkne, až ptáka zaměřím.')).toBeTruthy()
      await waitFor(() => expect(screen.getByTestId('live-view').getAttribute('data-locked')).toBe('true'), { timeout: 3000 })
      expect(screen.getByTestId('live-status').textContent).toBe('Mám ho na mušce!')
      expect(screen.getByTestId('live-guess').textContent).toContain('Sýkora koňadra')
      expect(catchKey().disabled).toBe(false)
    } finally {
      stopCamera()
    }
  })

  it('Catch takes the snapshot, builds the pending identification and opens the result screen with the camera off', async () => {
    await prepared()
    const stopCamera = runCamera()
    try {
      fireEvent.click(startKey())
      await waitFor(() => expect(catchKey().disabled).toBe(false), { timeout: 3000 })
      fireEvent.click(catchKey())
      await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/result'))
    } finally {
      stopCamera()
    }
    const pending = getPending()
    expect(pending?.method).toBe('live')
    expect(pending?.candidates[0].speciesId).toBe('parus-major')
    expect(pending?.media).toMatchObject({ kind: 'image', mime: 'image/jpeg' })
    expect(pending?.media?.blob.size).toBeGreaterThan(100)
    expect(pending?.location).toEqual({ lat: 50.08, lon: 14.43 })
    expect(tracks.every((track) => track.stop.mock.calls.length > 0)).toBe(true)
  })

  it('"Vypnout kameru" switches it off again and goes back to the start button', async () => {
    await prepared()
    const stopCamera = runCamera()
    try {
      fireEvent.click(startKey())
      await screen.findByTestId('reticle')
      fireEvent.click(screen.getByRole('button', { name: 'Vypnout kameru' }))
      await waitFor(() => expect(screen.getByTestId('live-start')).toBeTruthy())
      expect(tracks.every((track) => track.stop.mock.calls.length > 0)).toBe(true)
      expect(screen.queryByTestId('reticle')).toBeNull()
    } finally {
      stopCamera()
    }
  })

  it('switches the camera off when the person leaves the screen', async () => {
    await prepared()
    const stopCamera = runCamera()
    try {
      fireEvent.click(startKey())
      await screen.findByTestId('reticle')
      cleanup()
      expect(tracks.length).toBeGreaterThan(0)
      expect(tracks.every((track) => track.stop.mock.calls.length > 0)).toBe(true)
    } finally {
      stopCamera()
    }
  })

  it('switches the camera off when the page goes to the background and says so', async () => {
    await prepared()
    const stopCamera = runCamera()
    try {
      fireEvent.click(startKey())
      await screen.findByTestId('reticle')
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true })
      act(() => {
        document.dispatchEvent(new Event('visibilitychange'))
      })
      expect(await screen.findByText('Kamera se vypnula, když aplikace zmizela z obrazovky. Zapni ji znovu.')).toBeTruthy()
      expect(tracks.every((track) => track.stop.mock.calls.length > 0)).toBe(true)
      expect(screen.getByTestId('live-start')).toBeTruthy()
    } finally {
      stopCamera()
    }
  })

  it('does not give up when the page is hidden only while the camera question is open (an Android app is covered by it)', async () => {
    await prepared()
    const stopCamera = runCamera()
    try {
      let allow!: (stream: unknown) => void
      const track: FakeTrack = { stop: vi.fn() }
      tracks.push(track)
      getUserMedia.mockImplementation(() => new Promise((resolve) => (allow = resolve)))
      fireEvent.click(startKey())
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true })
      act(() => {
        document.dispatchEvent(new Event('visibilitychange'))
      })
      // The question is answered with yes, and the page is back.
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => false })
      await act(async () => {
        allow({ getTracks: () => [track] })
      })
      await waitFor(() => expect(screen.getByTestId('live-view').getAttribute('data-phase')).toBe('running'))
      expect(screen.queryByText('Kamera se vypnula, když aplikace zmizela z obrazovky. Zapni ji znovu.')).toBeNull()
      expect(track.stop).not.toHaveBeenCalled()
    } finally {
      stopCamera()
    }
  })

  it('takes the start button away at once, so a second tap cannot open a second camera', async () => {
    await prepared()
    const stopCamera = runCamera()
    try {
      fireEvent.click(startKey())
      expect(screen.queryByTestId('live-start')).toBeNull()
      expect(getUserMedia).toHaveBeenCalledTimes(1)
      await screen.findByTestId('reticle')
    } finally {
      stopCamera()
    }
  })

  it('switches a camera that opened too late off at once (the person left while the question was open)', async () => {
    await prepared()
    let release!: (stream: unknown) => void
    getUserMedia.mockImplementation(() => new Promise((resolve) => (release = resolve)))
    fireEvent.click(startKey())
    cleanup()
    const track: FakeTrack = { stop: vi.fn() }
    release({ getTracks: () => [track] })
    await waitFor(() => expect(track.stop).toHaveBeenCalled())
  })
})

describe('when the camera does not work', () => {
  it('explains a blocked camera with the steps for iPhone and Android and offers the photo screen', async () => {
    cameraFails('NotAllowedError')
    await prepared()
    fireEvent.click(startKey())
    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText('Chybí povolení ke kameře')).toBeTruthy()
    expect(alert.textContent).toContain('iPhone:')
    expect(alert.textContent).toContain('Android:')
    expect(within(alert).getByRole('link', { name: 'Místo toho vyfotit' }).getAttribute('href')).toBe('/scan/photo')
    expect(within(alert).getByRole('button', { name: 'Zkusit znovu' })).toBeTruthy()
  })

  it('"Zkusit znovu" opens the camera when the person has changed the setting', async () => {
    cameraFails('NotAllowedError')
    await prepared()
    fireEvent.click(startKey())
    const alert = await screen.findByRole('alert')
    cameraWorks()
    const stopCamera = runCamera()
    try {
      fireEvent.click(within(alert).getByRole('button', { name: 'Zkusit znovu' }))
      await screen.findByTestId('reticle')
      expect(screen.queryByRole('alert')).toBeNull()
    } finally {
      stopCamera()
    }
  })

  it('says when there is no camera', async () => {
    cameraFails('NotFoundError')
    await prepared()
    fireEvent.click(startKey())
    expect((await screen.findByRole('alert')).textContent).toContain('Kameru se nepodařilo najít')
  })

  it('says when another app is using the camera', async () => {
    cameraFails('NotReadableError')
    await prepared()
    fireEvent.click(startKey())
    expect((await screen.findByRole('alert')).textContent).toContain('Kameru právě používá jiná aplikace')
  })

  it('says when the browser has no camera interface at all (an address without https, an old browser)', async () => {
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined })
    await prepared()
    fireEvent.click(startKey())
    expect((await screen.findByRole('alert')).textContent).toContain('Tohle tvůj prohlížeč neumí')
  })

  it('gives up after six seconds without a picture, says so, and offers the photo screen', async () => {
    // A camera that opens but never sends a picture (the iPhone home-screen bug).
    Object.defineProperty(HTMLVideoElement.prototype, 'readyState', { configurable: true, get: () => 0 })
    Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', { configurable: true, get: () => 0 })
    await prepared()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance', 'Date'] })
    fireEvent.click(startKey())
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5500)
    })
    expect(screen.queryByText('Kamera nic neukazuje')).toBeNull()
    expect(screen.getByTestId('reticle')).toBeTruthy()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500)
    })
    const notice = screen.getByText('Kamera nic neukazuje').closest('[role]') as HTMLElement
    expect(notice.textContent).toContain('Z kamery nepřichází obraz')
    expect(within(notice).getByRole('link', { name: 'Místo toho vyfotit' }).getAttribute('href')).toBe('/scan/photo')
    expect(within(notice).getByRole('button', { name: 'Zkusit znovu' })).toBeTruthy()
    expect(tracks.every((track) => track.stop.mock.calls.length > 0)).toBe(true)
    expect(screen.queryByTestId('reticle')).toBeNull()
  })

  it('also notices a camera that stops sending pictures after it worked', async () => {
    await prepared()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance', 'Date'] })
    const keepGoing = setInterval(() => (frames.count += 1), 100)
    fireEvent.click(startKey())
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })
    clearInterval(keepGoing)
    expect(screen.queryByText('Kamera nic neukazuje')).toBeNull()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(7000)
    })
    expect(screen.getByText('Kamera nic neukazuje')).toBeTruthy()
  })
})

/** A camera that has a zoom of its own (an Android phone). */
function cameraWithZoom(range: { min: number; max: number }, failing = false) {
  const applyConstraints = vi.fn(async (constraints: { advanced?: Array<{ zoom?: number }> }) => {
    if (failing) throw new Error('OverconstrainedError')
    void constraints
  })
  getUserMedia = vi.fn(async () => {
    const track = { stop: vi.fn(), getCapabilities: () => ({ zoom: range }), getSettings: () => ({}), applyConstraints }
    tracks.push(track as unknown as FakeTrack)
    const stream = { getTracks: () => [track], getVideoTracks: () => [track] }
    streams.push(stream as unknown as (typeof streams)[number])
    return stream
  })
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } })
  return applyConstraints
}

const videoElement = () => screen.getByTestId('live-video') as HTMLVideoElement
const readout = () => screen.getByTestId('zoom-readout').textContent

describe('zoom', () => {
  it('is a full-screen layer over the device frame, and keeps the page behind it for the camera that is off', async () => {
    await prepared()
    const layer = screen.getByTestId('live-view')
    expect(layer.parentElement).toBe(document.body)
    expect(layer.className).not.toContain('is-on')
    const stopCamera = runCamera()
    try {
      fireEvent.click(startKey())
      await screen.findByTestId('reticle')
      expect(layer.className).toContain('is-on')
      // The start button and the idle card are gone while the camera is on; the layer has the controls.
      expect(screen.queryByTestId('live-start')).toBeNull()
      expect(screen.queryByTestId('live-idle')).toBeNull()
      expect(screen.getByRole('button', { name: 'Vypnout kameru' })).toBeTruthy()
      expect(screen.getByTestId('live-touch')).toBeTruthy()
    } finally {
      stopCamera()
    }
  })

  it('zooms the picture when a number is tapped (no zoom of its own: digital), and shows the zoom', async () => {
    await prepared()
    const stopCamera = runCamera()
    try {
      fireEvent.click(startKey())
      await screen.findByTestId('reticle')
      await screen.findByTestId('zoom-controls')
      expect(readout()).toBe('1×')
      expect(screen.getByText('Rozevři dva prsty nebo klepni na číslo a přibliž ptáka.')).toBeTruthy()
      const steps = within(screen.getByTestId('zoom-controls'))
        .getAllByRole('button')
        .map((button) => button.textContent)
      expect(steps).toEqual(['1×', '2×', '3×', '5×'])
      expect(screen.getByTestId('live-view').getAttribute('data-zoom-mode')).toBe('digital')

      fireEvent.click(screen.getByTestId('zoom-step-3'))
      expect(videoElement().style.transform).toBe('translate(0%, 0%) scale(3)')
      await waitFor(() => expect(readout()).toBe('3×'))
      expect(screen.getByTestId('live-view').getAttribute('data-zoom')).toBe('3.00')
      expect(screen.getByTestId('zoom-step-3').getAttribute('aria-pressed')).toBe('true')
      expect(screen.getByTestId('zoom-step-1').getAttribute('aria-pressed')).toBe('false')
      // The hint goes away once the picture is zoomed.
      expect(screen.queryByText('Rozevři dva prsty nebo klepni na číslo a přibliž ptáka.')).toBeNull()

      fireEvent.click(screen.getByTestId('zoom-step-1'))
      expect(videoElement().style.transform).toBe('')
      await waitFor(() => expect(readout()).toBe('1×'))
    } finally {
      stopCamera()
    }
  })

  it('lets go of the lock and switches Catch off at once when the view changes', async () => {
    window.localStorage.setItem('birddex:fakeDelay', '150')
    resetEngines()
    await prepared()
    const stopCamera = runCamera()
    try {
      fireEvent.click(startKey())
      await waitFor(() => expect(screen.getByTestId('live-view').getAttribute('data-locked')).toBe('true'), { timeout: 3000 })
      expect(catchKey().disabled).toBe(false)
      fireEvent.click(await screen.findByTestId('zoom-step-2'))
      expect(screen.getByTestId('live-view').getAttribute('data-locked')).toBeNull()
      expect(catchKey().disabled).toBe(true)
      expect(screen.getByTestId('live-status').textContent).toBe('Hledám ptáka…')
    } finally {
      stopCamera()
    }
  })

  it('goes back to 1x when the camera is switched off', async () => {
    await prepared()
    const stopCamera = runCamera()
    try {
      fireEvent.click(startKey())
      await screen.findByTestId('reticle')
      fireEvent.click(await screen.findByTestId('zoom-step-5'))
      expect(videoElement().style.transform).toBe('translate(0%, 0%) scale(5)')
      fireEvent.click(screen.getByRole('button', { name: 'Vypnout kameru' }))
      expect(videoElement().style.transform).toBe('')
      await waitFor(() => expect(startKey().disabled).toBe(false))
      fireEvent.click(startKey())
      await screen.findByTestId('reticle')
      expect(readout()).toBe('1×')
    } finally {
      stopCamera()
    }
  })

  it('uses the zoom of the camera when it has one: the picture itself stays as it is', async () => {
    const applyConstraints = cameraWithZoom({ min: 1, max: 8 })
    await prepared()
    const stopCamera = runCamera()
    try {
      fireEvent.click(startKey())
      await screen.findByTestId('reticle')
      await screen.findByTestId('zoom-controls')
      expect(screen.getByTestId('live-view').getAttribute('data-zoom-mode')).toBe('hardware')
      const steps = within(screen.getByTestId('zoom-controls'))
        .getAllByRole('button')
        .map((button) => button.textContent)
      expect(steps).toEqual(['1×', '2×', '3×', '5×', '8×'])
      fireEvent.click(screen.getByTestId('zoom-step-5'))
      await waitFor(() => expect(applyConstraints).toHaveBeenCalledWith({ advanced: [{ zoom: 5 }] }))
      expect(videoElement().style.transform).toBe('')
      await waitFor(() => expect(readout()).toBe('5×'))
    } finally {
      stopCamera()
    }
  })

  it('zooms the picture instead when the camera refuses its own zoom', async () => {
    const applyConstraints = cameraWithZoom({ min: 1, max: 8 }, true)
    await prepared()
    const stopCamera = runCamera()
    try {
      fireEvent.click(startKey())
      await screen.findByTestId('reticle')
      fireEvent.click(await screen.findByTestId('zoom-step-3'))
      await waitFor(() => expect(applyConstraints).toHaveBeenCalled())
      await waitFor(() => expect(screen.getByTestId('live-view').getAttribute('data-zoom-mode')).toBe('digital'))
      expect(readout()).toBe('1×')
      fireEvent.click(await screen.findByTestId('zoom-step-2'))
      expect(videoElement().style.transform).toBe('translate(0%, 0%) scale(2)')
    } finally {
      stopCamera()
    }
  })

  it('a pinch on the touch layer zooms, and the zoom stays between 1x and 6x', async () => {
    await prepared()
    const stopCamera = runCamera()
    try {
      fireEvent.click(startKey())
      await screen.findByTestId('reticle')
      const layer = screen.getByTestId('live-touch')
      // jsdom has no pointer capture; the handlers must not need it.
      fireEvent.pointerDown(layer, { pointerId: 1, clientX: 150, clientY: 400 })
      fireEvent.pointerDown(layer, { pointerId: 2, clientX: 250, clientY: 400 })
      fireEvent.pointerMove(layer, { pointerId: 2, clientX: 450, clientY: 400 })
      expect(videoElement().style.transform).toBe('translate(0%, 0%) scale(3)')
      fireEvent.pointerMove(layer, { pointerId: 2, clientX: 2500, clientY: 400 })
      expect(videoElement().style.transform).toBe('translate(0%, 0%) scale(6)')
      fireEvent.pointerUp(layer, { pointerId: 2 })
      fireEvent.pointerUp(layer, { pointerId: 1 })
      await waitFor(() => expect(readout()).toBe('6×'))
    } finally {
      stopCamera()
    }
  })
})
