import { describe, expect, it } from 'vitest'
import type { SoundUpdate } from '../../src/domain/engines'
import { INITIAL_SOUND_STATE, isScanning, remainingMs, SOUND_LIMIT_MS, soundReducer, type SoundScanState } from '../../src/features/scan/soundScan'

const update = (overrides: Partial<SoundUpdate> = {}): SoundUpdate => ({
  candidates: [{ speciesId: 'parus-major', confidence: 0.8 }],
  level: 0.4,
  analysedSeconds: 5,
  hearingBird: true,
  ...overrides,
})

const listening = (): SoundScanState => soundReducer(soundReducer(INITIAL_SOUND_STATE, { type: 'start' }), { type: 'listening', startedAt: 1000 })

describe('the minute limit', () => {
  it('is 60 seconds, as the brief says', () => {
    expect(SOUND_LIMIT_MS).toBe(60_000)
  })

  it('counts what is left of it and never goes below zero', () => {
    expect(remainingMs(0)).toBe(60_000)
    expect(remainingMs(45_000)).toBe(15_000)
    expect(remainingMs(75_000)).toBe(0)
    expect(remainingMs(-5)).toBe(60_000)
  })
})

describe('soundReducer', () => {
  it('starts idle, with nothing heard', () => {
    expect(INITIAL_SOUND_STATE).toMatchObject({ phase: 'idle', level: 0, candidates: [], hearingBird: false, hasResult: false })
    expect(isScanning(INITIAL_SOUND_STATE)).toBe(false)
  })

  it('goes from the tap to "starting" and, when the microphone is open, to "listening"', () => {
    const starting = soundReducer(INITIAL_SOUND_STATE, { type: 'start' })
    expect(starting.phase).toBe('starting')
    expect(isScanning(starting)).toBe(true)
    const open = soundReducer(starting, { type: 'listening', startedAt: 1234 })
    expect(open.phase).toBe('listening')
    expect(open.startedAt).toBe(1234)
    expect(isScanning(open)).toBe(true)
  })

  it('shows the level, the guesses and "I hear a bird" from every update', () => {
    const next = soundReducer(listening(), { type: 'update', update: update() })
    expect(next).toMatchObject({ phase: 'listening', level: 0.4, hearingBird: true, analysedSeconds: 5 })
    expect(next.candidates).toEqual([{ speciesId: 'parus-major', confidence: 0.8 }])
    expect(next.startedAt).toBe(1000)
  })

  it('takes the first update as proof that the microphone works, even before start() has answered', () => {
    const starting = soundReducer(INITIAL_SOUND_STATE, { type: 'start' })
    expect(soundReducer(starting, { type: 'update', update: update() }).phase).toBe('listening')
  })

  it('keeps the guesses array it was given (the engine reuses it until something changes)', () => {
    const candidates = [{ speciesId: 'parus-major', confidence: 0.8 }]
    const next = soundReducer(listening(), { type: 'update', update: update({ candidates }) })
    expect(next.candidates).toBe(candidates)
  })

  it('clamps a level that is out of range or not a number', () => {
    expect(soundReducer(listening(), { type: 'update', update: update({ level: 3 }) }).level).toBe(1)
    expect(soundReducer(listening(), { type: 'update', update: update({ level: -1 }) }).level).toBe(0)
    expect(soundReducer(listening(), { type: 'update', update: update({ level: Number.NaN }) }).level).toBe(0)
  })

  it('ignores updates that arrive when nobody is listening (after Done, or before a start)', () => {
    expect(soundReducer(INITIAL_SOUND_STATE, { type: 'update', update: update() })).toBe(INITIAL_SOUND_STATE)
    const stopping = soundReducer(listening(), { type: 'stopping' })
    expect(soundReducer(stopping, { type: 'update', update: update() })).toBe(stopping)
  })

  it('switches the meter off while the result is being worked out', () => {
    const busy = soundReducer(soundReducer(listening(), { type: 'update', update: update() }), { type: 'stopping' })
    expect(busy.phase).toBe('stopping')
    expect(busy.level).toBe(0)
    expect(isScanning(busy)).toBe(false)
  })

  it('"stopping" does nothing when no scan is running', () => {
    expect(soundReducer(INITIAL_SOUND_STATE, { type: 'stopping' })).toBe(INITIAL_SOUND_STATE)
  })

  it('pauses with a reason, keeping the guesses and saying whether there is anything to show', () => {
    const heard = soundReducer(listening(), { type: 'update', update: update() })
    const paused = soundReducer(heard, { type: 'paused', reason: 'hidden', hasResult: true })
    expect(paused).toMatchObject({ phase: 'paused', pauseReason: 'hidden', hasResult: true, level: 0, hearingBird: false })
    expect(paused.candidates).toHaveLength(1)
    expect(soundReducer(heard, { type: 'paused', reason: 'microphone', hasResult: false })).toMatchObject({ pauseReason: 'microphone', hasResult: false })
  })

  it('fails with a kind of error that the screen turns into a Czech message', () => {
    const failed = soundReducer(soundReducer(INITIAL_SOUND_STATE, { type: 'start' }), { type: 'failed', error: 'micDenied' })
    expect(failed).toMatchObject({ phase: 'error', error: 'micDenied', level: 0 })
    expect(isScanning(failed)).toBe(false)
  })

  it('starts clean after a failure or a pause: no old error, no old guesses', () => {
    const failed = soundReducer(listening(), { type: 'failed', error: 'generic' })
    const again = soundReducer(failed, { type: 'start' })
    expect(again.phase).toBe('starting')
    expect(again.error).toBeUndefined()
    expect(again.candidates).toEqual([])
    const paused = soundReducer(listening(), { type: 'paused', reason: 'hidden', hasResult: true })
    expect(soundReducer(paused, { type: 'start' }).pauseReason).toBeUndefined()
  })

  it('resets to the beginning', () => {
    expect(soundReducer(listening(), { type: 'reset' })).toBe(INITIAL_SOUND_STATE)
  })
})
