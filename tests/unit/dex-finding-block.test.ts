// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { createElement as h } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import type { Species, SpeciesInfo } from '../../src/domain/types'
import { FindingInfo } from '../../src/features/dex/FindingInfo'
import { StatusBlock } from '../../src/features/dex/SpeciesInfo'

afterEach(cleanup)

const WINTER_GUEST: SpeciesInfo = { months: '332100000233', place: 'fields', shy: 3, day: 'dawn_dusk', tip: 'geese' }

function bird(patch: Partial<Species> = {}): Species {
  return {
    id: 'anser-albifrons',
    dexNumber: 2,
    scientificName: 'Anser albifrons',
    czechName: 'Husa běločelá',
    englishName: 'Greater White-fronted Goose',
    family: 'Anatidae',
    inCzechia: true,
    inEurope: true,
    rarity: 'uncommon',
    birdnetIndex: 306,
    wingclipIndex: 78,
    wikiTitle: 'Greater white-fronted goose',
    info: WINTER_GUEST,
    ...patch,
  }
}

const OCTOBER = new Date(2026, 9, 21)
const JULY = new Date(2026, 6, 21)

describe('the finding info block', () => {
  it('shows the months, the place, the shyness, the time of day and the tip of a bird of Czechia', () => {
    render(h(FindingInfo, { species: bird(), caught: false, now: OCTOBER }))
    expect(screen.getByRole('heading', { name: 'Kdy a kde ho hledat' })).toBeTruthy()
    expect(screen.getByText('Kdy')).toBeTruthy()
    expect(screen.getByTestId('finding-months').getAttribute('aria-label')).toBe('Měsíce výskytu: od října do března')
    expect(screen.getByTestId('finding-season').textContent).toBe('Od října do března. Teď je ta správná doba.')
    expect(screen.getByTestId('finding-place').textContent).toBe('Na loukách a polích')
    expect(screen.getByTestId('finding-shy').textContent).toBe('Plachý nebo daleko, chce to zoom')
    expect(screen.getByTestId('finding-day').textContent).toBe('Ráno a k večeru')
    expect(screen.getByTestId('finding-tip').textContent).toContain('Husy se pasou')
    expect(screen.queryByTestId('finding-countries')).toBeNull()
  })

  it('draws twelve months with their levels and marks this month', () => {
    const { container } = render(h(FindingInfo, { species: bird(), caught: false, now: OCTOBER }))
    const cells = [...container.querySelectorAll('.bd-find__month')]
    expect(cells.map((cell) => cell.getAttribute('data-level'))).toEqual(['3', '3', '2', '1', '0', '0', '0', '0', '0', '2', '3', '3'])
    expect(cells.map((cell) => cell.textContent)).toEqual(['L', 'Ú', 'B', 'D', 'K', 'Č', 'Č', 'S', 'Z', 'Ř', 'L', 'P'])
    expect(cells.filter((cell) => cell.hasAttribute('data-now'))).toHaveLength(1)
    expect(cells[9]!.getAttribute('data-now')).toBe('true')
  })

  it('says it is the wrong time of the year, or only a few birds', () => {
    render(h(FindingInfo, { species: bird(), caught: false, now: JULY }))
    expect(screen.getByTestId('finding-season').textContent).toBe('Od října do března. Teď tu nebývá.')
    cleanup()
    render(h(FindingInfo, { species: bird(), caught: false, now: new Date(2026, 3, 10) }))
    expect(screen.getByTestId('finding-season').textContent).toBe('Od října do března. Teď ho potkáš jen výjimečně.')
  })

  it('names the countries of a bird that does not live in Czechia, and says so', () => {
    const species = bird({ inCzechia: false, info: { months: '333333333333', place: 'sea', shy: 3, day: 'day', tip: 'seabirds', countries: ['NO', 'IS', 'GB', 'IE'] } })
    render(h(FindingInfo, { species, caught: false, now: OCTOBER }))
    expect(screen.getByText('Kdy v Evropě')).toBeTruthy()
    expect(screen.getByText('Kde v Evropě')).toBeTruthy()
    expect(screen.getByTestId('finding-countries').textContent).toBe('U nás se nevyskytuje. Norsko, Island, Velká Británie, Irsko')
    expect(screen.getByTestId('finding-season').textContent).toBe('Celý rok. Teď je ta správná doba.')
  })

  it('speaks of meeting the bird again when it is caught', () => {
    render(h(FindingInfo, { species: bird(), caught: true, now: OCTOBER }))
    expect(screen.getByRole('heading', { name: 'Kde a kdy ho potkáš znovu' })).toBeTruthy()
  })

  it('shows the block open for a bird that is not caught, with no button to fold it', () => {
    render(h(FindingInfo, { species: bird(), caught: false, now: OCTOBER }))
    expect(screen.queryByTestId('finding-toggle')).toBeNull()
    expect(screen.getByTestId('finding-season').closest('.bd-find__body')?.hasAttribute('hidden')).toBe(false)
  })

  it('starts folded for a caught bird and unfolds and folds again at a tap on the heading', () => {
    render(h(FindingInfo, { species: bird(), caught: true, now: OCTOBER }))
    const toggle = screen.getByRole('button', { name: 'Kde a kdy ho potkáš znovu' })
    const body = screen.getByTestId('finding-season').closest('.bd-find__body')!
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(toggle.getAttribute('aria-controls')).toBe(body.id)
    expect(body.hasAttribute('hidden')).toBe(true)

    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(body.hasAttribute('hidden')).toBe(false)
    expect(screen.getByTestId('finding-place').textContent).toBe('Na loukách a polích')

    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(body.hasAttribute('hidden')).toBe(true)
  })

  it('says that shyness and time of day are estimates', () => {
    const { container } = render(h(FindingInfo, { species: bird(), caught: false, now: OCTOBER }))
    expect(container.querySelector('.bd-find__estimate')?.textContent).toContain('odhad')
  })

  it('shows one, two or three filled dots for the shyness', () => {
    for (const shy of [1, 2, 3] as const) {
      const { container } = render(h(FindingInfo, { species: bird({ info: { ...WINTER_GUEST, shy } }), caught: false, now: OCTOBER }))
      expect(container.querySelectorAll('.bd-find__dot[data-on="true"]')).toHaveLength(shy)
      cleanup()
    }
  })

  it('shows nothing for a bird without info', () => {
    const { container } = render(h(FindingInfo, { species: bird({ info: undefined }), caught: false, now: OCTOBER }))
    expect(container.innerHTML).toBe('')
  })

  it('does not break on a tip it has no text for', () => {
    render(h(FindingInfo, { species: bird({ info: { ...WINTER_GUEST, tip: 'from-the-future' } }), caught: false, now: OCTOBER }))
    expect(screen.queryByTestId('finding-tip')).toBeNull()
    expect(screen.getByTestId('finding-place')).toBeTruthy()
  })
})

describe('the status block of a bird', () => {
  const summary = { speciesId: 'anser-albifrons', firstCaughtAt: Date.UTC(2026, 4, 3, 10), lastCaughtAt: Date.UTC(2026, 4, 3, 10), count: 2 }
  const renderStatus = (species: Species, caught: boolean) =>
    render(h(MemoryRouter, null, h(StatusBlock, { species, summary: caught ? summary : undefined })))

  it('puts the finding info into the block of a bird that is not caught, above the rarity note and the scan button', () => {
    renderStatus(bird(), false)
    const block = screen.getByTestId('status-missing')
    expect(within(block).getByText('Tohohle ptáka ještě nemáš')).toBeTruthy()
    expect(within(block).getByTestId('finding-info')).toBeTruthy()
    expect(within(block).getByRole('link', { name: 'Jdu ho hledat' })).toBeTruthy()
    expect(block.textContent).not.toContain('Poslouchej v zahradách')
  })

  it('shows the same info under the summary of a caught bird', () => {
    renderStatus(bird(), true)
    const block = screen.getByTestId('status-caught')
    expect(within(block).getByText('Tenhle pták už je tvůj!')).toBeTruthy()
    expect(within(block).getByRole('heading', { name: 'Kde a kdy ho potkáš znovu' })).toBeTruthy()
    // Folded until the person opens it.
    expect(within(block).getByTestId('finding-toggle').getAttribute('aria-expanded')).toBe('false')
  })

  it('falls back to the general tip when the Dex file has no info', () => {
    renderStatus(bird({ info: undefined, family: 'Paridae' }), false)
    const block = screen.getByTestId('status-missing')
    expect(within(block).queryByTestId('finding-info')).toBeNull()
    expect(block.textContent).toContain('Poslouchej v zahradách')
  })
})
