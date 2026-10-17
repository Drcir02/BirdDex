// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { createElement as h } from 'react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseSpecies, resetSpeciesCache } from '../../src/data/species'
import type { SoundSession } from '../../src/domain/engines'

// The model store is not asked (the fake engines pretend), and the position is a fixed one.
vi.mock('../../src/state/modelStatus', () => ({ useModelStatus: () => undefined }))
const getCurrentLocation = vi.fn(async (_options?: { timeoutMs?: number }) => ({ lat: 50.08, lon: 14.43 }))
vi.mock('../../src/state/location', () => ({
  getCachedLocation: () => ({ lat: 50.08, lon: 14.43 }),
  getCurrentLocation: (options?: { timeoutMs?: number }) => getCurrentLocation(options),
}))

import { markPrepared, resetFakePrepared } from '../../src/features/scan/modelReadiness'
import { getEngines, resetEngines } from '../../src/ml/engines'
import ScanSoundPage from '../../src/pages/ScanSoundPage'
import { clearPending, getPending } from '../../src/state/pending'
import { resetSettings } from '../../src/state/settings'

beforeAll(() => {
  resetSpeciesCache(parseSpecies(JSON.parse(readFileSync('public/data/species.json', 'utf8'))))
})

beforeEach(() => {
  window.localStorage.clear()
  window.localStorage.setItem('birddex:engines', 'fake')
  window.localStorage.setItem('birddex:fakeDelay', '5')
  resetEngines()
  resetFakePrepared()
  resetSettings()
  clearPending()
  getCurrentLocation.mockClear()
})

afterEach(() => {
  cleanup()
  clearPending()
  vi.useRealTimers()
  vi.restoreAllMocks()
  setHidden(false)
})

function setHidden(hidden: boolean) {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden })
}

const Where = () => h('output', { 'data-testid': 'where' }, useLocation().pathname)

function renderSound() {
  return render(
    h(
      MemoryRouter,
      { initialEntries: ['/scan/sound'] },
      h(
        Routes,
        null,
        h(Route, { path: '/scan/sound', element: h(ScanSoundPage) }),
        h(Route, { path: '*', element: h(Where) }),
      ),
    ),
  )
}

const startKey = () => screen.getByTestId('sound-start') as HTMLButtonElement

async function prepared() {
  markPrepared('sound')
  renderSound()
  await waitFor(() => expect(startKey().disabled).toBe(false))
}

/** Lets the real fake engine run, but keeps a hold of the session it makes and of the options the screen passed. */
function spyOnStart() {
  const sessions: SoundSession[] = []
  const options: Array<Parameters<ReturnType<typeof getEngines>['sound']['start']>[0]> = []
  const engine = getEngines().sound
  const real = engine.start.bind(engine)
  vi.spyOn(engine, 'start').mockImplementation(async (given) => {
    options.push(given)
    const session = await real(given)
    const stop = session.stop.bind(session)
    session.stop = vi.fn(stop)
    sessions.push(session)
    return session
  })
  return { sessions, options }
}

describe('getting the engine ready', () => {
  it('offers the download first, with the size and Wi-Fi advice, and keeps the key off', async () => {
    renderSound()
    const banner = await screen.findByTestId('model-banner')
    expect(within(banner).getByRole('button', { name: 'Stáhnout ptačí mozek' })).toBeTruthy()
    expect(within(banner).getByText(/asi 40 MB, nejlépe přes Wi-Fi/)).toBeTruthy()
    expect(startKey().disabled).toBe(true)
    // A key that is off looks off (grey and solid); one that is busy keeps its colour and shows the spinner.
    expect(startKey().classList.contains('is-off')).toBe(true)
    // Nothing to keep in reach yet: the key sits at the end of the screen instead of floating over it.
    expect(document.querySelector('.bd-scan-controls')?.classList.contains('is-static')).toBe(true)
  })

  it('shows the download going and then turns the key on', async () => {
    window.localStorage.setItem('birddex:fakeDelay', '60')
    resetEngines()
    renderSound()
    fireEvent.click(await screen.findByTestId('model-download'))
    expect(await screen.findByRole('progressbar', { name: 'Stahování ptačího mozku' })).toBeTruthy()
    await waitFor(() => expect(startKey().disabled).toBe(false), { timeout: 3000 })
    expect(screen.queryByTestId('model-banner')).toBeNull()
  })

  it('skips the download for an engine that was prepared before, and starts it by itself', async () => {
    await prepared()
    expect(screen.queryByTestId('model-banner')).toBeNull()
    // The key of a screen that is ready stays at the bottom of the screen while the rest scrolls.
    expect(document.querySelector('.bd-scan-controls')?.classList.contains('is-static')).toBe(false)
  })

  it('says calmly what went wrong and offers "Zkusit znovu", which works the second time', async () => {
    window.localStorage.setItem('birddex:fake', 'download-error')
    resetEngines()
    renderSound()
    fireEvent.click(await screen.findByTestId('model-download'))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Nepodařilo se stáhnout rozpoznávací model')
    fireEvent.click(within(alert).getByRole('button', { name: 'Zkusit znovu' }))
    await waitFor(() => expect(startKey().disabled).toBe(false), { timeout: 3000 })
  })

  it('tells that the phone is full', async () => {
    window.localStorage.setItem('birddex:fake', 'storage-full')
    resetEngines()
    renderSound()
    fireEvent.click(await screen.findByTestId('model-download'))
    expect((await screen.findByRole('alert')).textContent).toContain('V telefonu došlo místo')
  })
})

describe('listening', () => {
  it('starts the engine inside the tap itself (iOS only opens the microphone inside a tap)', async () => {
    await prepared()
    const { options } = spyOnStart()
    fireEvent.click(startKey())
    // No await has happened since the click: the engine was called by the click handler itself.
    expect(getEngines().sound.start).toHaveBeenCalledTimes(1)
    expect(options[0].location).toEqual({ lat: 50.08, lon: 14.43 })
    await screen.findByTestId('sound-stop')
  })

  it('asks for the position once the microphone is open (the two questions do not compete), without waiting for the answer', async () => {
    await prepared()
    fireEvent.click(startKey())
    await screen.findByTestId('sound-stop')
    await waitFor(() => expect(getCurrentLocation).toHaveBeenCalledWith({ timeoutMs: 0 }))
  })

  it('does not ask for the position when the microphone is refused', async () => {
    await prepared()
    vi.spyOn(getEngines().sound, 'start').mockRejectedValueOnce(Object.assign(new Error('no'), { name: 'SoundCaptureError', reason: 'denied' }))
    fireEvent.click(startKey())
    await screen.findByRole('alert')
    expect(getCurrentLocation).not.toHaveBeenCalled()
  })

  it('shows the level, the top guesses with Czech names and "I hear a bird" while it listens', async () => {
    await prepared()
    fireEvent.click(startKey())
    await waitFor(() => expect(screen.getAllByTestId('guess').length).toBeGreaterThan(0), { timeout: 3000 })
    await waitFor(() => expect(screen.getByTestId('hearing-bird').getAttribute('data-on')).toBe('true'), { timeout: 3000 })
    expect(screen.getByTestId('hearing-bird').textContent).toBe('Slyším ptáka!')
    expect(screen.getAllByTestId('guess-name')[0].textContent).toBe('Sýkora koňadra')
    expect(screen.getByRole('meter', { name: 'Hlasitost mikrofonu' })).toBeTruthy()
    expect(screen.getByRole('timer', { name: 'Čas poslechu' })).toBeTruthy()
  })

  it('does not list a guess that would show as 0 %', async () => {
    await prepared()
    const { options } = spyOnStart()
    fireEvent.click(startKey())
    await screen.findByTestId('sound-stop')
    act(() =>
      options[0].onUpdate({
        candidates: [
          { speciesId: 'parus-major', confidence: 0.8 },
          { speciesId: 'turdus-merula', confidence: 0.02 },
          { speciesId: 'erithacus-rubecula', confidence: 0.001 },
        ],
        level: 0.4,
        analysedSeconds: 3,
        hearingBird: true,
      }),
    )
    await waitFor(() => expect(screen.getAllByTestId('guess-name').map((node) => node.textContent)).toEqual(['Sýkora koňadra', 'Kos černý']))
  })

  it('shows the elapsed time next to the minute limit', async () => {
    await prepared()
    fireEvent.click(startKey())
    await screen.findByTestId('sound-stop')
    expect(screen.getByTestId('elapsed').textContent).toBe('0:00')
    expect(screen.getByRole('timer').textContent).toContain('1:00')
  })
})

describe('Done', () => {
  it('collects the result, builds the pending identification with the clip and the place, and opens the result screen', async () => {
    await prepared()
    fireEvent.click(startKey())
    await waitFor(() => expect(screen.getAllByTestId('guess-percent')[0]?.textContent).toMatch(/9\d\s%/), { timeout: 3000 })
    fireEvent.click(screen.getByTestId('sound-stop'))
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/result'))
    const pending = getPending()
    expect(pending?.method).toBe('sound')
    expect(pending?.candidates[0].speciesId).toBe('parus-major')
    expect(pending?.candidates[0].confidence).toBeGreaterThan(0.9)
    expect(pending?.media).toMatchObject({ kind: 'audio', mime: 'audio/wav', durationS: 2 })
    expect(pending?.media?.blob.size).toBeGreaterThan(1000)
    expect(pending?.location).toEqual({ lat: 50.08, lon: 14.43 })
  })

  it('still opens the result screen when nothing was heard yet (it explains "nothing sure" there)', async () => {
    window.localStorage.setItem('birddex:fakeDelay', '200')
    resetEngines()
    await prepared()
    fireEvent.click(startKey())
    fireEvent.click(await screen.findByTestId('sound-stop'))
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/result'))
    expect(getPending()?.candidates).toEqual([])
    expect(getPending()?.media).toBeUndefined()
  })

  it('stops by itself after a minute and goes to the result screen', async () => {
    // Get the screen ready with quick fake engines and real timers, then slow the engines down and let the clock run by hand.
    await prepared()
    window.localStorage.setItem('birddex:fakeDelay', '1000')
    resetEngines()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
    fireEvent.click(startKey())
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000)
    })
    expect(screen.queryByTestId('where')).toBeNull()
    expect(screen.getByTestId('sound-stop')).toBeTruthy()
    // The pretend engine needs three seconds to wake up, and the minute counts from the moment the microphone is open.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(40_000)
    })
    expect(screen.getByTestId('where').textContent).toBe('/result')
    expect(getPending()?.method).toBe('sound')
  })
})

describe('when things go wrong', () => {
  const capture = (reason: string) => Object.assign(new Error(`capture ${reason}`), { name: 'SoundCaptureError', reason })

  it('explains a blocked microphone with the steps for iPhone and Android, and tries again on request', async () => {
    await prepared()
    const engine = getEngines().sound
    vi.spyOn(engine, 'start').mockRejectedValueOnce(capture('denied'))
    fireEvent.click(startKey())
    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText('Chybí povolení k mikrofonu')).toBeTruthy()
    expect(alert.textContent).toContain('Povol ho v nastavení prohlížeče nebo telefonu')
    expect(alert.textContent).toContain('iPhone:')
    expect(alert.textContent).toContain('Android:')
    expect(alert.textContent).toContain('Aplikace na ploše')
    // The record key is out of the way while the help is shown, and "try again" is the way on.
    expect(screen.queryByTestId('sound-start')).toBeNull()
    fireEvent.click(within(alert).getByRole('button', { name: 'Zkusit znovu' }))
    await screen.findByTestId('sound-stop')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('says there is no microphone, and points to the photo screen', async () => {
    await prepared()
    vi.spyOn(getEngines().sound, 'start').mockRejectedValueOnce(capture('no-device'))
    fireEvent.click(startKey())
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Mikrofon se nepodařilo najít')
    expect(within(alert).getByRole('link', { name: 'Místo toho vyfotit' }).getAttribute('href')).toBe('/scan/photo')
  })

  it('says it for an engine that cannot start at all', async () => {
    await prepared()
    vi.spyOn(getEngines().sound, 'start').mockRejectedValueOnce(Object.assign(new Error('x'), { name: 'ModelLoadError' }))
    fireEvent.click(startKey())
    expect((await screen.findByRole('alert')).textContent).toContain('Rozpoznávací model se nepodařilo spustit')
  })

  it('pauses when the page goes to the background and offers to look at what was heard', async () => {
    await prepared()
    const { sessions } = spyOnStart()
    fireEvent.click(startKey())
    await waitFor(() => expect(screen.getAllByTestId('guess').length).toBeGreaterThan(0), { timeout: 3000 })
    setHidden(true)
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(await screen.findByText('Poslech se zastavil')).toBeTruthy()
    expect(screen.getByText('Když aplikace zmizí z obrazovky, telefon mi vypne mikrofon.')).toBeTruthy()
    expect(sessions[0].stop).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('sound-stop')).toBeNull()

    setHidden(false)
    fireEvent.click(screen.getByRole('button', { name: 'Zobrazit výsledek' }))
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/result'))
    expect(getPending()?.candidates[0].speciesId).toBe('parus-major')
  })

  it('does not pause for a page that is hidden only while the microphone question is open (an Android app is covered by it)', async () => {
    await prepared()
    let allow!: (session: SoundSession) => void
    const stop = vi.fn(async () => ({ candidates: [] }))
    vi.spyOn(getEngines().sound, 'start').mockImplementation(() => new Promise<SoundSession>((resolve) => (allow = resolve)))
    fireEvent.click(startKey())
    setHidden(true)
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    // The question is answered with yes, and the page is back by the time the microphone opens.
    setHidden(false)
    await act(async () => {
      allow({ stop })
    })
    await screen.findByTestId('sound-stop')
    expect(screen.queryByText('Poslech se zastavil')).toBeNull()
    expect(stop).not.toHaveBeenCalled()
  })

  it('pauses at once when the page is still hidden by the time the microphone opens', async () => {
    await prepared()
    let allow!: (session: SoundSession) => void
    const stop = vi.fn(async () => ({ candidates: [] }))
    vi.spyOn(getEngines().sound, 'start').mockImplementation(() => new Promise<SoundSession>((resolve) => (allow = resolve)))
    fireEvent.click(startKey())
    setHidden(true)
    await act(async () => {
      allow({ stop })
    })
    expect(await screen.findByText('Poslech se zastavil')).toBeTruthy()
    expect(stop).toHaveBeenCalledTimes(1)
  })

  it('offers to listen again after a pause, which starts a fresh scan', async () => {
    await prepared()
    fireEvent.click(startKey())
    await screen.findByTestId('sound-stop')
    setHidden(true)
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    const again = await screen.findByRole('button', { name: 'Poslouchat znovu' })
    setHidden(false)
    fireEvent.click(again)
    await screen.findByTestId('sound-stop')
    expect(screen.queryByText('Poslech se zastavil')).toBeNull()
  })

  it('pauses when the phone takes the microphone away (a call, a pulled headset)', async () => {
    await prepared()
    const { options } = spyOnStart()
    fireEvent.click(startKey())
    await screen.findByTestId('sound-stop')
    act(() => options[0].onError?.(capture('interrupted')))
    expect(await screen.findByText('Poslech se zastavil')).toBeTruthy()
    expect(screen.getByText(/Mikrofon se přestal ozývat/)).toBeTruthy()
  })

  it('releases the microphone when the person leaves the screen while it listens', async () => {
    await prepared()
    const { sessions } = spyOnStart()
    fireEvent.click(startKey())
    await screen.findByTestId('sound-stop')
    cleanup()
    expect(sessions[0].stop).toHaveBeenCalled()
  })

  it('releases the microphone at once when the person left while the permission question was still open', async () => {
    await prepared()
    let release!: (session: SoundSession) => void
    const stop = vi.fn(async () => ({ candidates: [] }))
    vi.spyOn(getEngines().sound, 'start').mockImplementation(() => new Promise<SoundSession>((resolve) => (release = resolve)))
    fireEvent.click(startKey())
    cleanup()
    release({ stop })
    await waitFor(() => expect(stop).toHaveBeenCalledTimes(1))
  })

  it('ignores a second tap while the microphone is opening', async () => {
    await prepared()
    const engine = getEngines().sound
    const start = vi.spyOn(engine, 'start').mockImplementation(() => new Promise<SoundSession>(() => undefined))
    fireEvent.click(startKey())
    fireEvent.click(screen.getByTestId('sound-start'))
    expect(start).toHaveBeenCalledTimes(1)
    expect(startKey().classList.contains('is-busy')).toBe(true)
    expect(startKey().classList.contains('is-off')).toBe(false)
  })
})
