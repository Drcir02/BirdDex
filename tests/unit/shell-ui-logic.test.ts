import { describe, expect, it } from 'vitest'
import { DEVICE_STATUSES, resolveStatus } from '../../src/app/deviceStatus'
import { ROUTES, isOpenOnFirstRun, sectionOf, speciesPath } from '../../src/app/routes'
import { classifyError } from '../../src/app/ErrorBoundary'
import { clamp01, confidenceState, cx, litSegments, nextFocusIndex, nextOptionIndex, ringGeometry, segmentTone } from '../../src/ui/logic'
import { SILHOUETTE_SHAPES, silhouetteShapeFor } from '../../src/ui/silhouette'
import { MAX_TOASTS, defaultDuration, toastReducer, type ToastItem } from '../../src/ui/toastState'

describe('clamp01 and cx', () => {
  it('keeps numbers between 0 and 1 and turns junk into 0', () => {
    expect(clamp01(0.4)).toBe(0.4)
    expect(clamp01(-3)).toBe(0)
    expect(clamp01(7)).toBe(1)
    expect(clamp01(Number.NaN)).toBe(0)
    expect(clamp01(Number.POSITIVE_INFINITY)).toBe(0)
  })

  it('joins class names and skips empty ones', () => {
    expect(cx('a', false, null, undefined, 'b', '')).toBe('a b')
    expect(cx()).toBe('')
  })
})

describe('ringGeometry', () => {
  it('keeps the stroke inside the square', () => {
    expect(ringGeometry(100, 10, 0.5).radius).toBe(45)
  })

  it('leaves the unfilled part of the circle as the dash offset (pathLength is 100)', () => {
    expect(ringGeometry(88, 10, 0).dashOffset).toBe(100)
    expect(ringGeometry(88, 10, 0.25).dashOffset).toBe(75)
    expect(ringGeometry(88, 10, 1).dashOffset).toBe(0)
  })

  it('clamps and rounds the percentage', () => {
    expect(ringGeometry(88, 10, 1.7).percent).toBe(100)
    expect(ringGeometry(88, 10, -2).percent).toBe(0)
    expect(ringGeometry(88, 10, 0.356).percent).toBe(36)
    expect(ringGeometry(88, 10, Number.NaN).percent).toBe(0)
  })

  it('never returns a negative radius', () => {
    expect(ringGeometry(8, 20, 0.5).radius).toBe(0)
  })
})

describe('level meter helpers', () => {
  it('lights no segment for silence and at least one for any sound', () => {
    expect(litSegments(0, 16)).toBe(0)
    expect(litSegments(0.001, 16)).toBe(1)
  })

  it('lights segments in proportion and never more than there are', () => {
    expect(litSegments(0.5, 16)).toBe(8)
    expect(litSegments(1, 16)).toBe(16)
    expect(litSegments(3, 16)).toBe(16)
    expect(litSegments(Number.NaN, 16)).toBe(0)
  })

  it('colours the meter green, then yellow, then red', () => {
    const tones = Array.from({ length: 16 }, (_, index) => segmentTone(index, 16))
    expect(tones.slice(0, 9).every((tone) => tone === 'low')).toBe(true)
    expect(tones.slice(9, 13).every((tone) => tone === 'mid')).toBe(true)
    expect(tones.slice(13).every((tone) => tone === 'high')).toBe(true)
  })
})

describe('confidenceState', () => {
  it('is neutral without a threshold', () => {
    expect(confidenceState(0.9)).toBe('neutral')
  })

  it('says whether the guess reaches the catch threshold, including exactly at it', () => {
    expect(confidenceState(0.69, 0.7)).toBe('below')
    expect(confidenceState(0.7, 0.7)).toBe('met')
    expect(confidenceState(0.95, 0.7)).toBe('met')
  })
})

describe('nextFocusIndex (focus trap)', () => {
  it('moves forward and wraps to the first element', () => {
    expect(nextFocusIndex(3, 0, false)).toBe(1)
    expect(nextFocusIndex(3, 2, false)).toBe(0)
  })

  it('moves backward and wraps to the last element', () => {
    expect(nextFocusIndex(3, 2, true)).toBe(1)
    expect(nextFocusIndex(3, 0, true)).toBe(2)
  })

  it('pulls focus in from outside: first element going forward, last going backward', () => {
    expect(nextFocusIndex(3, -1, false)).toBe(0)
    expect(nextFocusIndex(3, -1, true)).toBe(2)
  })

  it('has nowhere to go when nothing can be focused', () => {
    expect(nextFocusIndex(0, -1, false)).toBe(-1)
  })
})

describe('nextOptionIndex (arrow keys in a radio group)', () => {
  it('moves on with right and down, wrapping at the end', () => {
    expect(nextOptionIndex(3, 0, 'ArrowRight')).toBe(1)
    expect(nextOptionIndex(3, 1, 'ArrowDown')).toBe(2)
    expect(nextOptionIndex(3, 2, 'ArrowRight')).toBe(0)
  })

  it('moves back with left and up, wrapping at the start', () => {
    expect(nextOptionIndex(3, 1, 'ArrowLeft')).toBe(0)
    expect(nextOptionIndex(3, 0, 'ArrowUp')).toBe(2)
  })

  it('jumps to the ends with Home and End', () => {
    expect(nextOptionIndex(4, 2, 'Home')).toBe(0)
    expect(nextOptionIndex(4, 1, 'End')).toBe(3)
  })

  it('leaves every other key alone', () => {
    expect(nextOptionIndex(3, 1, 'a')).toBeNull()
    expect(nextOptionIndex(3, 1, 'Enter')).toBeNull()
    expect(nextOptionIndex(0, 0, 'ArrowRight')).toBeNull()
  })
})

describe('silhouetteShapeFor', () => {
  it.each([
    ['Anatidae', 'duck'],
    ['Podicipedidae', 'duck'],
    ['Laridae', 'duck'],
    ['Strigidae', 'owl'],
    ['Tytonidae', 'owl'],
    ['Accipitridae', 'raptor'],
    ['Falconidae', 'raptor'],
    ['Ardeidae', 'wader'],
    ['Scolopacidae', 'wader'],
    ['Paridae', 'songbird'],
    ['Alcedinidae', 'songbird'],
    ['Alaudidae', 'songbird'],
  ] as const)('%s gets the %s outline', (family, shape) => {
    expect(silhouetteShapeFor(family)).toBe(shape)
  })

  it('understands English and Czech family names too', () => {
    expect(silhouetteShapeFor('Ducks, Geese, and Waterfowl')).toBe('duck')
    expect(silhouetteShapeFor('Owls')).toBe('owl')
    expect(silhouetteShapeFor('Hawks, Eagles, and Kites')).toBe('raptor')
    expect(silhouetteShapeFor('Herons, Egrets, and Bitterns')).toBe('wader')
    expect(silhouetteShapeFor('kachnovití')).toBe('duck')
    expect(silhouetteShapeFor('Sovovití')).toBe('owl')
    expect(silhouetteShapeFor('Volavkovití')).toBe('wader')
  })

  it('falls back to the songbird for unknown or missing families', () => {
    expect(silhouetteShapeFor(null)).toBe('songbird')
    expect(silhouetteShapeFor(undefined)).toBe('songbird')
    expect(silhouetteShapeFor('')).toBe('songbird')
    expect(silhouetteShapeFor('Something else')).toBe('songbird')
  })

  it('only ever returns a shape the component can draw', () => {
    for (const family of ['Anatidae', 'Strigidae', 'Accipitridae', 'Ardeidae', 'Paridae', null]) {
      expect(SILHOUETTE_SHAPES).toContain(silhouetteShapeFor(family))
    }
  })
})

describe('toastReducer', () => {
  const toast = (id: number, message = `message ${id}`, tone: ToastItem['tone'] = 'info'): ToastItem => ({ id, message, tone, durationMs: 1000 })

  it('adds messages in order', () => {
    const state = toastReducer(toastReducer([], { type: 'add', toast: toast(1) }), { type: 'add', toast: toast(2) })
    expect(state.map((item) => item.id)).toEqual([1, 2])
  })

  it('keeps at most MAX_TOASTS and drops the oldest first', () => {
    let state: ToastItem[] = []
    for (let id = 1; id <= MAX_TOASTS + 2; id += 1) state = toastReducer(state, { type: 'add', toast: toast(id) })
    expect(state).toHaveLength(MAX_TOASTS)
    expect(state[0]?.id).toBe(3)
    expect(state.at(-1)?.id).toBe(MAX_TOASTS + 2)
  })

  it('shows the same message once, as the newest', () => {
    let state = toastReducer([], { type: 'add', toast: toast(1, 'Hello') })
    state = toastReducer(state, { type: 'add', toast: toast(2, 'Other') })
    state = toastReducer(state, { type: 'add', toast: toast(3, 'Hello') })
    expect(state.map((item) => item.id)).toEqual([2, 3])
  })

  it('treats the same text with another tone as a different message', () => {
    let state = toastReducer([], { type: 'add', toast: toast(1, 'Hello', 'info') })
    state = toastReducer(state, { type: 'add', toast: toast(2, 'Hello', 'error') })
    expect(state).toHaveLength(2)
  })

  it('dismisses one message or clears all', () => {
    const two = [toast(1), toast(2)]
    expect(toastReducer(two, { type: 'dismiss', id: 1 }).map((item) => item.id)).toEqual([2])
    expect(toastReducer(two, { type: 'dismiss', id: 99 })).toHaveLength(2)
    expect(toastReducer(two, { type: 'clear' })).toEqual([])
  })

  it('does not change the list it was given', () => {
    const original = [toast(1)]
    toastReducer(original, { type: 'add', toast: toast(2) })
    expect(original).toHaveLength(1)
  })

  it('keeps errors on screen longer than other messages', () => {
    expect(defaultDuration('error')).toBeGreaterThan(defaultDuration('info'))
    expect(defaultDuration('success')).toBeGreaterThan(0)
  })
})

describe('resolveStatus (the lights)', () => {
  it('is idle when nobody claims anything', () => {
    expect(resolveStatus([], null)).toBe('idle')
  })

  it('shows the newest claim', () => {
    expect(
      resolveStatus(
        [
          { id: 1, status: 'listening' },
          { id: 2, status: 'busy' },
        ],
        null,
      ),
    ).toBe('busy')
  })

  it('lets a flash beat every claim', () => {
    expect(resolveStatus([{ id: 1, status: 'listening' }], 'success')).toBe('success')
  })

  it('knows every status the CSS draws', () => {
    expect([...DEVICE_STATUSES]).toEqual(['idle', 'listening', 'busy', 'success', 'error'])
  })
})

describe('routes', () => {
  it('matches the contract in the brief', () => {
    expect(ROUTES).toMatchObject({
      dex: '/',
      species: '/species/:id',
      scan: '/scan',
      scanSound: '/scan/sound',
      scanPhoto: '/scan/photo',
      scanLive: '/scan/live',
      result: '/result',
      settings: '/settings',
      about: '/about',
      welcome: '/welcome',
      fieldCheck: '/field-check',
    })
  })

  it('builds a species path and encodes odd ids', () => {
    expect(speciesPath('parus-major')).toBe('/species/parus-major')
    expect(speciesPath('a/b c')).toBe('/species/a%2Fb%20c')
  })

  it('lights the right navigation button', () => {
    expect(sectionOf('/')).toBe('dex')
    expect(sectionOf('/species/parus-major')).toBe('dex')
    expect(sectionOf('/scan')).toBe('scan')
    expect(sectionOf('/scan/sound')).toBe('scan')
    expect(sectionOf('/scan/live')).toBe('scan')
    expect(sectionOf('/result')).toBe('scan')
    expect(sectionOf('/settings')).toBe('settings')
    expect(sectionOf('/about')).toBe('settings')
  })

  it('lights nothing for screens outside the navigation', () => {
    expect(sectionOf('/welcome')).toBeNull()
    expect(sectionOf('/ui-kit')).toBeNull()
    expect(sectionOf('/field-check')).toBeNull()
    expect(sectionOf('/nothing-here')).toBeNull()
    expect(sectionOf('/scanner')).toBeNull()
  })

  it('opens only the welcome, kit and field-check screens before the first visit is done', () => {
    expect(isOpenOnFirstRun('/welcome')).toBe(true)
    expect(isOpenOnFirstRun('/ui-kit')).toBe(true)
    expect(isOpenOnFirstRun('/field-check')).toBe(true)
    expect(isOpenOnFirstRun('/')).toBe(false)
    expect(isOpenOnFirstRun('/scan')).toBe(false)
    expect(isOpenOnFirstRun('/settings')).toBe(false)
  })
})

describe('classifyError', () => {
  it('recognises a screen that failed to download', () => {
    expect(classifyError(new TypeError('Failed to fetch dynamically imported module: https://x/assets/DexPage-1.js'))).toBe('chunk')
    expect(classifyError(new TypeError('Importing a module script failed.'))).toBe('chunk')
    const chunk = new Error('Loading chunk 12 failed.')
    chunk.name = 'ChunkLoadError'
    expect(classifyError(chunk)).toBe('chunk')
  })

  it('treats anything else as a plain failure', () => {
    expect(classifyError(new Error('Cannot read properties of undefined'))).toBe('generic')
    expect(classifyError('boom')).toBe('generic')
    expect(classifyError(undefined)).toBe('generic')
  })
})
