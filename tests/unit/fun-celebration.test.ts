// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { createElement as h } from 'react'
import { StrictMode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Rarity } from '../../src/domain/types'
import { planCelebration, seededRandom } from '../../src/features/fun/confetti'
import { CatchCelebration } from '../../src/features/fun/CatchCelebration'
import { NewBadge } from '../../src/features/fun/NewBadge'

const RARITIES: Rarity[] = ['common', 'uncommon', 'rare', 'epic', 'legendary']

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  Reflect.deleteProperty(window, 'matchMedia')
})

function reduceMotion(reduce: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: reduce && query.includes('prefers-reduced-motion'),
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })) as unknown as typeof window.matchMedia
}

describe('planCelebration', () => {
  it('is the same every time for the same rarity', () => {
    for (const rarity of RARITIES) expect(planCelebration(rarity, true)).toEqual(planCelebration(rarity, true))
  })

  it('makes more confetti for rarer birds', () => {
    const counts = RARITIES.map((rarity) => planCelebration(rarity).pieces.length)
    for (let index = 1; index < counts.length; index += 1) expect(counts[index]).toBeGreaterThan(counts[index - 1])
  })

  it('makes a bigger show for a species that is new', () => {
    for (const rarity of RARITIES) {
      expect(planCelebration(rarity, true).pieces.length).toBeGreaterThan(planCelebration(rarity, false).pieces.length)
      expect(planCelebration(rarity, true).sparkles.length).toBeGreaterThan(planCelebration(rarity, false).sparkles.length)
    }
  })

  it('has the golden flash for legendary birds only, and a ring for rare and above', () => {
    expect(RARITIES.filter((rarity) => planCelebration(rarity).flash)).toEqual(['legendary'])
    expect(RARITIES.filter((rarity) => planCelebration(rarity).ring)).toEqual(['rare', 'epic', 'legendary'])
  })

  it('keeps every piece in a sensible range and uses colours of the palette', () => {
    for (const rarity of RARITIES) {
      const plan = planCelebration(rarity, true)
      for (const piece of plan.pieces) {
        expect(piece.angle).toBeGreaterThanOrEqual(-30)
        expect(piece.angle).toBeLessThanOrEqual(400)
        expect(piece.distance).toBeGreaterThan(40)
        expect(piece.distance).toBeLessThan(200)
        expect(piece.size).toBeGreaterThan(4)
        expect(piece.delay).toBeLessThan(0.3)
        expect(piece.colour).toBeGreaterThanOrEqual(0)
        expect(piece.colour).toBeLessThan(plan.palette.length)
      }
    }
  })

  it('has a random generator that stays between 0 and 1 and repeats for one seed', () => {
    const first = seededRandom(5)
    const second = seededRandom(5)
    for (let index = 0; index < 100; index += 1) {
      const value = first()
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(1)
      expect(second()).toBe(value)
    }
  })
})

describe('CatchCelebration', () => {
  it('draws the confetti for the rarity, hidden from screen readers', () => {
    reduceMotion(false)
    const { container } = render(h(CatchCelebration, { rarity: 'rare', playSound: () => undefined }))
    const root = screen.getByTestId('celebration')
    expect(root.getAttribute('aria-hidden')).toBe('true')
    expect(root.getAttribute('data-rarity')).toBe('rare')
    expect(container.querySelectorAll('.bd-fun-piece')).toHaveLength(planCelebration('rare').pieces.length)
    expect(container.querySelectorAll('.bd-fun-sparkle')).toHaveLength(planCelebration('rare').sparkles.length)
    expect(container.querySelector('.bd-fun-ring')).toBeTruthy()
    expect(screen.queryByTestId('celebration-flash')).toBeNull()
  })

  it('adds the golden flash for a legendary bird', () => {
    reduceMotion(false)
    render(h(CatchCelebration, { rarity: 'legendary', playSound: () => undefined }))
    expect(screen.getByTestId('celebration-flash')).toBeTruthy()
  })

  it('shows the NOVÝ stamp only for a new species', () => {
    reduceMotion(false)
    const { rerender } = render(h(CatchCelebration, { rarity: 'common', isNew: false, playSound: () => undefined }))
    expect(screen.queryByTestId('new-badge')).toBeNull()
    rerender(h(CatchCelebration, { rarity: 'common', isNew: true, playSound: () => undefined }))
    expect(screen.getByTestId('new-badge').textContent).toBe('NOVÝ')
    expect(screen.getByTestId('celebration').getAttribute('data-new')).toBe('true')
  })

  it('plays the catch jingle once, with the rarity', () => {
    reduceMotion(false)
    const play = vi.fn()
    const { rerender } = render(h(CatchCelebration, { rarity: 'epic', playSound: play }))
    rerender(h(CatchCelebration, { rarity: 'epic', playSound: play }))
    expect(play).toHaveBeenCalledTimes(1)
    expect(play).toHaveBeenCalledWith('catch', 'epic')
  })

  it('plays the jingle only once even when React runs the effect twice (development mode)', () => {
    reduceMotion(false)
    const play = vi.fn()
    render(h(StrictMode, null, h(CatchCelebration, { rarity: 'common', playSound: play })))
    expect(play).toHaveBeenCalledTimes(1)
  })

  it('with reduced motion draws no flying pieces, only the stamp, and still plays the sound', () => {
    reduceMotion(true)
    const play = vi.fn()
    const { container } = render(h(CatchCelebration, { rarity: 'legendary', isNew: true, playSound: play }))
    expect(screen.getByTestId('celebration').getAttribute('data-motion')).toBe('reduced')
    expect(container.querySelectorAll('.bd-fun-piece, .bd-fun-sparkle, .bd-fun-ring, .bd-fun-flash, .bd-fun-rays')).toHaveLength(0)
    expect(screen.getByTestId('new-badge')).toBeTruthy()
    expect(play).toHaveBeenCalledTimes(1)
  })

  it('can be used alone: the stamp is a plain label', () => {
    render(h(NewBadge, null))
    expect(screen.getByTestId('new-badge').textContent).toBe('NOVÝ')
  })
})
