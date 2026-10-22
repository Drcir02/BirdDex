// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { Blob as NodeBlob } from 'node:buffer'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { createElement as h, type ReactElement } from 'react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetSpeciesCache } from '../../src/data/species'
import { addCatch, deleteAllCatches, getDb } from '../../src/db'
import { calculateBirdPoints, toStored } from '../../src/domain/birdPoints'
import type { Species } from '../../src/domain/types'
import { forgetAllThumbnails } from '../../src/features/dex/thumbnails'
import { referencePhotos } from '../../src/features/photos'
import { encodeWav } from '../../src/ml/audio/wav'
import BirdPage from '../../src/pages/BirdPage'
import BirdsPage from '../../src/pages/BirdsPage'
import { ToastProvider, ToastViewport } from '../../src/ui/Toast'

// The Ptáci screens: the list of every caught bird with its BP, and the page of one bird.

beforeAll(() => {
  vi.stubGlobal('Blob', NodeBlob)
})

const bird = (id: string, patch: Partial<Species> = {}): Species => ({
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
  info: { months: '333333333333', place: 'woods', shy: 1, day: 'day', tip: 'smallwoods', bp: [50, 750] },
  ...patch,
})

const LIST: Species[] = [
  bird('parus-major', { dexNumber: 1, czechName: 'Sýkora koňadra', scientificName: 'Parus major', englishName: 'Great Tit' }),
  bird('turdus-merula', { dexNumber: 2, czechName: 'Kos černý', scientificName: 'Turdus merula', englishName: 'Eurasian Blackbird', family: 'Turdidae', rarity: 'uncommon' }),
  bird('bubo-bubo', { dexNumber: 3, czechName: 'Výr velký', scientificName: 'Bubo bubo', englishName: 'Eurasian Eagle-Owl', family: 'Strigidae', rarity: 'epic' }),
]

const Where = () => h('p', { 'data-testid': 'where' }, `${useLocation().pathname}${useLocation().search}`)
const where = () => screen.getByTestId('where').textContent

function app(initial: string | Array<string | { pathname: string; search?: string; state?: unknown }>): ReactElement {
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
        h(Route, { path: '/birds', element: h(BirdsPage) }),
        h(Route, { path: '/birds/:id', element: h(BirdPage) }),
        h(Route, { path: '/scan', element: h('p', null, 'Skenovat') }),
        h(Route, { path: '/species/:id', element: h('p', null, 'Druh') }),
        h(Route, { path: '*', element: h('p', null, 'jinde') }),
      ),
    ),
  )
}

let objectUrls = 0
beforeEach(async () => {
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
  vi.unstubAllGlobals()
  vi.stubGlobal('Blob', NodeBlob)
  await deleteAllCatches()
})

const wavBlob = () => new Blob([encodeWav(Float32Array.from({ length: 4800 }, (_, index) => Math.sin(index / 6)), 48000)], { type: 'audio/wav' })
const jpegBlob = () => new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: 'image/jpeg' })

/** A catch with BirdPoints: the dice are fixed, so the numbers are the same every time. */
async function catchBird(id: string, speciesId: string, patch: { method?: 'sound' | 'photo' | 'live'; confidence?: number; caughtAt?: number; note?: string; placeName?: string; media?: boolean; plain?: boolean } = {}) {
  const species = LIST.find((entry) => entry.id === speciesId)!
  const method = patch.method ?? 'live'
  const caughtAt = patch.caughtAt ?? new Date(2026, 5, 15, 12).getTime()
  const confidence = patch.confidence ?? 0.9
  const points = calculateBirdPoints({ species, method, confidence, lead: 0.4, caughtAt, now: caughtAt, random: () => 0.5 })
  await addCatch(
    { id, speciesId, method, confidence, caughtAt, ...(patch.note ? { note: patch.note } : {}), ...(patch.placeName ? { placeName: patch.placeName } : {}), ...(patch.plain ? {} : { birdPoints: toStored(points) }) },
    patch.media ? (method === 'sound' ? { kind: 'audio', blob: wavBlob(), durationS: 2 } : { kind: 'image', blob: jpegBlob() }) : undefined,
  )
  return points
}

const cards = () => screen.getAllByTestId('bird-card')
const order = () => cards().map((card) => card.getAttribute('data-catch-id'))

describe('the Ptáci list', () => {
  it('invites to the first catch when there is nothing yet', async () => {
    render(app('/birds'))
    expect(await screen.findByText('V batohu zatím nikdo není')).toBeTruthy()
    expect(screen.getByTestId('birds-empty-scan').getAttribute('href')).toBe('/scan')
  })

  it('shows every catch as its own bird with its BP, the strongest first, also two of the same species', async () => {
    const a = await catchBird('a', 'parus-major', { confidence: 0.6 })
    const b = await catchBird('b', 'parus-major', { confidence: 0.6, caughtAt: new Date(2026, 5, 16, 12).getTime() })
    const c = await catchBird('c', 'bubo-bubo', { confidence: 0.95 })
    render(app('/birds'))
    await screen.findByTestId('birds-grid')
    expect(cards()).toHaveLength(3)
    expect(order()[0]).toBe('c')
    expect(c.bp).toBeGreaterThan(a.bp)
    // The same species with the same quality: two birds, side by side.
    expect(a.bp).toBe(b.bp)
    expect(order().slice(1).sort()).toEqual(['a', 'b'])
    expect(within(cards()[0]).getByTestId('bird-card-bp').textContent).toBe(String(c.bp))
    expect(screen.getByTestId('birds-shown').textContent).toBe('3 ptáci')
  })

  it('says the Czech count: 1 pták, 2 ptáci, 5 ptáků', async () => {
    await catchBird('a', 'parus-major')
    render(app('/birds'))
    expect((await screen.findByTestId('birds-shown')).textContent).toBe('1 pták')
    cleanup()
    for (const id of ['b', 'c', 'd', 'e']) await catchBird(id, 'turdus-merula')
    render(app('/birds'))
    await waitFor(() => expect(screen.getByTestId('birds-shown').textContent).toBe('5 ptáků'))
  })

  it('links a card to its bird, with the name and the BP for a screen reader and a speaker badge for a sound catch', async () => {
    const points = await catchBird('a', 'parus-major', { method: 'sound', media: true })
    render(app('/birds'))
    const link = within(await screen.findByTestId('bird-card')).getByRole('link')
    expect(link.getAttribute('href')).toBe('/birds/a')
    expect(link.getAttribute('aria-label')).toBe(`Sýkora koňadra, BP ${points.bp}`)
    expect(link.querySelector('.bd-bcard__badge')).not.toBeNull()
  })

  it('shows a dash for a bird whose BP is not worked out yet', async () => {
    await catchBird('a', 'parus-major', { plain: true })
    render(app('/birds'))
    expect((await screen.findByTestId('bird-card-bp')).textContent).toBe('–')
  })

  it('sorts by the menu and writes the order into the address', async () => {
    await catchBird('a', 'bubo-bubo', { confidence: 0.95, caughtAt: new Date(2026, 5, 10, 12).getTime() })
    await catchBird('b', 'turdus-merula', { confidence: 0.7, caughtAt: new Date(2026, 5, 20, 12).getTime() })
    await catchBird('c', 'parus-major', { confidence: 0.8, caughtAt: new Date(2026, 5, 15, 12).getTime() })
    render(app('/birds'))
    await screen.findByTestId('birds-grid')
    expect(order()).toEqual(['a', 'c', 'b'])
    const sort = screen.getByRole('combobox', { name: 'Řazení' })
    fireEvent.change(sort, { target: { value: 'newest' } })
    await waitFor(() => expect(order()).toEqual(['b', 'c', 'a']))
    expect(where()).toBe('/birds?sort=newest')
    fireEvent.change(sort, { target: { value: 'name' } })
    await waitFor(() => expect(order()).toEqual(['b', 'c', 'a']))
    fireEvent.change(sort, { target: { value: 'rarity' } })
    await waitFor(() => expect(order()).toEqual(['a', 'b', 'c']))
    fireEvent.change(sort, { target: { value: 'bp' } })
    await waitFor(() => expect(where()).toBe('/birds'))
  })

  it('searches by name and says so when nothing matches', async () => {
    await catchBird('a', 'parus-major')
    await catchBird('b', 'turdus-merula')
    render(app('/birds'))
    await screen.findByTestId('birds-grid')
    fireEvent.change(screen.getByRole('searchbox', { name: 'Hledat mezi ptáky' }), { target: { value: 'kos' } })
    await waitFor(() => expect(order()).toEqual(['b']))
    fireEvent.change(screen.getByRole('searchbox', { name: 'Hledat mezi ptáky' }), { target: { value: 'zzzz' } })
    expect(await screen.findByText('Nic takového nemám')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Zobrazit všechny' }))
    await waitFor(() => expect(cards()).toHaveLength(2))
  })

  it('shows only the birds of one species when the address says so, and a button to show all', async () => {
    await catchBird('a', 'parus-major')
    await catchBird('b', 'turdus-merula')
    await catchBird('c', 'parus-major')
    render(app('/birds?species=parus-major'))
    await screen.findByTestId('birds-grid')
    expect(order().sort()).toEqual(['a', 'c'])
    expect(within(screen.getByTestId('birds-species-filter')).getByText('Sýkora koňadra')).toBeTruthy()
    fireEvent.click(within(screen.getByTestId('birds-species-filter')).getByRole('button', { name: 'Zobrazit všechny' }))
    await waitFor(() => expect(cards()).toHaveLength(3))
    expect(where()).toBe('/birds')
  })

  it('carries the state of the list to the bird it opens', async () => {
    await catchBird('a', 'parus-major')
    render(app('/birds?sort=name'))
    const link = within(await screen.findByTestId('bird-card')).getByRole('link')
    expect(link.getAttribute('href')).toBe('/birds/a?sort=name')
  })
})

describe('the page of one bird', () => {
  it('shows the BP with its bar, the name, the rarity and the five scores', async () => {
    const points = await catchBird('a', 'bubo-bubo', { confidence: 0.9, placeName: 'Brno' })
    render(app('/birds/a'))
    expect((await screen.findByTestId('bird-name')).textContent).toBe('Výr velký')
    expect(screen.getByText('Bubo bubo').tagName).toBe('I')
    expect(screen.getByText('Epický')).toBeTruthy()
    expect(screen.getByTestId('bp-value').textContent).toBe(String(points.bp))
    const bar = screen.getByTestId('bp-bar')
    expect(bar.getAttribute('aria-valuemin')).toBe('50')
    expect(bar.getAttribute('aria-valuemax')).toBe('750')
    expect(bar.getAttribute('aria-valuenow')).toBe(String(points.bp))
    expect(screen.getByTestId('bp-detail').textContent).toMatch(/^Základ \d+, štěstí [+−]\d+$/)
    const breakdown = screen.getByTestId('bird-breakdown')
    for (const key of ['confidence', 'clarity', 'season', 'timeOfDay', 'way']) expect(within(breakdown).getByTestId(`factor-${key}`)).toBeTruthy()
    expect(within(screen.getByTestId('factor-confidence')).getByText('Jistota')).toBeTruthy()
    expect(within(screen.getByTestId('factor-confidence')).getByRole('meter').getAttribute('aria-valuenow')).toBe('80')
    expect(within(screen.getByTestId('factor-way')).getByRole('meter').getAttribute('aria-valuenow')).toBe('100')
    expect(screen.getByTestId('bird-where').textContent).toContain('Brno')
    expect(screen.getByTestId('bird-way').textContent).toMatch(/Živě, 90\s%/)
    expect(screen.getByTestId('bird-when').textContent).toContain('15. 6. 2026')
    expect(screen.queryByTestId('bird-legacy')).toBeNull()
  })

  it('says that a BP worked out afterwards has a guessed clarity', async () => {
    await catchBird('a', 'parus-major')
    await getDb().catches.update('a', { bpLegacy: true })
    render(app('/birds/a'))
    expect((await screen.findByTestId('bird-legacy')).textContent).toContain('dopočítal')
  })

  it('says there is no breakdown for a bird without one, and shows no BP bar', async () => {
    await catchBird('a', 'parus-major', { plain: true })
    render(app('/birds/a'))
    await screen.findByTestId('bird-name')
    expect(screen.getByText('K tomuhle ptákovi nemám rozpis.')).toBeTruthy()
    expect(screen.queryByTestId('bp')).toBeNull()
  })

  it('has the recording player for a sound catch', async () => {
    await catchBird('a', 'parus-major', { method: 'sound', media: true })
    render(app('/birds/a'))
    await screen.findByTestId('bird-name')
    await waitFor(() => expect(screen.getByTestId('audio-player')).toBeTruthy())
    expect(screen.queryByTestId('bird-photo')).toBeNull()
  })

  it('shows the photo of a photo catch and opens it at full size', async () => {
    await catchBird('a', 'parus-major', { method: 'photo', media: true })
    render(app('/birds/a'))
    fireEvent.click(await screen.findByTestId('bird-photo'))
    expect(await screen.findByRole('dialog', { name: 'Fotka na celou obrazovku' })).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('saves a note, and only offers the button once the text has changed', async () => {
    await catchBird('a', 'parus-major')
    render(app('/birds/a'))
    const box = await screen.findByTestId('bird-note')
    expect(screen.queryByTestId('bird-note-save')).toBeNull()
    fireEvent.change(box, { target: { value: 'U krmítka.' } })
    fireEvent.click(screen.getByTestId('bird-note-save'))
    expect(await screen.findByText('Poznámka je uložená.')).toBeTruthy()
    await waitFor(async () => expect((await getDb().catches.get('a'))?.note).toBe('U krmítka.'))
  })

  it('asks before deleting, keeps the bird on "Ponechat", and deletes only this bird on "Smazat"', async () => {
    await catchBird('a', 'parus-major', { method: 'photo', media: true })
    await catchBird('b', 'parus-major')
    render(app([{ pathname: '/birds' }, { pathname: '/birds/a', search: '?species=parus-major' }]))
    fireEvent.click(await screen.findByTestId('bird-delete'))
    const dialog = await screen.findByRole('alertdialog', { name: 'Smazat tohohle ptáka?' })
    expect(within(dialog).getByText(/Ostatní ptáci tohoto druhu zůstanou/)).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Ponechat' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(await getDb().catches.get('a')).toBeDefined()

    fireEvent.click(screen.getByTestId('bird-delete'))
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Smazat' }))
    await waitFor(() => expect(where()).toBe('/birds?species=parus-major'))
    expect(await getDb().catches.get('a')).toBeUndefined()
    expect(await getDb().catches.get('b')).toBeDefined()
    expect(await getDb().media.count()).toBe(0)
    await waitFor(() => expect(cards()).toHaveLength(1))
  })

  it('steps to the previous and the next bird of the list with the same state, and says the place', async () => {
    await catchBird('a', 'bubo-bubo', { confidence: 0.95 })
    await catchBird('b', 'turdus-merula', { confidence: 0.8 })
    await catchBird('c', 'parus-major', { confidence: 0.6 })
    render(app('/birds/b'))
    await screen.findByTestId('bird-name')
    expect(screen.getByText('2 z 3')).toBeTruthy()
    expect(screen.getByTestId('bird-prev').getAttribute('href')).toBe('/birds/a')
    expect(screen.getByTestId('bird-next').getAttribute('href')).toBe('/birds/c')
    fireEvent.click(screen.getByTestId('bird-next'))
    await waitFor(() => expect(where()).toBe('/birds/c'))
    expect((await screen.findByTestId('bird-name')).textContent).toBe('Sýkora koňadra')
    expect(screen.getByRole('button', { name: 'Další pták' }).hasAttribute('disabled')).toBe(true)
  })

  it('keeps the sorting of the list in the links to the neighbours', async () => {
    await catchBird('a', 'bubo-bubo', { confidence: 0.95, caughtAt: new Date(2026, 5, 10, 12).getTime() })
    await catchBird('b', 'turdus-merula', { confidence: 0.8, caughtAt: new Date(2026, 5, 20, 12).getTime() })
    render(app('/birds/a?sort=newest'))
    await screen.findByTestId('bird-name')
    expect(screen.getByTestId('bird-prev').getAttribute('href')).toBe('/birds/b?sort=newest')
  })

  it('goes back to the list as it was left, or opens the list when there is nothing to go back to', async () => {
    await catchBird('a', 'parus-major')
    render(app([{ pathname: '/birds', search: '?sort=name' }, { pathname: '/birds/a', search: '?sort=name', state: { fromBirds: true } }]))
    fireEvent.click(await screen.findByTestId('bird-back'))
    await waitFor(() => expect(where()).toBe('/birds?sort=name'))
    cleanup()
    render(app('/birds/a?sort=name'))
    fireEvent.click(await screen.findByTestId('bird-back'))
    await waitFor(() => expect(where()).toBe('/birds?sort=name'))
  })

  it('links to the page of the species', async () => {
    await catchBird('a', 'turdus-merula')
    render(app('/birds/a'))
    expect((await screen.findByTestId('bird-species')).getAttribute('href')).toBe('/species/turdus-merula')
  })

  it('tells that the bird is not in the backpack, with a way back', async () => {
    render(app('/birds/nope'))
    expect(await screen.findByText('Tohohle ptáka v batohu nemám.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Zpět k ptákům' }).getAttribute('href')).toBe('/birds')
  })
})
