// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { createElement as h } from 'react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseSpecies, resetSpeciesCache } from '../../src/data/species'
import type { CatchRecord, Candidate, PendingIdentification } from '../../src/domain/types'

// The database, the reference photos and the place lookup are other tasks' business (and need a browser): stand-ins.
const addCatch = vi.fn()
const addCatches = vi.fn()
let caught = new Map<string, { count: number }>()
vi.mock('../../src/db', () => ({
  addCatch: (...args: unknown[]) => addCatch(...args),
  addCatches: (...args: unknown[]) => addCatches(...args),
  useCaughtSummary: () => ({ ready: true, bySpecies: caught, speciesCount: caught.size, catchCount: 0 }),
}))
vi.mock('../../src/features/scan/useReferencePhoto', () => ({ useReferencePhoto: () => ({ status: 'none' }) }))
let placeName: string | undefined
const resolvePlaceName = vi.fn(async (_point: unknown) => placeName)
vi.mock('../../src/features/scan/placeName', () => ({ resolvePlaceName: (point: unknown) => resolvePlaceName(point) }))

import ResultPage from '../../src/pages/ResultPage'
import { clearPending, getPending, getPendingCatchId, setPending } from '../../src/state/pending'
import { resetSettings, updateSettings } from '../../src/state/settings'

beforeAll(() => {
  // jsdom has no object URLs, which the picture and the clip preview use.
  URL.createObjectURL = vi.fn(() => 'blob:test')
  URL.revokeObjectURL = vi.fn()
  resetSpeciesCache(parseSpecies(JSON.parse(readFileSync('public/data/species.json', 'utf8'))))
})

beforeEach(() => {
  addCatch.mockReset()
  addCatch.mockImplementation(async (input: { id?: string; speciesId: string; method: CatchRecord['method']; confidence: number; caughtAt?: number }) => ({
    id: input.id ?? 'saved',
    speciesId: input.speciesId,
    method: input.method,
    confidence: input.confidence,
    caughtAt: input.caughtAt ?? 0,
  }))
  addCatches.mockReset()
  addCatches.mockImplementation(async (inputs: { id?: string; speciesId: string }[]) => inputs.map((input) => ({ id: input.id ?? 'saved', speciesId: input.speciesId })))
  caught = new Map()
  placeName = undefined
  resolvePlaceName.mockClear()
  window.localStorage.clear()
  resetSettings()
  clearPending()
})

afterEach(() => {
  cleanup()
  clearPending()
  // jsdom has no scrollIntoView; a test that stubs it must not leak the stub.
  Reflect.deleteProperty(Element.prototype, 'scrollIntoView')
})

const guess = (speciesId: string, confidence: number): Candidate => ({ speciesId, confidence })

function pending(overrides: Partial<PendingIdentification> = {}): PendingIdentification {
  return {
    method: 'sound',
    candidates: [guess('parus-major', 0.91), guess('turdus-merula', 0.22), guess('erithacus-rubecula', 0.09)],
    media: { kind: 'audio', blob: new Blob(['RIFF'], { type: 'audio/wav' }), mime: 'audio/wav', durationS: 2 },
    location: { lat: 50.08, lon: 14.43 },
    createdAt: new Date(2026, 9, 17, 3, 15).getTime(),
    ...overrides,
  }
}

const Where = () => h('output', { 'data-testid': 'where' }, useLocation().pathname)

function renderResult(container?: HTMLElement) {
  return render(
    h(
      MemoryRouter,
      { initialEntries: ['/result'] },
      h(
        Routes,
        null,
        h(Route, { path: '/result', element: h(ResultPage) }),
        h(Route, { path: '*', element: h(Where) }),
      ),
    ),
    container ? { container } : undefined,
  )
}

const cards = () => screen.getAllByTestId('result-card')

describe('with nothing to decide', () => {
  it('sends the person back to the scan hub', () => {
    renderResult()
    expect(screen.getByTestId('where').textContent).toBe('/scan')
  })
})

describe('the guesses', () => {
  it('shows up to three cards with Czech and scientific names, rarity and how sure', async () => {
    setPending(pending())
    renderResult()
    await waitFor(() => expect(cards()).toHaveLength(3))
    expect(within(cards()[0]).getByRole('heading', { name: 'Sýkora koňadra' })).toBeTruthy()
    expect(within(cards()[0]).getByText('Parus major')).toBeTruthy()
    expect(within(cards()[0]).getByText('Běžný')).toBeTruthy()
    expect(within(cards()[0]).getByRole('meter').getAttribute('aria-valuetext')).toMatch(/^91\s%$/)
    expect(within(cards()[1]).getByRole('heading', { name: 'Kos černý' })).toBeTruthy()
    expect(within(cards()[2]).getByRole('heading', { name: 'Červenka obecná' })).toBeTruthy()
  })

  it('keeps Catch available for every guess (the person decides), and names the reason for the unsure ones in Czech', async () => {
    setPending(pending())
    renderResult()
    await waitFor(() => expect(cards()).toHaveLength(3))
    const button = (index: number) => within(cards()[index]).getByRole('button', { name: 'Chytit' }) as HTMLButtonElement
    expect(button(0).disabled).toBe(false)
    expect(button(1).disabled).toBe(false)
    expect(button(2).disabled).toBe(false)
    expect(cards()[0].getAttribute('data-allowed')).toBe('true')
    expect(cards()[1].getAttribute('data-allowed')).toBe('false')
    expect(within(cards()[1]).getByTestId('catch-reason').textContent).toMatch(/^Zatím to není dost jisté\. Potřebuju aspoň 70\s%\.$/)
    expect(within(cards()[0]).queryByTestId('catch-reason')).toBeNull()
    expect(button(1).getAttribute('aria-describedby')).toBe(within(cards()[1]).getByTestId('catch-reason').id)
  })

  it('does not call a confident guess unsure just because another guess is close', async () => {
    setPending(pending({ method: 'photo', candidates: [guess('turdus-merula', 0.78), guess('parus-major', 0.74)] }))
    renderResult()
    await waitFor(() => expect(cards()).toHaveLength(2))
    expect(within(cards()[0]).queryByTestId('catch-reason')).toBeNull()
    expect(cards()[0].getAttribute('data-allowed')).toBe('true')
  })

  it('says whether the species is new or already in the Dex', async () => {
    caught = new Map([['parus-major', { count: 3 }]])
    setPending(pending())
    renderResult()
    await waitFor(() => expect(cards()).toHaveLength(3))
    expect(within(cards()[0]).getByText('Už v Dexu (3×)')).toBeTruthy()
    expect(within(cards()[1]).getByText('Nový druh')).toBeTruthy()
  })

  it('follows the sensitivity of the settings', async () => {
    updateSettings({ sensitivity: 'strict' })
    setPending(pending({ candidates: [guess('parus-major', 0.8)] }))
    renderResult()
    await waitFor(() => expect(cards()).toHaveLength(1))
    expect((within(cards()[0]).getByRole('button', { name: 'Chytit' }) as HTMLButtonElement).disabled).toBe(false)
    expect(within(cards()[0]).getByTestId('catch-reason').textContent).toMatch(/85\s%/)
  })

  it('an unsure guess can be caught after a confirmation that says the app is unsure', async () => {
    setPending(pending({ candidates: [guess('parus-major', 0.5)] }))
    renderResult()
    await waitFor(() => expect(cards()).toHaveLength(1))
    fireEvent.click(within(cards()[0]).getByRole('button', { name: 'Chytit' }))
    expect(await screen.findByTestId('confirm-unsure')).toBeTruthy()
    expect(screen.getByTestId('confirm-text').textContent).toContain('o tom rozhoduješ ty')
  })

  it('a sure guess is confirmed without that warning', async () => {
    setPending(pending({ candidates: [guess('parus-major', 0.95)] }))
    renderResult()
    await waitFor(() => expect(cards()).toHaveLength(1))
    fireEvent.click(within(cards()[0]).getByRole('button', { name: 'Chytit' }))
    await screen.findByTestId('confirm-text')
    expect(screen.queryByTestId('confirm-unsure')).toBeNull()
  })
})

describe('what will be saved', () => {
  it('shows the date, the time and the place, and the clip', async () => {
    setPending(pending())
    renderResult()
    await waitFor(() => expect(cards()).toHaveLength(3))
    expect(screen.getByTestId('result-when').textContent).toBe('17. 10. 2026 · 3:15')
    expect(screen.getByTestId('result-where').textContent).toBe('50,08° S, 14,43° V')
    expect(screen.getByTestId('result-audio')).toBeTruthy()
  })

  it('sends nothing about the position until the catch is confirmed', async () => {
    placeName = 'Praha'
    setPending(pending())
    renderResult()
    await waitFor(() => expect(cards()).toHaveLength(3))
    // The result is on screen with its coordinates; the place name has not been asked for (also not if it is discarded).
    expect(screen.getByTestId('result-where').textContent).toBe('50,08° S, 14,43° V')
    expect(resolvePlaceName).not.toHaveBeenCalled()
  })

  it('says when there is no place, and shows the photo of a photo scan', async () => {
    setPending(pending({ method: 'photo', location: undefined, media: { kind: 'image', blob: new Blob(['jpeg'], { type: 'image/jpeg' }), mime: 'image/jpeg' } }))
    renderResult()
    await waitFor(() => expect(cards()).toHaveLength(3))
    expect(screen.getByTestId('result-where').textContent).toBe('Místo neznámé')
    expect(screen.getByText(/poloha není povolená, nebo ho fotka neobsahuje/)).toBeTruthy()
    expect(screen.getByTestId('result-image')).toBeTruthy()
  })
})

describe('when nothing is sure enough', () => {
  it('is friendly about it, gives tips for the way of scanning, and still shows the guesses with their reasons', async () => {
    setPending(pending({ method: 'photo', candidates: [guess('erithacus-rubecula', 0.41), guess('parus-major', 0.23)] }))
    renderResult()
    const panel = await screen.findByTestId('nothing-sure')
    expect(within(panel).getByRole('heading', { name: 'Nic jistého' })).toBeTruthy()
    expect(within(panel).getByText('Fotku ořízni jen na ptáka.')).toBeTruthy()
    expect(within(panel).getByRole('link', { name: 'Citlivost rozpoznávání změníš v\u00A0Nastavení.' }).getAttribute('href')).toBe('/settings')
    expect(screen.getByRole('heading', { name: 'Moje tipy, zatím nejisté' })).toBeTruthy()
    expect(cards()).toHaveLength(2)
  })

  it('has other tips for listening and for the live camera', async () => {
    setPending(pending({ candidates: [guess('parus-major', 0.3)] }))
    renderResult()
    expect(await screen.findByText('Poslouchej aspoň deset sekund.')).toBeTruthy()
    cleanup()
    setPending(pending({ method: 'live', candidates: [guess('parus-major', 0.3)] }))
    renderResult()
    expect(await screen.findByText('Dobré světlo hodně pomáhá.')).toBeTruthy()
  })

  it('says so when there was not even a guess, and shows no cards', async () => {
    setPending(pending({ candidates: [], media: undefined }))
    renderResult()
    const panel = await screen.findByTestId('nothing-sure')
    expect(within(panel).getByText(/nepodařilo nic poznat/)).toBeTruthy()
    expect(screen.queryAllByTestId('result-card')).toHaveLength(0)
  })

  it('"Zkusit znovu" goes back to the screen that made the scan and drops the old result', async () => {
    setPending(pending({ method: 'photo', candidates: [guess('erithacus-rubecula', 0.41)] }))
    renderResult()
    fireEvent.click(await screen.findByTestId('retry-scan'))
    expect(screen.getByTestId('where').textContent).toBe('/scan/photo')
    expect(getPending()).toBeUndefined()
  })
})

describe('catching', () => {
  it('asks first, in Czech, with the name of the bird on its own line', async () => {
    setPending(pending())
    renderResult()
    await waitFor(() => expect(cards()).toHaveLength(3))
    fireEvent.click(within(cards()[0]).getByRole('button', { name: 'Chytit' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Přidat do Dexu?' })
    expect(within(dialog).getByText('Sýkora koňadra')).toBeTruthy()
    expect(within(dialog).getByText('Uložím ho i s datem, místem a nahrávkou.')).toBeTruthy()
    expect(addCatch).not.toHaveBeenCalled()
  })

  it('does nothing when the person says "Ještě ne"', async () => {
    setPending(pending())
    renderResult()
    await waitFor(() => expect(cards()).toHaveLength(3))
    fireEvent.click(within(cards()[0]).getByRole('button', { name: 'Chytit' }))
    const dialog = await screen.findByRole('alertdialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Ještě ne' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(addCatch).not.toHaveBeenCalled()
    expect(getPending()).toBeDefined()
  })

  it('saves the catch with its media, time, place and confidence, then shows the success screen', async () => {
    placeName = 'Praha'
    const scan = pending()
    setPending(scan)
    const catchId = getPendingCatchId()
    renderResult()
    await waitFor(() => expect(cards()).toHaveLength(3))
    fireEvent.click(within(cards()[0]).getByRole('button', { name: 'Chytit' }))
    const dialog = await screen.findByRole('alertdialog')
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Chytit' }))
    })

    expect(addCatch).toHaveBeenCalledTimes(1)
    expect(resolvePlaceName).toHaveBeenCalledTimes(1)
    expect(resolvePlaceName).toHaveBeenCalledWith({ lat: 50.08, lon: 14.43 })
    const [input, media] = addCatch.mock.calls[0] as [Record<string, unknown>, Record<string, unknown>]
    expect(input).toMatchObject({
      id: catchId,
      speciesId: 'parus-major',
      method: 'sound',
      confidence: 0.91,
      caughtAt: scan.createdAt,
      location: { lat: 50.08, lon: 14.43 },
      placeName: 'Praha',
    })
    // The BirdPoints go in with the catch: the result, the quality, the luck, the five scores and the range they were made against.
    const points = input.birdPoints as { bp: number; bpBase: number; bpQ: number; bpLuck: number; bpFactors: number[]; bpRange: [number, number] }
    const range = parseSpecies(JSON.parse(readFileSync('public/data/species.json', 'utf8'))).find((bird) => bird.id === 'parus-major')!.info!.bp!
    expect(points.bpRange).toEqual(range)
    expect(points.bp).toBeGreaterThanOrEqual(range[0])
    expect(points.bp).toBeLessThanOrEqual(range[1])
    expect(points.bpQ).toBeGreaterThan(0)
    expect(points.bpQ).toBeLessThanOrEqual(1)
    expect(points.bpLuck).toBeGreaterThanOrEqual(-0.09)
    expect(points.bpLuck).toBeLessThanOrEqual(0.13)
    expect(points.bpFactors).toHaveLength(5)
    expect(media).toMatchObject({ kind: 'audio', mime: 'audio/wav', durationS: 2 })
    expect(media.blob).toBe(scan.media?.blob)

    // The success screen: the sentence, both ways on, and the identification is gone so it cannot be saved twice.
    expect((await screen.findByTestId('catch-message')).textContent).toBe('Máš ho! Sýkora koňadra je v Dexu.')
    expect(screen.getByTestId('celebration')).toBeTruthy()
    expect(screen.getByText('Nový druh v tvém Dexu!')).toBeTruthy()
    // The BP of the bird, big, and the way to its page.
    expect(screen.getByTestId('bp-value').textContent).toBe(String(points.bp))
    expect(screen.getByTestId('bp-bar').getAttribute('aria-valuenow')).toBe(String(points.bp))
    expect(screen.getByTestId('bp-detail').textContent).toBe(`Základ ${points.bpBase}, štěstí ${points.bp - points.bpBase >= 0 ? '+' : '−'}${Math.abs(points.bp - points.bpBase)}`)
    expect(screen.getByRole('link', { name: 'Zobrazit ptáka' }).getAttribute('href')).toBe(`/birds/${catchId}`)
    expect(screen.getByRole('link', { name: 'Skenovat dál' }).getAttribute('href')).toBe('/scan')
    expect(getPending()).toBeUndefined()
    expect(screen.queryByTestId('where')).toBeNull()
  })

  it('saves a catch that the live camera made by itself at once, without the question', async () => {
    setPending(pending({ method: 'live', autoCatch: true, media: { kind: 'image', blob: new Blob(['x'], { type: 'image/jpeg' }), mime: 'image/jpeg' } }))
    renderResult()
    expect((await screen.findByTestId('catch-message')).textContent).toBe('Máš ho! Sýkora koňadra je v Dexu.')
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(addCatch).toHaveBeenCalledTimes(1)
    expect(addCatch.mock.calls[0][0]).toMatchObject({ speciesId: 'parus-major', method: 'live' })
    expect(getPending()).toBeUndefined()
  })

  it('does not save an automatic catch whose guess is below the percentage, and shows the result as usual', async () => {
    setPending(pending({ method: 'live', autoCatch: true, candidates: [guess('parus-major', 0.4)] }))
    renderResult()
    await waitFor(() => expect(cards()).toHaveLength(1))
    expect(addCatch).not.toHaveBeenCalled()
  })

  it('starts the success screen at the top of the scrolling screen (the result was scrolled down to the button)', async () => {
    setPending(pending())
    const scroller = document.body.appendChild(document.createElement('div'))
    scroller.style.overflowY = 'auto'
    let top = 420
    Object.defineProperty(scroller, 'scrollTop', { configurable: true, get: () => top, set: (value: number) => (top = value) })
    try {
      renderResult(scroller)
      await waitFor(() => expect(cards()).toHaveLength(3))
      expect(top).toBe(420)
      fireEvent.click(within(cards()[0]).getByRole('button', { name: 'Chytit' }))
      const dialog = await screen.findByRole('alertdialog')
      await act(async () => {
        fireEvent.click(within(dialog).getByRole('button', { name: 'Chytit' }))
      })
      await screen.findByTestId('catch-success')
      expect(top).toBe(0)
    } finally {
      cleanup()
      scroller.remove()
    }
  })

  it('knows the species was in the Dex already', async () => {
    caught = new Map([['parus-major', { count: 1 }]])
    setPending(pending())
    renderResult()
    await waitFor(() => expect(cards()).toHaveLength(3))
    fireEvent.click(within(cards()[0]).getByRole('button', { name: 'Chytit' }))
    const dialog = await screen.findByRole('alertdialog')
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Chytit' }))
    })
    expect(await screen.findByText('Další úlovek tohoto druhu.')).toBeTruthy()
  })

  it('saves a photo catch with the picture and without a place when there is none', async () => {
    setPending(pending({ method: 'photo', location: undefined, candidates: [guess('anas-platyrhynchos', 0.97)], media: { kind: 'image', blob: new Blob(['jpeg'], { type: 'image/jpeg' }), mime: 'image/jpeg' } }))
    renderResult()
    await waitFor(() => expect(cards()).toHaveLength(1))
    fireEvent.click(within(cards()[0]).getByRole('button', { name: 'Chytit' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText('Uložím ho i s datem, místem a fotkou.')).toBeTruthy()
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Chytit' }))
    })
    const [input, media] = addCatch.mock.calls[0] as [Record<string, unknown>, Record<string, unknown>]
    expect(input).toMatchObject({ speciesId: 'anas-platyrhynchos', method: 'photo' })
    expect(input.location).toBeUndefined()
    expect(media).toMatchObject({ kind: 'image', mime: 'image/jpeg' })
  })

  it('says calmly when the phone is full, keeps the result and lets the person try again', async () => {
    const scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView
    const full = Object.assign(new Error('full'), { name: 'StorageFullError' })
    addCatch.mockRejectedValueOnce(full)
    setPending(pending())
    renderResult()
    await waitFor(() => expect(cards()).toHaveLength(3))
    fireEvent.click(within(cards()[0]).getByRole('button', { name: 'Chytit' }))
    const dialog = await screen.findByRole('alertdialog')
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Chytit' }))
    })
    const message = await screen.findByText('V telefonu došlo místo. Uvolni trochu paměti a zkus to znovu.')
    expect(message).toBeTruthy()
    // The question was asked far down the screen while the message sits at the top: it is scrolled into view.
    expect(scrollIntoView).toHaveBeenCalled()
    expect(scrollIntoView.mock.contexts.some((element) => (element as HTMLElement).contains(message))).toBe(true)
    expect(getPending()).toBeDefined()
    expect(screen.queryByTestId('catch-success')).toBeNull()

    // Second try works.
    fireEvent.click(within(cards()[0]).getByRole('button', { name: 'Chytit' }))
    const again = await screen.findByRole('alertdialog')
    await act(async () => {
      fireEvent.click(within(again).getByRole('button', { name: 'Chytit' }))
    })
    expect(await screen.findByTestId('catch-success')).toBeTruthy()
  })

  it('says it could not save for any other problem', async () => {
    addCatch.mockRejectedValueOnce(new Error('disk exploded'))
    setPending(pending())
    renderResult()
    await waitFor(() => expect(cards()).toHaveLength(3))
    fireEvent.click(within(cards()[0]).getByRole('button', { name: 'Chytit' }))
    const dialog = await screen.findByRole('alertdialog')
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Chytit' }))
    })
    expect(await screen.findByText(/Uložení se nepovedlo/)).toBeTruthy()
  })
})

describe('catching several birds at once', () => {
  // A recording with a chorus: two birds above the line (normal sensitivity asks 70 percent for sound), one below it.
  const chorus = (extra: Partial<PendingIdentification> = {}) =>
    pending({ candidates: [guess('parus-major', 0.91), guess('turdus-merula', 0.78), guess('erithacus-rubecula', 0.31)], ...extra })

  it('offers "Chytit všechny" only when at least two guesses are sure enough', async () => {
    setPending(pending())
    renderResult()
    await waitFor(() => expect(cards()).toHaveLength(3))
    expect(screen.queryByTestId('catch-all-button')).toBeNull()
    cleanup()
    clearPending()

    setPending(chorus())
    renderResult()
    await waitFor(() => expect(cards()).toHaveLength(3))
    expect(screen.getByTestId('catch-many').textContent).toContain('Vyšlo mi víc ptáků nad hranicí jistoty')
    expect(screen.getByTestId('catch-all-button').textContent).toBe('Chytit všechny (2)')
  })

  it('counts the birds that the sensitivity lets through', async () => {
    updateSettings({ sensitivity: 'easy' })
    setPending(chorus())
    renderResult()
    await waitFor(() => expect(cards()).toHaveLength(3))
    // Easy asks 60 percent for sound: the same two birds.
    expect(screen.getByTestId('catch-all-button').textContent).toBe('Chytit všechny (2)')
    cleanup()
    updateSettings({ sensitivity: 'strict' })
    renderResult()
    await waitFor(() => expect(cards()).toHaveLength(3))
    // Strict asks 85 percent: only one bird is sure enough, so there is nothing to catch together.
    expect(screen.queryByTestId('catch-all-button')).toBeNull()
  })

  it('asks first and lists the birds, the sure ones only', async () => {
    setPending(chorus())
    renderResult()
    await waitFor(() => expect(cards()).toHaveLength(3))
    fireEvent.click(screen.getByTestId('catch-all-button'))
    const dialog = await screen.findByRole('alertdialog', { name: 'Chytit všechny najednou?' })
    expect(within(dialog).getAllByTestId('confirm-many-bird').map((item) => item.textContent)).toEqual(['Sýkora koňadra', 'Kos černý'])
    expect(within(dialog).getByText(/Nahrávka se uloží jen jednou/)).toBeTruthy()
    expect(addCatches).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Ještě ne' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(addCatches).not.toHaveBeenCalled()
    expect(getPending()).toBeDefined()
  })

  it('saves every sure bird with the one recording, a catch id for each, and shows them all', async () => {
    placeName = 'Praha'
    const scan = chorus()
    setPending(scan)
    const catchId = getPendingCatchId()
    renderResult()
    await waitFor(() => expect(cards()).toHaveLength(3))
    fireEvent.click(screen.getByTestId('catch-all-button'))
    const dialog = await screen.findByRole('alertdialog')
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Chytit všechny' }))
    })

    expect(addCatch).not.toHaveBeenCalled()
    expect(addCatches).toHaveBeenCalledTimes(1)
    expect(resolvePlaceName).toHaveBeenCalledTimes(1)
    const [inputs, media] = addCatches.mock.calls[0] as [Record<string, unknown>[], Record<string, unknown>]
    expect(inputs).toHaveLength(2)
    expect(inputs[0]).toMatchObject({ id: `${catchId}:parus-major`, speciesId: 'parus-major', method: 'sound', confidence: 0.91, caughtAt: scan.createdAt, location: { lat: 50.08, lon: 14.43 }, placeName: 'Praha' })
    expect(inputs[1]).toMatchObject({ id: `${catchId}:turdus-merula`, speciesId: 'turdus-merula', method: 'sound', confidence: 0.78, caughtAt: scan.createdAt, location: { lat: 50.08, lon: 14.43 }, placeName: 'Praha' })
    // Every bird has its own BirdPoints, worked out separately.
    const bps = inputs.map((input) => (input.birdPoints as { bp: number }).bp)
    expect(bps.every((bp) => Number.isInteger(bp) && bp > 0)).toBe(true)
    expect(media).toMatchObject({ kind: 'audio', mime: 'audio/wav', durationS: 2 })
    expect(media.blob).toBe(scan.media?.blob)

    expect((await screen.findByTestId('catch-message')).textContent).toBe('Máš je! Chyceno najednou: 2.')
    expect(screen.getByTestId('celebration')).toBeTruthy()
    const birds = screen.getAllByTestId('caught-bird')
    expect(birds.map((item) => item.getAttribute('data-species'))).toEqual(['parus-major', 'turdus-merula'])
    expect(within(birds[0]).getByRole('link', { name: 'Sýkora koňadra' }).getAttribute('href')).toBe(`/birds/${encodeURIComponent(`${catchId}:parus-major`)}`)
    expect(within(birds[0]).getByTestId('bp-value').textContent).toBe(String(bps[0]))
    expect(within(birds[1]).getByTestId('bp-value').textContent).toBe(String(bps[1]))
    expect(within(birds[1]).getByText('Nový druh')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Zobrazit ptáky' }).getAttribute('href')).toBe('/birds')
    expect(screen.getByRole('link', { name: 'Skenovat dál' }).getAttribute('href')).toBe('/scan')
    expect(getPending()).toBeUndefined()
  })

  it('marks the birds that were already in the Dex', async () => {
    caught = new Map([['turdus-merula', { count: 2 }]])
    setPending(chorus())
    renderResult()
    await waitFor(() => expect(cards()).toHaveLength(3))
    fireEvent.click(screen.getByTestId('catch-all-button'))
    const dialog = await screen.findByRole('alertdialog')
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Chytit všechny' }))
    })
    const birds = await screen.findAllByTestId('caught-bird')
    expect(within(birds[0]).getByText('Nový druh')).toBeTruthy()
    expect(within(birds[1]).getByText('Už v Dexu')).toBeTruthy()
  })

  it('names what is saved when the scan has a photo instead of a clip', async () => {
    setPending(chorus({ method: 'photo', media: { kind: 'image', blob: new Blob(['x'], { type: 'image/jpeg' }), mime: 'image/jpeg' }, candidates: [guess('parus-major', 0.91), guess('turdus-merula', 0.9)] }))
    updateSettings({ sensitivity: 'easy' })
    renderResult()
    await waitFor(() => expect(cards()).toHaveLength(2))
    fireEvent.click(screen.getByTestId('catch-all-button'))
    expect(within(await screen.findByRole('alertdialog')).getByText('Uložím je i s datem, místem a fotkou.')).toBeTruthy()
  })

  it('says calmly when the phone is full, saves nothing and keeps the result', async () => {
    addCatches.mockRejectedValueOnce(Object.assign(new Error('full'), { name: 'StorageFullError' }))
    setPending(chorus())
    renderResult()
    await waitFor(() => expect(cards()).toHaveLength(3))
    fireEvent.click(screen.getByTestId('catch-all-button'))
    const dialog = await screen.findByRole('alertdialog')
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Chytit všechny' }))
    })
    expect(await screen.findByText('V telefonu došlo místo. Uvolni trochu paměti a zkus to znovu.')).toBeTruthy()
    expect(screen.queryByTestId('catch-many-success')).toBeNull()
    expect(getPending()).toBeDefined()
    expect(screen.getByTestId('catch-all-button')).toBeTruthy()
  })

  it('still catches one bird at a time with its own button', async () => {
    setPending(chorus())
    renderResult()
    await waitFor(() => expect(cards()).toHaveLength(3))
    fireEvent.click(within(cards()[1]).getByRole('button', { name: 'Chytit' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Přidat do Dexu?' })
    expect(within(dialog).getByText('Kos černý')).toBeTruthy()
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Chytit' }))
    })
    expect(addCatch).toHaveBeenCalledTimes(1)
    expect(addCatches).not.toHaveBeenCalled()
    expect((await screen.findByTestId('catch-message')).textContent).toBe('Máš ho! Kos černý je v Dexu.')
  })
})

describe('dropping the result', () => {
  it('"Zahodit" forgets the identification and goes back to the hub', async () => {
    setPending(pending())
    renderResult()
    await waitFor(() => expect(cards()).toHaveLength(3))
    fireEvent.click(screen.getByTestId('discard'))
    expect(screen.getByTestId('where').textContent).toBe('/scan')
    expect(getPending()).toBeUndefined()
    expect(addCatch).not.toHaveBeenCalled()
  })
})
