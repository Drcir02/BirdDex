// Where the screens get the identification engines: getEngines().
//
//   const engines = getEngines()
//   await engines.sound.prepare(onProgress)           // downloads and prepares the models (safe to call often)
//   const session = await engines.sound.start(...)    // call this straight from a tap
//
// The real engines (src/ml/sound/engine.ts, src/ml/vision/engine.ts, src/ml/vision/live.ts) are loaded lazily, the
// first time a screen uses them, so they and their runtimes stay out of the first page load. Because of that, call
// prepare() before the tap that calls start(): once the engine is loaded, start() runs at once, inside the tap, which
// iOS needs for audio. (Before that, start() first waits for the engine to load.)
//
// With ?engines=fake in the address, or localStorage["birddex:engines"] = "fake", the screens get the fakes from
// src/ml/fakes.ts instead: no models, no microphone, instant believable results. In the same way
// ?fake=<scenario> picks the story the fakes tell (clear, low, unclear, empty, download-error, storage-full)
// and ?fakeDelay=<ms> their speed. The address wins over localStorage.

import type { Engines, ImageSource, LiveScanner, PhotoEngine, SoundEngine } from '../domain/engines'

export type EngineMode = 'real' | 'fake'

export const ENGINES_STORAGE_KEY = 'birddex:engines'

// ---------- Choosing real or fake ----------

/** Reads one choice (for example "engines") from the address, then from localStorage ("birddex:engines"). */
export function readChoice(name: string): string | undefined {
  try {
    const hash = typeof location === 'undefined' ? '' : location.hash
    const queries = [typeof location === 'undefined' ? '' : location.search, hash.includes('?') ? hash.slice(hash.indexOf('?')) : '']
    for (const query of queries) {
      const value = new URLSearchParams(query).get(name)
      if (value) return value
    }
  } catch {
    // Fall through to storage.
  }
  try {
    return localStorage.getItem(`birddex:${name}`) ?? undefined
  } catch {
    return undefined
  }
}

export function getEngineMode(): EngineMode {
  return readChoice('engines') === 'fake' ? 'fake' : 'real'
}

/** How the fakes should behave, as asked for in the address or localStorage. fakes.ts checks the values. */
export interface FakeChoice {
  scenario?: string
  delayMs?: number
}

export function getFakeChoice(): FakeChoice {
  const choice: FakeChoice = {}
  const scenario = readChoice('fake')
  if (scenario) choice.scenario = scenario
  const delay = readChoice('fakeDelay')
  if (delay !== undefined && delay.trim() !== '' && Number.isFinite(Number(delay)) && Number(delay) >= 0) choice.delayMs = Number(delay)
  return choice
}

// ---------- Loading an engine on first use ----------

interface Lazy<T> {
  /** Loads the engine (once) and returns it. A failed load is tried again next time. */
  get(): Promise<T>
  /** The engine if it is already loaded. */
  peek(): T | undefined
}

function lazy<T>(load: () => Promise<T>): Lazy<T> {
  let loaded: T | undefined
  let loading: Promise<T> | undefined
  return {
    get() {
      loading ??= load().then(
        (engine) => (loaded = engine),
        (error: unknown) => {
          loading = undefined
          throw error
        },
      )
      return loading
    },
    peek: () => loaded,
  }
}

const hasMethods = (value: unknown, methods: string[]): boolean =>
  typeof value === 'object' && value !== null && methods.every((name) => typeof (value as Record<string, unknown>)[name] === 'function')

const isSoundEngine = (value: unknown): value is SoundEngine => hasMethods(value, ['prepare', 'start'])
const isPhotoEngine = (value: unknown): value is PhotoEngine => hasMethods(value, ['prepare', 'identify'])
const isLiveScanner = (value: unknown): value is LiveScanner => hasMethods(value, ['start'])

/**
 * Finds the engine in a module. The engine modules are written by other tasks, so be tolerant: a factory function
 * (createSoundEngine), a ready-made engine object (soundEngine) or a default export of either kind all work.
 */
export function pickEngine<T>(module: Record<string, unknown>, names: string[], isEngine: (value: unknown) => value is T, what: string): T {
  for (const name of names) {
    const exported = module[name]
    if (typeof exported === 'function') {
      const made = (exported as () => unknown)()
      if (isEngine(made)) return made
    } else if (isEngine(exported)) {
      return exported
    }
  }
  throw new Error(`The ${what} module has no engine: expected one of the exports ${names.join(', ')}`)
}

// ---------- Engines that load themselves on first use ----------

function lazySound(source: Lazy<SoundEngine>): SoundEngine {
  return {
    prepare: (onProgress) => source.get().then((engine) => engine.prepare(onProgress)),
    start: (options) => {
      const engine = source.peek()
      // Already loaded: start inside the tap. Otherwise wait for the engine first.
      return engine ? engine.start(options) : source.get().then((loaded) => loaded.start(options))
    },
  }
}

function lazyPhoto(source: Lazy<PhotoEngine>): PhotoEngine {
  return {
    prepare: (onProgress) => source.get().then((engine) => engine.prepare(onProgress)),
    identify: (image: ImageSource, options) => source.get().then((engine) => engine.identify(image, options)),
  }
}

function lazyLive(source: Lazy<LiveScanner>): LiveScanner {
  return {
    start: (video, options) => {
      const scanner = source.peek()
      return scanner ? scanner.start(video, options) : source.get().then((loaded) => loaded.start(video, options))
    },
  }
}

/** How to get each engine. The engines are only loaded when a screen first uses them. */
export interface EngineLoaders {
  sound: () => Promise<SoundEngine>
  photo: () => Promise<PhotoEngine>
  live: () => Promise<LiveScanner>
}

/** Wraps loaders into engines that load themselves on first use. Exported for tests; screens use getEngines(). */
export function buildEngines(loaders: EngineLoaders): Engines {
  return {
    sound: lazySound(lazy(loaders.sound)),
    photo: lazyPhoto(lazy(loaders.photo)),
    live: lazyLive(lazy(loaders.live)),
  }
}

// Memory on a phone: BirdNET (about 350 MB of WebAssembly) and WingCLIP (230 to 260 MB) must not sit in memory together. Each lets
// go of itself after an idle time (a minute and three minutes), but going from the photo screen to the sound screen takes seconds,
// so preparing one engine first gives the other one's model back. Only models that are loaded are touched, and never during a scan:
// prepare() is called when a screen opens, before anything runs on it.
interface Releasable {
  dispose?: () => Promise<void>
}
let realSound: Releasable | undefined
let visionLoaded = false

const releaseSound = (): Promise<void> => realSound?.dispose?.().catch(() => undefined) ?? Promise.resolve()
async function releaseVision(): Promise<void> {
  if (!visionLoaded) return
  try {
    await (await import('./vision/runtime')).getVisionRuntime().dispose()
  } catch {
    // Only memory is at stake.
  }
}

/**
 * The loaders of the real engines, written by tasks E1 and E2. The photo engine and the live camera also get BirdNET's
 * location model as their occurrence prior (src/ml/vision/geoPrior.ts), which only does something when the model is on the phone.
 */
export const realLoaders: EngineLoaders = {
  sound: () =>
    import('./sound/engine')
      .then((module) => pickEngine(module as Record<string, unknown>, ['createSoundEngine', 'soundEngine', 'default'], isSoundEngine, 'sound engine'))
      .then((engine): SoundEngine => {
        realSound = engine as SoundEngine & Releasable
        // start() is handed through untouched: it has to run inside the tap.
        return {
          prepare: async (onProgress) => {
            await releaseVision()
            return engine.prepare(onProgress)
          },
          start: (options) => engine.start(options),
        }
      }),
  photo: () =>
    Promise.all([import('./vision/engine'), installGeoPriorLater()])
      .then(([module]) => pickEngine(module as Record<string, unknown>, ['createPhotoEngine', 'photoEngine', 'default'], isPhotoEngine, 'photo engine'))
      .then((engine): PhotoEngine => {
        visionLoaded = true
        return {
          prepare: async (onProgress) => {
            await releaseSound()
            return engine.prepare(onProgress)
          },
          identify: (image, options) => engine.identify(image, options),
        }
      }),
  live: () =>
    Promise.all([import('./vision/live'), installGeoPriorLater()])
      .then(([module]) => pickEngine(module as Record<string, unknown>, ['createLiveScanner', 'liveScanner', 'default'], isLiveScanner, 'live scanner'))
      .then((scanner) => {
        visionLoaded = true
        return scanner
      }),
}

/** Loads the location prior module (a small chunk of its own) and registers it. A failure to load it must not stop the engine. */
function installGeoPriorLater(): Promise<void> {
  return import('./vision/geoPrior').then(
    (module) => module.installGeoPrior(),
    (error: unknown) => console.warn('The location prior could not be loaded, identifying without it', error),
  )
}

/** The loaders of the fakes. The fakes are one small module, loaded once for all three; nothing from it is imported up front. */
export function fakeLoaders(choice: FakeChoice = {}): EngineLoaders {
  let fakes: Promise<Engines> | undefined
  const load = () =>
    (fakes ??= import('./fakes').then((module) =>
      module.createFakeEngines({ scenario: module.parseFakeScenario(choice.scenario), delayMs: choice.delayMs }),
    ))
  return {
    sound: () => load().then((engines) => engines.sound),
    photo: () => load().then((engines) => engines.photo),
    live: () => load().then((engines) => engines.live),
  }
}

export function createEngines(mode: EngineMode, fakeChoice: FakeChoice = {}): Engines {
  return buildEngines(mode === 'fake' ? fakeLoaders(fakeChoice) : realLoaders)
}

// ---------- The one set of engines ----------

let engines: Engines | undefined

/** The engines every screen shares. Which kind (real or fake) is decided the first time this is called. */
export function getEngines(): Engines {
  engines ??= createEngines(getEngineMode(), getFakeChoice())
  return engines
}

/** For tests: forget the engines, so the next getEngines() looks at the address and localStorage again. */
export function resetEngines(): void {
  engines = undefined
}
