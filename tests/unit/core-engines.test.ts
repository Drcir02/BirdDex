// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Engines, LiveScanner, PhotoEngine, SoundEngine } from '../../src/domain/engines'
import {
  buildEngines,
  createEngines,
  ENGINES_STORAGE_KEY,
  getEngineMode,
  getEngines,
  getFakeChoice,
  pickEngine,
  readChoice,
  resetEngines,
} from '../../src/ml/engines'

const open = (path: string) => window.history.replaceState({}, '', path)

beforeEach(() => {
  localStorage.clear()
  open('/')
  resetEngines()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('choosing real or fake engines', () => {
  it('uses the real engines by default', () => {
    expect(getEngineMode()).toBe('real')
  })

  it('uses the fakes with ?engines=fake in the address', () => {
    open('/?engines=fake')
    expect(getEngineMode()).toBe('fake')
  })

  it('also reads the choice from behind the # (the app uses hash routes)', () => {
    open('/#/scan/sound?engines=fake')
    expect(getEngineMode()).toBe('fake')
  })

  it('uses the fakes when localStorage says so', () => {
    localStorage.setItem(ENGINES_STORAGE_KEY, 'fake')
    expect(getEngineMode()).toBe('fake')
  })

  it('lets the address beat localStorage', () => {
    localStorage.setItem('birddex:engines', 'fake')
    open('/?engines=real')
    expect(getEngineMode()).toBe('real')
  })

  it.each(['', 'FAKE', 'yes', 'true', '1'])('ignores the value "%s"', (value) => {
    open(`/?engines=${value}`)
    expect(getEngineMode()).toBe('real')
    localStorage.setItem('birddex:engines', value)
    open('/')
    expect(getEngineMode()).toBe('real')
  })

  it('does not break when localStorage is blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError')
    })
    expect(readChoice('engines')).toBeUndefined()
    expect(getEngineMode()).toBe('real')
    open('/?engines=fake')
    expect(getEngineMode()).toBe('fake')
  })

  it('reads the story and the speed the fakes should use', () => {
    expect(getFakeChoice()).toEqual({})
    open('/?engines=fake&fake=low&fakeDelay=0')
    expect(getFakeChoice()).toEqual({ scenario: 'low', delayMs: 0 })
    open('/?fake=empty&fakeDelay=40')
    expect(getFakeChoice()).toEqual({ scenario: 'empty', delayMs: 40 })
    localStorage.setItem('birddex:fake', 'unclear')
    open('/')
    expect(getFakeChoice()).toEqual({ scenario: 'unclear' })
  })

  it.each(['', ' ', '-5', 'fast', 'NaN'])('ignores the fake delay "%s"', (value) => {
    open(`/?fakeDelay=${encodeURIComponent(value)}`)
    expect(getFakeChoice().delayMs).toBeUndefined()
  })

  it('hands every screen the same engines, and decides only once', () => {
    open('/?engines=fake')
    const first = getEngines()
    open('/')
    expect(getEngines()).toBe(first)
    resetEngines()
    expect(getEngines()).not.toBe(first)
  })
})

describe('engines that load themselves', () => {
  const makeSound = () => ({ prepare: vi.fn(async () => undefined), start: vi.fn(async () => ({ stop: async () => ({ candidates: [] }) })) }) satisfies SoundEngine
  const makePhoto = () => ({ prepare: vi.fn(async () => undefined), identify: vi.fn(async () => ({ candidates: [], pBird: 0.5 })) }) satisfies PhotoEngine
  const makeLive = () => ({ start: vi.fn(async () => ({ stop: () => undefined, snapshot: async () => new Blob() })) }) satisfies LiveScanner

  function build() {
    const sound = makeSound()
    const photo = makePhoto()
    const live = makeLive()
    const loaders = { sound: vi.fn(async () => sound), photo: vi.fn(async () => photo), live: vi.fn(async () => live) }
    return { sound, photo, live, loaders, engines: buildEngines(loaders) }
  }

  it('loads nothing until a screen uses an engine, and each engine only once', async () => {
    const { engines, loaders, sound } = build()
    expect(loaders.sound).not.toHaveBeenCalled()
    await engines.sound.prepare()
    await engines.sound.prepare()
    await engines.sound.start({ onUpdate: () => undefined })
    expect(loaders.sound).toHaveBeenCalledTimes(1)
    expect(loaders.photo).not.toHaveBeenCalled()
    expect(loaders.live).not.toHaveBeenCalled()
    expect(sound.prepare).toHaveBeenCalledTimes(2)
  })

  it('passes the progress callback, the options and the image on', async () => {
    const { engines, sound, photo, live } = build()
    const onProgress = vi.fn()
    await engines.sound.prepare(onProgress)
    expect(sound.prepare).toHaveBeenCalledWith(onProgress)

    const onUpdate = vi.fn()
    await engines.sound.start({ onUpdate, location: { lat: 50, lon: 14 } })
    expect(sound.start).toHaveBeenCalledWith({ onUpdate, location: { lat: 50, lon: 14 } })

    const image = {} as HTMLCanvasElement
    expect(await engines.photo.identify(image, { date: new Date(0) })).toEqual({ candidates: [], pBird: 0.5 })
    expect(photo.identify).toHaveBeenCalledWith(image, { date: new Date(0) })

    const video = {} as HTMLVideoElement
    await engines.live.start(video, { onUpdate })
    expect(live.start).toHaveBeenCalledWith(video, { onUpdate })
  })

  it('starts the microphone in the same moment as the tap once the engine is prepared', async () => {
    const { engines, sound } = build()
    await engines.sound.prepare()
    // No waiting between the call and the engine's own start(): that is what iOS needs for audio.
    void engines.sound.start({ onUpdate: () => undefined })
    expect(sound.start).toHaveBeenCalledTimes(1)
  })

  it('starts the live camera at once when the scanner is already loaded', async () => {
    const { engines, live } = build()
    await engines.live.start({} as HTMLVideoElement, { onUpdate: () => undefined })
    void engines.live.start({} as HTMLVideoElement, { onUpdate: () => undefined })
    expect(live.start).toHaveBeenCalledTimes(2)
  })

  it('still works when start() is called before prepare(): it waits for the engine to load', async () => {
    const { engines, sound } = build()
    const started = engines.sound.start({ onUpdate: () => undefined })
    expect(sound.start).not.toHaveBeenCalled()
    await started
    expect(sound.start).toHaveBeenCalledTimes(1)
  })

  it('tries loading again after a load failed', async () => {
    const sound = makeSound()
    let attempts = 0
    const engines = buildEngines({
      sound: async () => {
        if (++attempts === 1) throw new Error('chunk failed to load')
        return sound
      },
      photo: async () => makePhoto(),
      live: async () => makeLive(),
    })
    await expect(engines.sound.prepare()).rejects.toThrow('chunk failed to load')
    await engines.sound.prepare()
    expect(attempts).toBe(2)
    expect(sound.prepare).toHaveBeenCalledTimes(1)
  })

  it('passes on errors from the engine itself', async () => {
    const { engines, sound } = build()
    sound.prepare.mockRejectedValueOnce(new Error('model failed to load'))
    await expect(engines.sound.prepare()).rejects.toThrow('model failed to load')
    await expect(engines.sound.prepare()).resolves.toBeUndefined()
  })
})

describe('pickEngine', () => {
  const engine = { prepare: async () => undefined, start: async () => ({ stop: async () => ({ candidates: [] }) }) }
  const isEngine = (value: unknown): value is typeof engine => typeof (value as typeof engine)?.start === 'function'

  it('calls a factory export', () => {
    const factory = vi.fn(() => engine)
    expect(pickEngine({ createSoundEngine: factory }, ['createSoundEngine', 'soundEngine', 'default'], isEngine, 'sound')).toBe(engine)
    expect(factory).toHaveBeenCalledTimes(1)
  })

  it('takes a ready-made engine object, by name or as the default export', () => {
    expect(pickEngine({ soundEngine: engine }, ['createSoundEngine', 'soundEngine', 'default'], isEngine, 'sound')).toBe(engine)
    expect(pickEngine({ default: engine }, ['createSoundEngine', 'soundEngine', 'default'], isEngine, 'sound')).toBe(engine)
  })

  it('takes a default export that is a factory', () => {
    expect(pickEngine({ default: () => engine }, ['createSoundEngine', 'default'], isEngine, 'sound')).toBe(engine)
  })

  it('prefers the first name that gives an engine, and skips exports that are not engines', () => {
    const other = { ...engine }
    expect(pickEngine({ createSoundEngine: () => 'nonsense', soundEngine: other }, ['createSoundEngine', 'soundEngine'], isEngine, 'sound')).toBe(other)
  })

  it('explains which exports it looked for when there is no engine', () => {
    expect(() => pickEngine({ somethingElse: 1 }, ['createSoundEngine', 'default'], isEngine, 'sound engine')).toThrow(
      /sound engine module has no engine.*createSoundEngine, default/,
    )
  })
})

describe('the fakes through getEngines()', () => {
  it('give believable results after a short delay', async () => {
    open('/?engines=fake&fakeDelay=0')
    const engines: Engines = getEngines()
    await engines.photo.prepare()
    const result = await engines.photo.identify({} as HTMLCanvasElement)
    expect(result.candidates[0]).toEqual({ speciesId: 'parus-major', confidence: 0.88 })
    expect(result.pBird).toBeGreaterThan(0.9)
  })

  it('tell the story that was asked for', async () => {
    open('/?engines=fake&fakeDelay=0&fake=low')
    const engines = getEngines()
    const result = await engines.photo.identify({} as HTMLCanvasElement)
    expect(result.candidates[0].confidence).toBeLessThan(0.45)
  })

  it('fall back to the default story for an unknown name', async () => {
    const engines = createEngines('fake', { scenario: 'telepathy', delayMs: 0 })
    const result = await engines.photo.identify({} as HTMLCanvasElement)
    expect(result.candidates[0].speciesId).toBe('parus-major')
  })
})
