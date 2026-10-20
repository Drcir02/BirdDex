import { describe, expect, it } from 'vitest'
import type { LiveUpdate } from '../../src/domain/engines'
import { canCatchLive, CAMERA_STALL_MS, INITIAL_LIVE_STATE, liveCatchAllowed, liveReducer, StallWatch } from '../../src/features/scan/liveScan'

const update = (overrides: Partial<LiveUpdate> = {}): LiveUpdate => ({
  candidates: [{ speciesId: 'parus-major', confidence: 0.8 }],
  pBird: 0.97,
  framesPerSecond: 1.4,
  ...overrides,
})

const running = () => liveReducer(liveReducer(INITIAL_LIVE_STATE, { type: 'start' }), { type: 'running' })

describe('liveReducer', () => {
  it('goes from idle to starting to running', () => {
    expect(INITIAL_LIVE_STATE.phase).toBe('idle')
    const starting = liveReducer(INITIAL_LIVE_STATE, { type: 'start' })
    expect(starting.phase).toBe('starting')
    expect(liveReducer(starting, { type: 'running' }).phase).toBe('running')
  })

  it('"running" only counts while starting (a late picture signal must not wake a stopped camera)', () => {
    expect(liveReducer(INITIAL_LIVE_STATE, { type: 'running' })).toBe(INITIAL_LIVE_STATE)
    const stalled = liveReducer(running(), { type: 'stalled' })
    expect(liveReducer(stalled, { type: 'running' })).toBe(stalled)
  })

  it('keeps the newest answer of the scanner', () => {
    const next = liveReducer(running(), { type: 'update', update: update({ lockedSpeciesId: 'parus-major' }) })
    expect(next.update?.lockedSpeciesId).toBe('parus-major')
    expect(liveReducer(next, { type: 'update', update: update() }).update?.lockedSpeciesId).toBeUndefined()
  })

  it('ignores answers that arrive after the camera was switched off', () => {
    expect(liveReducer(INITIAL_LIVE_STATE, { type: 'update', update: update() })).toBe(INITIAL_LIVE_STATE)
    const stalled = liveReducer(running(), { type: 'stalled' })
    expect(liveReducer(stalled, { type: 'update', update: update() })).toBe(stalled)
    const paused = liveReducer(running(), { type: 'paused' })
    expect(liveReducer(paused, { type: 'update', update: update() })).toBe(paused)
  })

  it('clears the answer when the camera stalls, pauses or fails', () => {
    const withAnswer = liveReducer(running(), { type: 'update', update: update() })
    expect(liveReducer(withAnswer, { type: 'stalled' })).toEqual({ phase: 'stalled', catching: false, snapshotFailed: false })
    expect(liveReducer(withAnswer, { type: 'paused' }).update).toBeUndefined()
    expect(liveReducer(withAnswer, { type: 'failed', error: 'cameraDenied' })).toMatchObject({ phase: 'error', error: 'cameraDenied' })
  })

  it('shows that the snapshot is being taken, and lets the person try again if it fails', () => {
    const catching = liveReducer(running(), { type: 'catching' })
    expect(catching.catching).toBe(true)
    const failed = liveReducer(catching, { type: 'catchFailed' })
    expect(failed).toMatchObject({ phase: 'running', catching: false, snapshotFailed: true })
    expect(liveReducer(failed, { type: 'catching' }).snapshotFailed).toBe(false)
  })

  it('"catching" does nothing when the camera is not running', () => {
    expect(liveReducer(INITIAL_LIVE_STATE, { type: 'catching' })).toBe(INITIAL_LIVE_STATE)
  })

  it('starts clean after any end', () => {
    const again = liveReducer(liveReducer(running(), { type: 'failed', error: 'generic' }), { type: 'start' })
    expect(again).toEqual({ phase: 'starting', catching: false, snapshotFailed: false })
    expect(liveReducer(running(), { type: 'reset' })).toBe(INITIAL_LIVE_STATE)
  })
})

describe('canCatchLive', () => {
  it('is on only while the camera runs and the scanner has locked on a bird', () => {
    expect(canCatchLive(INITIAL_LIVE_STATE)).toBe(false)
    expect(canCatchLive(running())).toBe(false)
    expect(canCatchLive(liveReducer(running(), { type: 'update', update: update() }))).toBe(false)
    const locked = liveReducer(running(), { type: 'update', update: update({ lockedSpeciesId: 'parus-major' }) })
    expect(canCatchLive(locked)).toBe(true)
  })

  it('is off again while the snapshot is being taken, so a double tap makes one catch', () => {
    const locked = liveReducer(running(), { type: 'update', update: update({ lockedSpeciesId: 'parus-major' }) })
    expect(canCatchLive(liveReducer(locked, { type: 'catching' }))).toBe(false)
  })

  it('is off when the lock is lost', () => {
    const locked = liveReducer(running(), { type: 'update', update: update({ lockedSpeciesId: 'parus-major' }) })
    expect(canCatchLive(liveReducer(locked, { type: 'update', update: update() }))).toBe(false)
  })
})

describe('StallWatch', () => {
  it('waits for the first picture, and gives up after 6 seconds without one', () => {
    expect(CAMERA_STALL_MS).toBe(6000)
    const watch = new StallWatch(1000)
    expect(watch.check({ hasFrame: false, marker: 0 }, 1000)).toBe('waiting')
    expect(watch.check({ hasFrame: false, marker: 0 }, 6999)).toBe('waiting')
    expect(watch.check({ hasFrame: false, marker: 0 }, 7000)).toBe('stalled')
  })

  it('says "running" while pictures keep coming', () => {
    const watch = new StallWatch(0)
    expect(watch.check({ hasFrame: true, marker: 1 }, 800)).toBe('running')
    expect(watch.check({ hasFrame: true, marker: 2 }, 1600)).toBe('running')
    expect(watch.check({ hasFrame: true, marker: 3 }, 20_000)).toBe('running')
  })

  it('catches a camera that stops after it started: no new picture for 6 seconds', () => {
    const watch = new StallWatch(0)
    expect(watch.check({ hasFrame: true, marker: 1 }, 1000)).toBe('running')
    expect(watch.check({ hasFrame: true, marker: 1 }, 6999)).toBe('running')
    expect(watch.check({ hasFrame: true, marker: 1 }, 7000)).toBe('stalled')
  })

  it('does not call a picture "new" when the video has none to show (the marker moves but nothing is drawn)', () => {
    const watch = new StallWatch(0)
    expect(watch.check({ hasFrame: false, marker: 5 }, 3000)).toBe('waiting')
    expect(watch.check({ hasFrame: false, marker: 6 }, 6000)).toBe('stalled')
  })

  it('counts from the last picture, not from the start', () => {
    const watch = new StallWatch(0)
    watch.check({ hasFrame: true, marker: 1 }, 5000)
    expect(watch.check({ hasFrame: true, marker: 1 }, 10_000)).toBe('running')
    expect(watch.check({ hasFrame: true, marker: 1 }, 11_000)).toBe('stalled')
  })

  it('uses another timeout when told to', () => {
    const watch = new StallWatch(0, 1000)
    expect(watch.check({ hasFrame: false, marker: 0 }, 999)).toBe('waiting')
    expect(watch.check({ hasFrame: false, marker: 0 }, 1000)).toBe('stalled')
  })
})

describe('liveCatchAllowed (the same rules as the result screen)', () => {
  const locked = (extra: Partial<LiveUpdate> = {}): LiveUpdate => update({ lockedSpeciesId: 'parus-major', candidates: [{ speciesId: 'parus-major', confidence: 0.85 }], pBird: 0.99, outsideDexTop: 0.05, ...extra })

  it('needs a lock at all', () => {
    expect(liveCatchAllowed(undefined, 'normal')).toBe(false)
    expect(liveCatchAllowed(update(), 'normal')).toBe(false)
  })

  it('lets a sure, clear bird through', () => {
    expect(liveCatchAllowed(locked(), 'normal')).toBe(true)
  })

  it('refuses only a weak guess: the percentage of the sensitivity decides, not the clearness of the picture', () => {
    expect(liveCatchAllowed(locked({ pBird: 0.88 }), 'normal')).toBe(true)
    expect(liveCatchAllowed(locked({ outsideDexTop: 0.6 }), 'normal')).toBe(true)
    expect(liveCatchAllowed(locked({ candidates: [{ speciesId: 'parus-major', confidence: 0.5 }] }), 'normal')).toBe(false)
  })

  it('follows the sensitivity', () => {
    const borderline = locked({ candidates: [{ speciesId: 'parus-major', confidence: 0.6 }] })
    expect(liveCatchAllowed(borderline, 'normal')).toBe(false)
    expect(liveCatchAllowed(borderline, 'easy')).toBe(true)
  })
})
