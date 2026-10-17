import { describe, expect, it, vi } from 'vitest'
import type { Rarity } from '../../src/domain/types'
import { createSoundPlayer, notesFor, soundLength, type AudioContextLike, type OscillatorLike, type ParamLike } from '../../src/features/fun/sounds'

const RARITIES: Rarity[] = ['common', 'uncommon', 'rare', 'epic', 'legendary']

function param(): ParamLike {
  return { value: 0, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() }
}

interface FakeContext extends AudioContextLike {
  oscillators: OscillatorLike[]
  state: string
  resume: ReturnType<typeof vi.fn>
  silent: number
}

function fakeContext(state = 'running'): FakeContext {
  const context: FakeContext = {
    oscillators: [],
    silent: 0,
    state,
    currentTime: 10,
    destination: {},
    resume: vi.fn(async () => {
      context.state = 'running'
    }),
    createOscillator() {
      const oscillator: OscillatorLike = { type: 'sine', frequency: param(), onended: null, connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn() }
      context.oscillators.push(oscillator)
      return oscillator
    },
    createGain() {
      return { gain: param(), connect: vi.fn(), disconnect: vi.fn() }
    },
    createBuffer: () => ({}),
    createBufferSource: () => ({
      buffer: undefined,
      connect: vi.fn(),
      start: () => {
        context.silent += 1
      },
    }),
  }
  return context
}

describe('the notes of the sounds', () => {
  it('has a jingle for every rarity, and the rarer the bird the longer it plays', () => {
    const lengths = RARITIES.map((rarity) => soundLength('catch', rarity))
    for (const length of lengths) expect(length).toBeGreaterThan(0.4)
    for (let index = 1; index < lengths.length; index += 1) expect(lengths[index]).toBeGreaterThanOrEqual(lengths[index - 1])
    expect(lengths[4]).toBeGreaterThan(lengths[0] + 0.5)
  })

  it('is a short rising blip for the lock-on and a soft falling tone for an error', () => {
    const lock = notesFor('lock')
    expect(lock).toHaveLength(2)
    expect(lock[1].freq).toBeGreaterThan(lock[0].freq)
    expect(soundLength('lock')).toBeLessThan(0.4)
    const error = notesFor('error')
    expect(error[1].freq).toBeLessThan(error[0].freq)
    // Soft: gentle waves, not the bright squares of the jingle.
    expect(error.every((note) => note.type === 'triangle')).toBe(true)
  })

  it('keeps every note audible and in a sensible range', () => {
    for (const sound of ['catch', 'lock', 'error'] as const) {
      for (const rarity of RARITIES) {
        for (const note of notesFor(sound, rarity)) {
          expect(note.freq).toBeGreaterThan(200)
          expect(note.freq).toBeLessThan(5000)
          expect(note.duration).toBeGreaterThan(0.05)
          expect(note.start).toBeGreaterThanOrEqual(0)
          expect(note.gain).toBeGreaterThan(0)
          expect(note.gain).toBeLessThanOrEqual(1)
        }
      }
    }
  })
})

describe('the sound player', () => {
  it('plays every note of the jingle through its own oscillator', () => {
    const context = fakeContext()
    const player = createSoundPlayer({ createContext: () => context, isEnabled: () => true })
    player.play('catch', 'rare')
    expect(context.oscillators).toHaveLength(notesFor('catch', 'rare').length)
    for (const oscillator of context.oscillators) {
      expect(oscillator.start).toHaveBeenCalledTimes(1)
      expect(oscillator.stop).toHaveBeenCalledTimes(1)
    }
  })

  it('schedules the notes after the current time of the context, in order', () => {
    const context = fakeContext()
    const player = createSoundPlayer({ createContext: () => context, isEnabled: () => true })
    player.play('lock')
    const starts = context.oscillators.map((oscillator) => (oscillator.start as ReturnType<typeof vi.fn>).mock.calls[0][0] as number)
    expect(starts[0]).toBeGreaterThanOrEqual(10)
    expect(starts[1]).toBeGreaterThan(starts[0])
  })

  it('plays nothing when sound effects are off, and does not even create the context', () => {
    const create = vi.fn(() => fakeContext())
    const player = createSoundPlayer({ createContext: create, isEnabled: () => false })
    player.play('catch', 'legendary')
    expect(create).not.toHaveBeenCalled()
  })

  it('follows the setting as it changes', () => {
    const context = fakeContext()
    let enabled = false
    const player = createSoundPlayer({ createContext: () => context, isEnabled: () => enabled })
    player.play('lock')
    expect(context.oscillators).toHaveLength(0)
    enabled = true
    player.play('lock')
    expect(context.oscillators).toHaveLength(2)
  })

  it('creates the context once, and resumes it when it was suspended (iOS starts it stopped)', () => {
    const context = fakeContext('suspended')
    const create = vi.fn(() => context)
    const player = createSoundPlayer({ createContext: create, isEnabled: () => true })
    player.unlock()
    player.unlock()
    player.play('lock')
    expect(create).toHaveBeenCalledTimes(1)
    expect(context.resume).toHaveBeenCalled()
    expect(context.silent).toBe(2)
  })

  it('unlock starts a silent sound inside the tap, which iOS wants', () => {
    const context = fakeContext('suspended')
    const player = createSoundPlayer({ createContext: () => context, isEnabled: () => true })
    player.unlock()
    expect(context.silent).toBe(1)
    expect(player.isRunning()).toBe(true)
  })

  it('does not break when the browser has no Web Audio', () => {
    const player = createSoundPlayer({ createContext: () => undefined, isEnabled: () => true })
    expect(() => {
      player.unlock()
      player.play('catch', 'epic')
    }).not.toThrow()
    expect(player.isRunning()).toBe(false)
  })

  it('does not break a screen when the audio API throws', () => {
    const context = fakeContext()
    context.createOscillator = () => {
      throw new Error('audio is broken')
    }
    const player = createSoundPlayer({ createContext: () => context, isEnabled: () => true })
    expect(() => player.play('error')).not.toThrow()
  })

  it('can be disposed and starts again afterwards', () => {
    const create = vi.fn(() => fakeContext())
    const player = createSoundPlayer({ createContext: create, isEnabled: () => true })
    player.play('lock')
    player.dispose()
    player.play('lock')
    expect(create).toHaveBeenCalledTimes(2)
  })
})
