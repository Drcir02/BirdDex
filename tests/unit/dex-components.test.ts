// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { Blob as NodeBlob } from 'node:buffer'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { createElement as h, type ReactElement } from 'react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetSpeciesCache } from '../../src/data/species'
import { addCatch, deleteAllCatches, getDb } from '../../src/db'
import type { Species } from '../../src/domain/types'
import { AudioPlayer } from '../../src/features/dex/AudioPlayer'
import { PhotoViewer } from '../../src/features/dex/PhotoViewer'
import { RarityStars } from '../../src/features/dex/RarityStars'
import { ReferenceImage, attemptsFor } from '../../src/features/dex/ReferenceImage'
import { SpeciesCard } from '../../src/features/dex/SpeciesCard'
import { forgetAllThumbnails } from '../../src/features/dex/thumbnails'
import { referencePhotos } from '../../src/features/photos'
import { encodeWav } from '../../src/ml/audio/wav'
import DexPage from '../../src/pages/DexPage'
import SpeciesPage from '../../src/pages/SpeciesPage'
import { ToastProvider, ToastViewport } from '../../src/ui/Toast'

// fake-indexeddb copies jsdom's Blob as an empty object, so the tests use Node's own Blob.
beforeAll(() => {
  vi.stubGlobal('Blob', NodeBlob)
})

function bird(id: string, patch: Partial<Species> = {}): Species {
  return {
    id,
    dexNumber: 1,
    scientificName: id.replace('-', ' ').replace(/^./, (c) => c.toUpperCase()),
    czechName: id,
    englishName: id,
    family: 'Paridae',
    inCzechia: true,
    inEurope: true,
    rarity: 'common',
    birdnetIndex: 1,
    wingclipIndex: 1,
    wikiTitle: null,
    ...patch,
  }
}

const LIST: Species[] = [
  bird('parus-major', { dexNumber: 1, czechName: 'Sýkora koňadra', scientificName: 'Parus major', englishName: 'Great Tit' }),
  bird('turdus-merula', { dexNumber: 2, czechName: 'Kos černý', scientificName: 'Turdus merula', englishName: 'Eurasian Blackbird', family: 'Turdidae', rarity: 'uncommon' }),
  bird('bubo-bubo', { dexNumber: 3, czechName: 'Výr velký', scientificName: 'Bubo bubo', englishName: 'Eurasian Eagle-Owl', family: 'Strigidae', rarity: 'epic' }),
  bird('alca-torda', { dexNumber: 4, czechName: 'Alka malá', scientificName: 'Alca torda', englishName: 'Razorbill', family: 'Alcidae', rarity: 'legendary', inCzechia: false }),
  bird('rare-one', { dexNumber: 5, czechName: null, scientificName: 'Rarus avis', englishName: 'Rare Bird', rarity: 'rare' }),
]
const CZECH = LIST.filter((species) => species.inCzechia).length

/** Shows where the router is, so tests can read the address. */
function Where() {
  const { pathname, search } = useLocation()
  return h('p', { 'data-testid': 'where' }, `${pathname}${search}`)
}

const where = () => screen.getByTestId('where').textContent
/** The address the Dex writes with the history API (the router does not see these changes). */
const address = () => `${window.location.pathname}${window.location.search}`

function app(initial: string | Array<string | { pathname: string; search?: string; state?: unknown }>, page: 'dex' | 'species' = 'dex'): ReactElement {
  return h(
    ToastProvider,
    null,
    h(
      MemoryRouter,
      { initialEntries: Array.isArray(initial) ? initial : [initial], initialIndex: Array.isArray(initial) ? initial.length - 1 : 0 },
      h(Where),
      h(ToastViewport),
      h(
        Routes,
        null,
        h(Route, { path: '/', element: h(DexPage) }),
        h(Route, { path: '/species/:id', element: h(SpeciesPage) }),
        h(Route, { path: '/scan', element: h('p', null, 'Skenovat') }),
        h(Route, { path: '*', element: h('p', null, page) }),
      ),
    ),
  )
}

let objectUrls = 0
beforeEach(async () => {
  window.history.replaceState(null, '', '/')
  resetSpeciesCache(LIST)
  referencePhotos.reset()
  forgetAllThumbnails()
  vi.stubGlobal('fetch', vi.fn(async () => new Response('not found', { status: 404 })))
  URL.createObjectURL = vi.fn(() => `blob:fake/${(objectUrls += 1)}`)
  URL.revokeObjectURL = vi.fn()
  await deleteAllCatches()
  await getDb().photoCache.clear()
})

afterEach(async () => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.stubGlobal('Blob', NodeBlob)
  await deleteAllCatches()
})

const wavBlob = () => new Blob([encodeWav(Float32Array.from({ length: 4800 }, (_, index) => Math.sin(index / 6)), 48000)], { type: 'audio/wav' })
const jpegBlob = () => new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: 'image/jpeg' })

// ---------- Small parts ----------

describe('RarityStars', () => {
  it('fills one star for a common bird and five for a legendary one, and says the rarity in words', () => {
    const { container } = render(h('div', null, h(RarityStars, { rarity: 'common' }), h(RarityStars, { rarity: 'legendary' })))
    const [common, legendary] = Array.from(container.querySelectorAll('.bd-stars'))
    expect(common.querySelectorAll('.is-on')).toHaveLength(1)
    expect(legendary.querySelectorAll('.is-on')).toHaveLength(5)
    expect(common.getAttribute('aria-label')).toBe('Vzácnost: Běžný')
    expect(legendary.getAttribute('aria-label')).toBe('Vzácnost: Legendární')
  })
})

describe('ReferenceImage', () => {
  const WIDE = 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Tit.jpg/500px-Tit.jpg'
  const SMALL = 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Tit.jpg/330px-Tit.jpg'

  it('lists the tries: the wide picture, the small one, then both without CORS', () => {
    expect(attemptsFor(WIDE, SMALL)).toEqual([
      { url: WIDE, cors: true },
      { url: SMALL, cors: true },
      { url: WIDE, cors: false },
      { url: SMALL, cors: false },
    ])
    expect(attemptsFor(SMALL)).toEqual([
      { url: SMALL, cors: true },
      { url: SMALL, cors: false },
    ])
    expect(attemptsFor(SMALL, SMALL)).toHaveLength(2)
  })

  it('asks the way that is kept readable first, hides itself until it has loaded, and fades in', () => {
    const { container } = render(h(ReferenceImage, { src: WIDE, fallbackSrc: SMALL, alt: 'Ukázková fotka ptáka' }))
    const image = container.querySelector('img') as HTMLImageElement
    expect(image.getAttribute('src')).toBe(WIDE)
    expect(image.getAttribute('crossorigin')).toBe('anonymous')
    expect(image.getAttribute('referrerpolicy')).toBe('no-referrer')
    expect(image.classList.contains('is-loaded')).toBe(false)
    fireEvent.load(image)
    expect(image.classList.contains('is-loaded')).toBe(true)
  })

  it('goes on to the next try each time a picture fails, and shows the placeholder when all fail', () => {
    const { container } = render(h(ReferenceImage, { src: WIDE, fallbackSrc: SMALL, alt: '', placeholder: h('span', { 'data-testid': 'placeholder' }, 'obrys') }))
    const seen: Array<[string | null, string | null]> = []
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const image = container.querySelector('img') as HTMLImageElement
      seen.push([image.getAttribute('src'), image.getAttribute('crossorigin')])
      fireEvent.error(image)
    }
    expect(seen).toEqual([
      [WIDE, 'anonymous'],
      [SMALL, 'anonymous'],
      [WIDE, null],
      [SMALL, null],
    ])
    expect(container.querySelector('img')).toBeNull()
    expect(screen.getByTestId('placeholder')).toBeTruthy()
  })

  it('starts over for another bird', () => {
    const { container, rerender } = render(h(ReferenceImage, { src: WIDE, alt: '', placeholder: h('span', null, 'obrys') }))
    fireEvent.error(container.querySelector('img') as HTMLImageElement)
    fireEvent.error(container.querySelector('img') as HTMLImageElement)
    expect(container.querySelector('img')).toBeNull()
    rerender(h(ReferenceImage, { src: SMALL, alt: '', placeholder: h('span', null, 'obrys') }))
    expect(container.querySelector('img')?.getAttribute('src')).toBe(SMALL)
  })
})

describe('SpeciesCard', () => {
  const card = (props: Partial<Parameters<typeof SpeciesCard>[0]> & { species: Species }) =>
    render(h(MemoryRouter, null, h('ul', null, h(SpeciesCard, { summary: undefined, href: '/species/x', ...props }))))

  it('shows a bird that is not caught as a silhouette with its number, names and a plain description', () => {
    card({ species: LIST[0] })
    const link = screen.getByRole('link')
    expect(link.getAttribute('aria-label')).toBe('Sýkora koňadra, číslo 1, zatím nechycený pták, Běžný')
    expect(link.getAttribute('href')).toBe('/species/x')
    const item = screen.getByTestId('species-card')
    expect(item.getAttribute('data-caught')).toBe('false')
    expect(item.querySelector('.bd-sil')).toBeTruthy()
    expect(item.querySelector('.bd-dexcard__badge')).toBeNull()
    expect(item.textContent).toContain('Sýkora koňadra')
    expect(item.textContent).toContain('Parus major')
    expect(item.textContent).toContain('#001')
  })

  it('shows a caught bird with the badge, and the number of catches when there are several', () => {
    card({ species: LIST[0], summary: { speciesId: 'parus-major', count: 3, firstCaughtAt: 1, lastCaughtAt: 2 } })
    expect(screen.getByRole('link').getAttribute('aria-label')).toContain('chycený pták')
    const item = screen.getByTestId('species-card')
    expect(item.getAttribute('data-caught')).toBe('true')
    expect(item.querySelector('.bd-dexcard__badge')?.textContent).toBe('3×')
  })

  it('shows the scientific name alone for a bird with no Czech name', () => {
    card({ species: LIST[4] })
    const item = screen.getByTestId('species-card')
    expect(item.querySelector('.bd-dexcard__name')?.textContent).toBe('Rarus avis')
    expect(item.querySelector('.bd-dexcard__latin')).toBeNull()
  })

  it('calls onNavigate before the link is followed', () => {
    const onNavigate = vi.fn()
    card({ species: LIST[0], onNavigate })
    fireEvent.click(screen.getByRole('link'))
    expect(onNavigate).toHaveBeenCalledTimes(1)
  })
})

describe('SpeciesCard and the screen it is near', () => {
  // A pretend IntersectionObserver: the test decides which element comes into view.
  const watched = new Map<Element, () => void>()
  const options: Array<{ root: Element | null; rootMargin: string | undefined }> = []

  beforeEach(() => {
    watched.clear()
    options.length = 0
    class FakeObserver {
      constructor(
        private readonly callback: IntersectionObserverCallback,
        init: IntersectionObserverInit = {},
      ) {
        options.push({ root: (init.root as Element | null) ?? null, rootMargin: init.rootMargin })
      }
      observe = (element: Element) => {
        watched.set(element, () => this.callback([{ isIntersecting: true, target: element } as IntersectionObserverEntry], this as unknown as IntersectionObserver))
      }
      unobserve = (element: Element) => {
        watched.delete(element)
      }
      disconnect = () => undefined
    }
    vi.stubGlobal('IntersectionObserver', FakeObserver)
  })

  it('looks up a reference photo only after the card has come near the screen', async () => {
    const fetchSpy = vi.fn(async () => new Response('not found', { status: 404 }))
    vi.stubGlobal('fetch', fetchSpy)
    render(
      h(
        MemoryRouter,
        null,
        h('ul', null, h(SpeciesCard, { species: LIST[2], summary: { speciesId: 'bubo-bubo', count: 1, firstCaughtAt: 1, lastCaughtAt: 1 }, href: '/species/bubo-bubo' })),
      ),
    )
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(watched.size).toBe(1)
    // The card is watched with a margin, so its picture is ready a little before it is seen.
    expect(options[0].rootMargin).toMatch(/px/)

    await act(async () => {
      for (const arrive of watched.values()) arrive()
    })
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled())
    expect(watched.size).toBe(0)
  })

  it('never looks up a photo for a bird that is not caught, near or not', async () => {
    const fetchSpy = vi.fn(async () => new Response('not found', { status: 404 }))
    vi.stubGlobal('fetch', fetchSpy)
    render(h(MemoryRouter, null, h('ul', null, h(SpeciesCard, { species: LIST[2], summary: undefined, href: '/species/bubo-bubo' }))))
    await act(async () => {
      for (const arrive of watched.values()) arrive()
    })
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

// ---------- The player ----------

describe('AudioPlayer', () => {
  beforeEach(() => {
    // jsdom has no audio. A pretend element keeps its own state and fires the events a real one would.
    const state = new WeakMap<HTMLMediaElement, { paused: boolean; time: number }>()
    const of = (element: HTMLMediaElement) => {
      let entry = state.get(element)
      if (!entry) {
        entry = { paused: true, time: 0 }
        state.set(element, entry)
      }
      return entry
    }
    Object.defineProperty(HTMLMediaElement.prototype, 'paused', { configurable: true, get() { return of(this as HTMLMediaElement).paused } })
    Object.defineProperty(HTMLMediaElement.prototype, 'ended', { configurable: true, get() { return false } })
    Object.defineProperty(HTMLMediaElement.prototype, 'currentTime', {
      configurable: true,
      get() { return of(this as HTMLMediaElement).time },
      set(value: number) { of(this as HTMLMediaElement).time = value },
    })
    HTMLMediaElement.prototype.play = vi.fn(function (this: HTMLMediaElement) {
      of(this).paused = false
      this.dispatchEvent(new Event('play'))
      return Promise.resolve()
    })
    HTMLMediaElement.prototype.pause = vi.fn(function (this: HTMLMediaElement) {
      of(this).paused = true
      this.dispatchEvent(new Event('pause'))
    })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(await wavBlob().arrayBuffer())))
  })

  async function clip() {
    const saved = await addCatch({ speciesId: 'parus-major', method: 'sound', confidence: 0.9 }, { kind: 'audio', blob: wavBlob(), durationS: 2.4 })
    return saved.mediaId as string
  }

  it('has an audio element with our own play button, a seek bar and the time', async () => {
    const mediaId = await clip()
    const { container } = render(h(AudioPlayer, { mediaId }))
    const button = await screen.findByTestId('audio-toggle')
    expect(container.querySelector('audio')).toBeTruthy()
    expect(container.querySelector('audio')?.hasAttribute('controls')).toBe(false)
    expect(button.getAttribute('aria-label')).toBe('Přehrát nahrávku')
    expect(screen.getByRole('slider', { name: 'Místo v nahrávce' })).toBeTruthy()
    expect(container.querySelector('.bd-audio__time')?.textContent).toBe('0:00 / 0:02')
  })

  it('plays and pauses from the same button, and says which it is about to do', async () => {
    const mediaId = await clip()
    render(h(AudioPlayer, { mediaId }))
    const button = await screen.findByTestId('audio-toggle')
    fireEvent.click(button)
    await waitFor(() => expect(button.getAttribute('aria-label')).toBe('Pozastavit nahrávku'))
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1)
    fireEvent.click(button)
    await waitFor(() => expect(button.getAttribute('aria-label')).toBe('Přehrát nahrávku'))
  })

  it('stops the recording that was playing when another one starts', async () => {
    const first = await clip()
    const second = await clip()
    render(h('div', null, h(AudioPlayer, { mediaId: first }), h(AudioPlayer, { mediaId: second })))
    await waitFor(() => expect(screen.getAllByTestId('audio-toggle')).toHaveLength(2))
    const [a, b] = screen.getAllByTestId('audio-toggle')
    fireEvent.click(a)
    await waitFor(() => expect(a.getAttribute('aria-label')).toBe('Pozastavit nahrávku'))
    fireEvent.click(b)
    await waitFor(() => expect(b.getAttribute('aria-label')).toBe('Pozastavit nahrávku'))
    await waitFor(() => expect(a.getAttribute('aria-label')).toBe('Přehrát nahrávku'))
  })

  it('moves to the place the seek bar is set to', async () => {
    const mediaId = await clip()
    const { container } = render(h(AudioPlayer, { mediaId }))
    const slider = await screen.findByRole('slider', { name: 'Místo v nahrávce' })
    fireEvent.change(slider, { target: { value: '1.5' } })
    expect(container.querySelector('audio')?.currentTime).toBe(1.5)
    expect(container.querySelector('.bd-audio__time')?.textContent).toBe('0:01 / 0:02')
  })

  it('draws the loudness bars from the recording and lights those already played', async () => {
    const mediaId = await clip()
    const { container } = render(h(AudioPlayer, { mediaId }))
    await screen.findByTestId('audio-toggle')
    await waitFor(() => expect(container.querySelectorAll('.bd-audio__bar').length).toBe(32))
    expect(container.querySelectorAll('.bd-audio__bar.is-lit')).toHaveLength(0)
    fireEvent.change(screen.getByRole('slider', { name: 'Místo v nahrávce' }), { target: { value: '1.2' } })
    expect(container.querySelectorAll('.bd-audio__bar.is-lit')).toHaveLength(16)
  })

  it('tells calmly when the recording is gone', () => {
    render(h(AudioPlayer, { mediaId: 'no-such-clip' }))
    return screen.findByText('Uložená nahrávka chybí.')
  })

  it('tells when the sound cannot start', async () => {
    const mediaId = await clip()
    HTMLMediaElement.prototype.play = vi.fn(() => Promise.reject(new DOMException('blocked', 'NotAllowedError')))
    render(h(AudioPlayer, { mediaId }))
    fireEvent.click(await screen.findByTestId('audio-toggle'))
    expect((await screen.findByRole('alert')).textContent).toBe('Nahrávku se nepodařilo přehrát.')
  })
})

describe('PhotoViewer', () => {
  it('shows the photo, closes with Escape and gives the focus back', async () => {
    const saved = await addCatch({ speciesId: 'parus-major', method: 'photo', confidence: 0.9 }, { kind: 'image', blob: jpegBlob() })
    const opener = document.createElement('button')
    document.body.append(opener)
    opener.focus()
    const onClose = vi.fn()
    const root = document.createElement('div')
    root.id = 'root'
    document.body.append(root)
    render(h(PhotoViewer, { mediaId: saved.mediaId as string, onClose }))
    const dialog = await screen.findByRole('dialog', { name: 'Fotka na celou obrazovku' })
    await waitFor(() => expect(within(dialog).getByRole('img').getAttribute('src')).toMatch(/^blob:fake\//))
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Zavřít fotku' }))
    expect((root as HTMLElement & { inert: boolean }).inert).toBe(true)

    fireEvent.keyDown(document, { key: 'Tab' })
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Zavřít fotku' }))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
    cleanup()
    expect((root as HTMLElement & { inert: boolean }).inert).toBe(false)
    expect(document.activeElement).toBe(opener)
    opener.remove()
    root.remove()
  })

  it('closes with the close button and by tapping the picture', async () => {
    const saved = await addCatch({ speciesId: 'parus-major', method: 'photo', confidence: 0.9 }, { kind: 'image', blob: jpegBlob() })
    const onClose = vi.fn()
    render(h(PhotoViewer, { mediaId: saved.mediaId as string, onClose }))
    fireEvent.click(await screen.findByRole('button', { name: 'Zavřít fotku' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('dialog'))
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('says when the photo is gone', async () => {
    render(h(PhotoViewer, { mediaId: 'gone', onClose: () => undefined }))
    expect(await screen.findByText('Uložená fotka chybí.')).toBeTruthy()
  })
})

// ---------- The Dex screen ----------

describe('DexPage', () => {
  const cards = () => screen.queryAllByTestId('species-card').map((item) => item.getAttribute('data-species-id'))

  async function dexWithCatches(initial = '/') {
    await addCatch({ speciesId: 'parus-major', method: 'sound', confidence: 0.9 })
    await addCatch({ speciesId: 'bubo-bubo', method: 'sound', confidence: 0.8 })
    await addCatch({ speciesId: 'alca-torda', method: 'sound', confidence: 0.8 })
    render(app(initial))
    await screen.findByTestId('dex-count')
  }

  it('shows the progress of Czechia and the Czech birds first, in Dex order', async () => {
    await dexWithCatches()
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Ptačí Dex')
    await waitFor(() => expect(screen.getByTestId('dex-progress').textContent).toBe(`Chyceno 2 z ${CZECH}`))
    expect(cards()).toEqual(['parus-major', 'turdus-merula', 'bubo-bubo', 'rare-one'])
    expect(screen.getByTestId('dex-count').textContent).toBe('4 ptáci')
    expect(screen.getByRole('progressbar', { name: 'Postup sbírkou' }).getAttribute('aria-valuenow')).toBe('50')
  })

  it('has one h1 and puts the state of the list into the address as chips are pressed (without adding history)', async () => {
    await dexWithCatches()
    expect(address()).toBe('/')
    fireEvent.click(screen.getByRole('button', { name: 'Evropa' }))
    expect(address()).toBe('/?region=europe')
    expect(cards()).toHaveLength(5)
    expect(screen.getByTestId('dex-progress').textContent).toBe('Chyceno 3 z 5')
    fireEvent.click(screen.getByRole('button', { name: 'Chycené' }))
    expect(address()).toBe('/?region=europe&status=caught')
    expect(cards()).toEqual(['parus-major', 'bubo-bubo', 'alca-torda'])
    fireEvent.click(screen.getByRole('button', { name: 'Zatím ne' }))
    expect(cards()).toEqual(['turdus-merula', 'rare-one'])
    fireEvent.click(screen.getByRole('button', { name: 'Vše' }))
    expect(address()).toBe('/?region=europe')
    fireEvent.click(screen.getByRole('button', { name: 'Česko' }))
    expect(address()).toBe('/')
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
  })

  it('marks the chips that are on', async () => {
    await dexWithCatches('/?region=europe&status=missing')
    expect(screen.getByRole('button', { name: 'Evropa' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'Česko' }).getAttribute('aria-pressed')).toBe('false')
    expect(screen.getByRole('button', { name: 'Zatím ne' }).getAttribute('aria-pressed')).toBe('true')
    expect(cards()).toEqual(['turdus-merula', 'rare-one'])
  })

  it('sorts by name and by rarity from the menu', async () => {
    await dexWithCatches('/?region=europe')
    fireEvent.change(screen.getByRole('combobox', { name: 'Řazení' }), { target: { value: 'name' } })
    expect(address()).toBe('/?region=europe&sort=name')
    expect(cards()).toEqual(['alca-torda', 'turdus-merula', 'rare-one', 'parus-major', 'bubo-bubo'])
    fireEvent.change(screen.getByRole('combobox', { name: 'Řazení' }), { target: { value: 'rarity' } })
    expect(cards()).toEqual(['parus-major', 'turdus-merula', 'rare-one', 'bubo-bubo', 'alca-torda'])
  })

  it('searches at once while typing, ignoring accents, and writes the address a moment later', async () => {
    await dexWithCatches('/?region=europe')
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const box = screen.getByRole('searchbox', { name: 'Hledat v Dexu' })
    fireEvent.change(box, { target: { value: 'sykora' } })
    expect(cards()).toEqual(['parus-major'])
    expect(screen.getByTestId('dex-count').textContent).toBe('1 pták')
    expect(address()).toBe('/') // nothing is written yet: the search waits for a quiet moment
    act(() => {
      vi.advanceTimersByTime(300)
    })
    expect(address()).toBe('/?region=europe&q=sykora')
  })

  it('finds a bird by its scientific and English name', async () => {
    await dexWithCatches('/?region=europe')
    const box = screen.getByRole('searchbox', { name: 'Hledat v Dexu' })
    fireEvent.change(box, { target: { value: 'razorbill' } })
    expect(cards()).toEqual(['alca-torda'])
    fireEvent.change(box, { target: { value: 'turdus' } })
    expect(cards()).toEqual(['turdus-merula'])
  })

  it('opens with the search from the address, and follows the address when it changes', async () => {
    await dexWithCatches('/?region=europe&q=kos')
    expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('kos')
    expect(cards()).toEqual(['turdus-merula'])
  })

  it('says nothing was found and offers to start over', async () => {
    await dexWithCatches('/?region=europe&status=caught&q=zzzz')
    expect(cards()).toEqual([])
    expect(screen.getByText('Nic se nenašlo')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Zrušit filtry' }))
    expect(address()).toBe('/?region=europe')
    expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('')
    expect(cards()).toHaveLength(5)
  })

  it('invites to the first catch when nothing is caught', async () => {
    render(app('/?status=caught'))
    expect(await screen.findByText('Zatím nemáš nic chyceno')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Jdu na to' }).getAttribute('href')).toBe('/scan')
  })

  it('celebrates when everything is caught', async () => {
    for (const species of LIST.filter((entry) => entry.inCzechia)) await addCatch({ speciesId: species.id, method: 'sound', confidence: 0.9 })
    render(app('/?status=missing'))
    expect(await screen.findByText('Máš je všechny!')).toBeTruthy()
    expect(screen.getByTestId('dex-progress').textContent).toBe(`Chyceno ${CZECH} z ${CZECH}`)
  })

  it('links every card to its bird and carries the state of the list', async () => {
    await dexWithCatches('/?region=europe&sort=name')
    const link = screen.getAllByRole('link').find((entry) => entry.getAttribute('aria-label')?.startsWith('Kos černý'))
    expect(link?.getAttribute('href')).toBe('/species/turdus-merula?region=europe&sort=name')
  })

  it('shows a calm error with a retry when the list of birds cannot be loaded', async () => {
    resetSpeciesCache()
    vi.stubGlobal('fetch', vi.fn(async () => new Response('down', { status: 500 })))
    render(app('/'))
    expect(await screen.findByText('Dex se nenačetl')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Zkusit znovu' })).toBeTruthy()
  })

  it('follows the browser when it moves to another address of the Dex, even one the router never saw', async () => {
    await dexWithCatches()
    fireEvent.click(screen.getByRole('button', { name: 'Evropa' }))
    expect(cards()).toHaveLength(5)
    // The back button (or a changed address): the page address is the plain one again.
    act(() => {
      window.history.replaceState(null, '', '/')
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    await waitFor(() => expect(cards()).toHaveLength(4))
    expect(screen.getByRole('button', { name: 'Česko' }).getAttribute('aria-pressed')).toBe('true')
    act(() => {
      window.history.replaceState(null, '', '/#/?status=caught&q=kos')
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    await waitFor(() => expect(cards()).toEqual([]))
    expect(screen.getByRole('button', { name: 'Chycené' }).getAttribute('aria-pressed')).toBe('true')
    expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('kos')
  })

  it('opens the hidden demo page after seven quick taps on the progress ring', async () => {
    await dexWithCatches()
    const ring = screen.getByRole('progressbar', { name: 'Postup sbírkou' }).parentElement as HTMLElement
    for (let tap = 0; tap < 6; tap += 1) fireEvent.click(ring)
    expect(where()).toBe('/')
    fireEvent.click(ring)
    expect(where()).toBe('/dev/demo')
  })
})

// ---------- The bird screen ----------

describe('SpeciesPage', () => {
  it('shows a bird that is not caught: silhouette, names, family, flags, a tip and the way to scan it', async () => {
    render(app('/species/bubo-bubo'))
    expect(await screen.findByRole('heading', { level: 1, name: 'Výr velký' })).toBeTruthy()
    expect(screen.getByText('Bubo bubo').tagName).toBe('I')
    expect(screen.getByText(/puštíkovití/)).toBeTruthy()
    expect(screen.getByText('Epický')).toBeTruthy()
    expect(screen.getByRole('group', { name: 'Kde žije' }).textContent).toContain('Česko: ano')
    expect(screen.getByText('Tohohle ptáka ještě nemáš')).toBeTruthy()
    expect(screen.getByText(/Sovy se ozývají v noci/)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Jdu ho hledat' }).getAttribute('href')).toBe('/scan')
    expect(screen.getByTestId('species-photo').getAttribute('data-view')).toBe('silhouette')
    expect(screen.queryByTestId('catch-list')).toBeNull()
  })

  it('does not look up the reference photo of a bird that is not caught until asked', async () => {
    const fetchSpy = vi.fn(async () => new Response('not found', { status: 404 }))
    vi.stubGlobal('fetch', fetchSpy)
    render(app('/species/bubo-bubo'))
    await screen.findByTestId('species-name')
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(fetchSpy).not.toHaveBeenCalled()
    fireEvent.click(screen.getByTestId('photo-peek'))
    expect(screen.getByTestId('photo-peek').getAttribute('aria-pressed')).toBe('true')
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled())
    expect(await screen.findByText('K tomuhle ptákovi nemám žádnou volnou fotku.')).toBeTruthy()
  })

  it('tells that the bird is not in the Dex, with a way back', async () => {
    render(app('/species/does-not-exist'))
    expect(await screen.findByText('Tohohle ptáka v Dexu nemám.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Zpět do Dexu' }).getAttribute('href')).toBe('/')
  })

  it('shows a Latin name only when there is a Czech name', async () => {
    render(app('/species/rare-one'))
    const title = await screen.findByTestId('species-name')
    expect(title.textContent).toBe('Rarus avis')
    expect(screen.queryAllByText('Rarus avis')).toHaveLength(1)
  })

  describe('with catches', () => {
    async function open() {
      await addCatch({ id: 'old', speciesId: 'parus-major', method: 'sound', confidence: 0.82, caughtAt: Date.UTC(2026, 8, 24, 18, 30), placeName: 'Brno', location: { lat: 49.1951, lon: 16.6068 } }, { kind: 'audio', blob: wavBlob(), durationS: 2.4 })
      await addCatch({ id: 'new', speciesId: 'parus-major', method: 'photo', confidence: 0.71, caughtAt: Date.UTC(2026, 9, 16, 21, 5), location: { lat: 50.0755, lon: 14.4378 }, note: 'U krmítka.' }, { kind: 'image', blob: jpegBlob() })
      await addCatch({ id: 'plain', speciesId: 'parus-major', method: 'live', confidence: 0.64, caughtAt: Date.UTC(2026, 9, 1, 8, 0) })
      render(app(['/', { pathname: '/species/parus-major', search: '?region=europe&sort=name', state: { fromDex: true } }]))
      await screen.findByTestId('catch-list')
    }

    it('lists the catches newest first with date, place, method and confidence', async () => {
      await open()
      const items = screen.getAllByTestId('catch-item')
      expect(items.map((item) => item.getAttribute('data-method'))).toEqual(['photo', 'live', 'sound'])
      const photo = items[0]
      expect(within(photo).getByText('Fotka')).toBeTruthy()
      expect(photo.querySelector('time')?.textContent).toMatch(/^16\. 10\. 2026 \d{1,2}:\d{2}$/)
      expect(within(photo).getByText('50,08° s. š., 14,44° v. d.')).toBeTruthy()
      expect(within(photo).getByRole('link', { name: 'Otevřít v mapě' }).getAttribute('href')).toContain('openstreetmap.org')
      expect(within(photo).getByRole('link', { name: 'Otevřít v mapě' }).getAttribute('target')).toBe('_blank')
      expect(within(photo).getByRole('link', { name: 'Otevřít v mapě' }).getAttribute('rel')).toContain('noopener')
      expect(within(photo).getByText('U krmítka.')).toBeTruthy()
      expect(within(photo).getByRole('meter').getAttribute('aria-valuetext')).toMatch(/^71\s%$/)
      const live = items[1]
      expect(within(live).getByText('Místo nebylo uloženo')).toBeTruthy()
      expect(within(live).queryByRole('link', { name: 'Otevřít v mapě' })).toBeNull()
      expect(within(items[2]).getByText('Brno')).toBeTruthy()
      expect(screen.getByText('Tenhle pták už je tvůj!')).toBeTruthy()
      expect(screen.getByText('Úlovků: 3')).toBeTruthy()
    })

    it('has the recording player for a sound catch and the photo button for a photo catch', async () => {
      await open()
      const [photo, , sound] = screen.getAllByTestId('catch-item')
      expect(within(photo).getByTestId('catch-photo')).toBeTruthy()
      expect(within(photo).queryByTestId('audio-player')).toBeNull()
      await waitFor(() => expect(within(sound).getByTestId('audio-player')).toBeTruthy())
      expect(within(sound).queryByTestId('catch-photo')).toBeNull()
    })

    it('shows the saved photo in the big panel and opens it at full size', async () => {
      await open()
      const panel = await screen.findByTestId('own-photo')
      expect(screen.getByTestId('species-photo').getAttribute('data-view')).toBe('own')
      fireEvent.click(panel)
      expect(await screen.findByRole('dialog', { name: 'Fotka na celou obrazovku' })).toBeTruthy()
      fireEvent.keyDown(document, { key: 'Escape' })
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    })

    it('asks before deleting, keeps the catch on Cancel, deletes it on confirm and says so', async () => {
      await open()
      const [photo] = screen.getAllByTestId('catch-item')
      fireEvent.click(within(photo).getByRole('button', { name: 'Smazat úlovek' }))
      const dialog = await screen.findByRole('alertdialog', { name: 'Smazat tenhle úlovek?' })
      expect(within(dialog).getByText(/Zmizí i uložená fotka nebo nahrávka/)).toBeTruthy()
      fireEvent.click(within(dialog).getByRole('button', { name: 'Ponechat' }))
      await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
      expect(screen.getAllByTestId('catch-item')).toHaveLength(3)

      fireEvent.click(within(screen.getAllByTestId('catch-item')[0]).getByRole('button', { name: 'Smazat úlovek' }))
      fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Smazat' }))
      await waitFor(() => expect(screen.getAllByTestId('catch-item')).toHaveLength(2))
      expect(await screen.findByText('Úlovek je smazaný.')).toBeTruthy()
      expect(await getDb().catches.get('new')).toBeUndefined()
      expect(await getDb().catches.get('old')).toBeDefined()
      // The photo went with its catch.
      expect(await getDb().media.count()).toBe(1)
    })

    it('falls back to "not caught" when the last catch is deleted', async () => {
      await addCatch({ id: 'only', speciesId: 'parus-major', method: 'sound', confidence: 0.9 })
      render(app('/species/parus-major'))
      fireEvent.click(await screen.findByRole('button', { name: 'Smazat úlovek' }))
      fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Smazat' }))
      expect(await screen.findByText('Tohohle ptáka ještě nemáš')).toBeTruthy()
      // The message and the list come from two live queries, so on a busy machine the list can go a moment later.
      await waitFor(() => expect(screen.queryByTestId('catch-list')).toBeNull())
    })

    it('offers the next and previous bird of the list it was opened from, with the same list state', async () => {
      await open()
      // Sorted by name: Alka malá, Kos černý, Rarus avis, Sýkora koňadra, Výr velký.
      expect(screen.getByText('4 z 5')).toBeTruthy()
      expect(screen.getByTestId('species-prev').getAttribute('href')).toBe('/species/rare-one?region=europe&sort=name')
      expect(screen.getByTestId('species-next').getAttribute('href')).toBe('/species/bubo-bubo?region=europe&sort=name')
    })

    it('goes back to where the person came from', async () => {
      await open()
      fireEvent.click(screen.getByTestId('species-back'))
      await waitFor(() => expect(where()).toBe('/'))
    })

    it('still goes back to the list after moving to the next bird (the move replaces the entry and keeps the way back)', async () => {
      await open()
      fireEvent.click(screen.getByTestId('species-next'))
      await waitFor(() => expect(where()).toBe('/species/bubo-bubo?region=europe&sort=name'))
      fireEvent.click(await screen.findByTestId('species-back'))
      await waitFor(() => expect(where()).toBe('/'))
    })
  })

  it('opens the Dex with the same filters when there is nothing to go back to (a shared link)', async () => {
    render(app('/species/bubo-bubo?region=europe&status=missing'))
    fireEvent.click(await screen.findByTestId('species-back'))
    await waitFor(() => expect(where()).toBe('/?region=europe&status=missing'))
  })

  it('moves along the list with the previous and next buttons, and has none at the ends', async () => {
    render(app('/species/parus-major'))
    await screen.findByTestId('species-name')
    expect(screen.getByRole('button', { name: 'Předchozí pták' }).hasAttribute('disabled')).toBe(true)
    fireEvent.click(screen.getByTestId('species-next'))
    await waitFor(() => expect(where()).toBe('/species/turdus-merula'))
    expect(await screen.findByRole('heading', { level: 1, name: 'Kos černý' })).toBeTruthy()
    expect(screen.getByTestId('species-prev').getAttribute('href')).toBe('/species/parus-major')
  })

  it('uses the whole region of a bird that does not fit the list in the address', async () => {
    render(app('/species/alca-torda'))
    await screen.findByTestId('species-name')
    // The Czech list does not hold the Razorbill, so the list is widened to Europe and the bird still has neighbours.
    expect(screen.getByText('4 z 5')).toBeTruthy()
    expect(screen.getByTestId('species-prev').getAttribute('href')).toBe('/species/bubo-bubo?region=europe')
  })
})
