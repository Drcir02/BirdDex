import { beforeEach, describe, expect, it } from 'vitest'
import type { Engines } from '../../src/domain/engines'
import type { ModelProgress } from '../../src/domain/types'
import {
  deriveReadiness,
  FAKE_BYTES,
  fakeBytesFor,
  IDLE_RUN,
  isFakePrepared,
  isRealDownload,
  markPrepared,
  modelFilesFor,
  prepareKind,
  resetFakePrepared,
  runReducer,
  summarizeStatus,
  type PrepareProgress,
  type ReadinessInput,
  type RunState,
  type StatusSummary,
} from '../../src/features/scan/modelReadiness'
import type { ModelFileStatus, ModelStoreStatus } from '../../src/ml/runtime/modelStore'

const MB = 1_000_000

function file(id: string, bytes: number, state: ModelFileStatus['state'], loadedBytes = state === 'ready' ? bytes : 0): ModelFileStatus {
  return { id, label: id, file: `${id}.bin`, bytes, state, loadedBytes }
}

function status(files: ModelFileStatus[], state: ModelStoreStatus['state'] = 'missing'): ModelStoreStatus {
  return { state, files, totalBytes: files.reduce((sum, f) => sum + f.bytes, 0), readyBytes: files.reduce((sum, f) => sum + f.loadedBytes, 0), persistent: true }
}

const ALL_MISSING = status([
  file('birdnet-fp16', 26 * MB, 'missing'),
  file('birdnet-geo-fp16', 15 * MB, 'missing'),
  file('wingclip-onnx', 14 * MB, 'missing'),
  file('wingclip-data', 25 * MB, 'missing'),
  file('wingclip-text', 8 * MB, 'missing'),
])

describe('modelFilesFor', () => {
  it('names the files of each engine; the live camera shares the photo model', () => {
    expect(modelFilesFor('sound')).toEqual(['birdnet-fp16', 'birdnet-geo-fp16'])
    expect(modelFilesFor('photo')).toEqual(['wingclip-onnx', 'wingclip-data', 'wingclip-text'])
    expect(modelFilesFor('live')).toEqual(modelFilesFor('photo'))
    expect(modelFilesFor('all')).toHaveLength(5)
  })
})

describe('summarizeStatus', () => {
  it('is unknown until the model store has answered', () => {
    expect(summarizeStatus(undefined, modelFilesFor('sound')).state).toBe('unknown')
  })

  it('counts only the files of the kind asked about', () => {
    const sound = summarizeStatus(ALL_MISSING, modelFilesFor('sound'))
    expect(sound).toMatchObject({ state: 'missing', totalBytes: 41 * MB, loadedBytes: 0, missingBytes: 41 * MB })
    const all = summarizeStatus(ALL_MISSING, modelFilesFor('all'))
    expect(all.totalBytes).toBe(88 * MB)
  })

  it('is ready when every file of the kind is on the phone, whatever the others do', () => {
    const half = status([
      file('birdnet-fp16', 26 * MB, 'ready'),
      file('birdnet-geo-fp16', 15 * MB, 'ready'),
      file('wingclip-onnx', 14 * MB, 'missing'),
      file('wingclip-data', 25 * MB, 'missing'),
      file('wingclip-text', 8 * MB, 'missing'),
    ])
    expect(summarizeStatus(half, modelFilesFor('sound')).state).toBe('ready')
    expect(summarizeStatus(half, modelFilesFor('photo')).state).toBe('missing')
    expect(summarizeStatus(half, modelFilesFor('all'))).toMatchObject({ state: 'missing', missingBytes: 47 * MB, loadedBytes: 41 * MB })
  })

  it('is downloading while a file of the kind is coming in, with the bytes that arrived so far', () => {
    const running = status([file('birdnet-fp16', 26 * MB, 'downloading', 10 * MB), file('birdnet-geo-fp16', 15 * MB, 'missing')])
    expect(summarizeStatus(running, modelFilesFor('sound'))).toMatchObject({ state: 'downloading', loadedBytes: 10 * MB, totalBytes: 41 * MB })
  })

  it('treats a failed file as missing, so the person can try again', () => {
    const failed = status([file('birdnet-fp16', 26 * MB, 'failed'), file('birdnet-geo-fp16', 15 * MB, 'ready')])
    expect(summarizeStatus(failed, modelFilesFor('sound'))).toMatchObject({ state: 'missing', missingBytes: 26 * MB })
  })

  it('is unavailable when the list of models cannot be read, or has none of these files', () => {
    const broken: ModelStoreStatus = { state: 'unavailable', files: [], totalBytes: 0, readyBytes: 0, persistent: true }
    expect(summarizeStatus(broken, modelFilesFor('sound')).state).toBe('unavailable')
    expect(summarizeStatus(status([file('other', MB, 'ready')]), modelFilesFor('sound')).state).toBe('unavailable')
  })
})

describe('runReducer', () => {
  it('starts running, with the size the download will have when it is known', () => {
    expect(runReducer(IDLE_RUN, { type: 'start' })).toMatchObject({ run: 'running', stage: 'preparing', loadedBytes: 0 })
    expect(runReducer(IDLE_RUN, { type: 'start', downloading: true, totalBytes: 90 * MB })).toMatchObject({ run: 'running', stage: 'downloading', totalBytes: 90 * MB })
  })

  it('follows the progress of a run, and ignores progress when no run is going on', () => {
    const progress: PrepareProgress = { stage: 'downloading', loadedBytes: 5, totalBytes: 10 }
    expect(runReducer(IDLE_RUN, { type: 'progress', ...progress })).toBe(IDLE_RUN)
    const running = runReducer(IDLE_RUN, { type: 'start' })
    expect(runReducer(running, { type: 'progress', ...progress })).toMatchObject({ run: 'running', stage: 'downloading', loadedBytes: 5, totalBytes: 10 })
  })

  it('ends done or failed, and can start again after a failure', () => {
    const running = runReducer(runReducer(IDLE_RUN, { type: 'start' }), { type: 'progress', stage: 'downloading', loadedBytes: 5, totalBytes: 10 })
    expect(runReducer(running, { type: 'done' })).toMatchObject({ run: 'done', loadedBytes: 10 })
    const failed = runReducer(running, { type: 'failed', error: 'network' })
    expect(failed).toMatchObject({ run: 'failed', error: 'network', totalBytes: 10 })
    expect(runReducer(failed, { type: 'start' })).toMatchObject({ run: 'running', loadedBytes: 0, totalBytes: 10 })
    expect(runReducer(failed, { type: 'reset' })).toBe(IDLE_RUN)
  })
})

describe('deriveReadiness', () => {
  const summary = (overrides: Partial<StatusSummary>): StatusSummary => ({ state: 'ready', totalBytes: 90 * MB, loadedBytes: 90 * MB, missingBytes: 0, ...overrides })
  const input = (overrides: Partial<ReadinessInput>): ReadinessInput => ({
    run: IDLE_RUN,
    summary: summary({}),
    fake: false,
    fakePrepared: false,
    fakeBytes: 90 * MB,
    autoPrepare: true,
    ...overrides,
  })

  it('looks at the phone first', () => {
    expect(deriveReadiness(input({ summary: summary({ state: 'unknown' }) })).phase).toBe('checking')
  })

  it('offers the download when files are missing, and says how much it is', () => {
    const view = deriveReadiness(input({ summary: summary({ state: 'missing', missingBytes: 41 * MB, totalBytes: 41 * MB, loadedBytes: 0 }) }))
    expect(view).toMatchObject({ phase: 'needed', needBytes: 41 * MB, startNow: false })
  })

  it('shows the progress of a download that another screen started, and takes over when it is done', () => {
    const view = deriveReadiness(input({ summary: summary({ state: 'downloading', loadedBytes: 20 * MB, totalBytes: 80 * MB, missingBytes: 60 * MB }) }))
    expect(view).toMatchObject({ phase: 'working', stage: 'downloading', fraction: 0.25 })
  })

  it('starts the engine by itself when the files are here and the screen wants it', () => {
    expect(deriveReadiness(input({ autoPrepare: true }))).toMatchObject({ phase: 'working', stage: 'preparing', startNow: true })
  })

  it('only says "ready" for the hub, which does not start engines', () => {
    expect(deriveReadiness(input({ autoPrepare: false }))).toMatchObject({ phase: 'ready', startNow: false })
  })

  it('reports an unreadable model list as a download problem', () => {
    expect(deriveReadiness(input({ summary: summary({ state: 'unavailable' }) }))).toMatchObject({ phase: 'error', error: 'modelDownload' })
  })

  it('shows its own run in preference to what the store says', () => {
    const running: RunState = { run: 'running', stage: 'downloading', loadedBytes: 30 * MB, totalBytes: 60 * MB }
    const view = deriveReadiness(input({ run: running, summary: summary({ state: 'missing' }) }))
    expect(view).toMatchObject({ phase: 'working', stage: 'downloading', fraction: 0.5, loadedBytes: 30 * MB, totalBytes: 60 * MB })
    expect(deriveReadiness(input({ run: { ...IDLE_RUN, run: 'done', totalBytes: 60 * MB }, summary: summary({ state: 'missing' }) })).phase).toBe('ready')
    expect(deriveReadiness(input({ run: { ...IDLE_RUN, run: 'failed', error: 'network' } }))).toMatchObject({ phase: 'error', error: 'network' })
  })

  it('never starts again by itself after a failure (that would loop); the person presses "try again"', () => {
    const view = deriveReadiness(input({ run: { ...IDLE_RUN, run: 'failed', error: 'modelLoad' } }))
    expect(view.startNow).toBe(false)
  })

  it('keeps the fraction between 0 and 1 even for odd numbers', () => {
    expect(deriveReadiness(input({ run: { run: 'running', stage: 'downloading', loadedBytes: 99, totalBytes: 10 } })).fraction).toBe(1)
    expect(deriveReadiness(input({ run: { run: 'running', stage: 'downloading', loadedBytes: 5, totalBytes: 0 } })).fraction).toBe(0)
  })

  describe('with fake engines', () => {
    it('does not look at the model store: the pretend download is needed until it was done once', () => {
      const first = deriveReadiness(input({ fake: true, fakePrepared: false, summary: summary({ state: 'ready' }) }))
      expect(first).toMatchObject({ phase: 'needed', needBytes: 90 * MB })
      const later = deriveReadiness(input({ fake: true, fakePrepared: true, summary: summary({ state: 'missing' }) }))
      expect(later).toMatchObject({ phase: 'working', stage: 'preparing', startNow: true })
    })
  })
})

describe('the memory of the fake engines', () => {
  beforeEach(() => resetFakePrepared())

  it('remembers what was prepared, per engine', () => {
    expect(isFakePrepared('sound')).toBe(false)
    markPrepared('sound')
    expect(isFakePrepared('sound')).toBe(true)
    expect(isFakePrepared('photo')).toBe(false)
    expect(isFakePrepared('all')).toBe(false)
    markPrepared('live')
    expect(isFakePrepared('photo')).toBe(true)
    expect(isFakePrepared('live')).toBe(true)
    expect(isFakePrepared('all')).toBe(true)
  })

  it('pretends to download the size of the real files', () => {
    expect(fakeBytesFor('sound')).toBe(FAKE_BYTES.sound)
    expect(fakeBytesFor('live')).toBe(FAKE_BYTES.photo)
    expect(fakeBytesFor('all')).toBe(FAKE_BYTES.sound + FAKE_BYTES.photo)
    expect(Math.round(fakeBytesFor('all') / MB)).toBe(89)
  })
})

describe('isRealDownload', () => {
  it('is true only when bytes were still to come', () => {
    expect(isRealDownload({ stage: 'downloading', loadedBytes: 0, totalBytes: 10 })).toBe(true)
    expect(isRealDownload({ stage: 'downloading', loadedBytes: 10, totalBytes: 10 })).toBe(false)
    expect(isRealDownload({ stage: 'preparing', loadedBytes: 0, totalBytes: 10 })).toBe(false)
    expect(isRealDownload({ stage: 'downloading', loadedBytes: 0, totalBytes: 0 })).toBe(false)
  })
})

describe('prepareKind', () => {
  function stubEngines() {
    const calls: string[] = []
    const engines: Pick<Engines, 'sound' | 'photo'> = {
      sound: {
        prepare: async (onProgress) => {
          calls.push('sound')
          const report = (stage: ModelProgress['stage'], loadedBytes: number) => onProgress?.({ modelId: 'birdnet', stage, loadedBytes, totalBytes: 40 })
          report('downloading', 0)
          report('downloading', 20)
          report('downloading', 40)
          report('preparing', 40)
          report('ready', 40)
        },
        start: () => Promise.reject(new Error('not used')),
      },
      photo: {
        prepare: async (onProgress) => {
          calls.push('photo')
          const report = (stage: ModelProgress['stage'], loadedBytes: number) => onProgress?.({ modelId: 'wingclip', stage, loadedBytes, totalBytes: 50 })
          report('downloading', 0)
          report('downloading', 25)
          report('downloading', 50)
          report('ready', 50)
        },
        identify: () => Promise.reject(new Error('not used')),
      },
    }
    return { engines, calls }
  }

  const totals = { sound: 40, photo: 50 }

  it('prepares the sound engine for the sound screen, with its own progress', async () => {
    const { engines, calls } = stubEngines()
    const seen: PrepareProgress[] = []
    await prepareKind('sound', engines, (p) => seen.push(p), totals)
    expect(calls).toEqual(['sound'])
    expect(seen[0]).toEqual({ stage: 'downloading', loadedBytes: 0, totalBytes: 40 })
    expect(seen.at(-1)).toEqual({ stage: 'preparing', loadedBytes: 40, totalBytes: 40 })
  })

  it('prepares the photo engine for the photo and the live screen', async () => {
    for (const kind of ['photo', 'live'] as const) {
      const { engines, calls } = stubEngines()
      await prepareKind(kind, engines, () => undefined, totals)
      expect(calls).toEqual(['photo'])
    }
  })

  it('prepares both for the hub, one after the other, with one bar for all of it', async () => {
    const { engines, calls } = stubEngines()
    const seen: PrepareProgress[] = []
    await prepareKind('all', engines, (p) => seen.push(p), totals)
    expect(calls).toEqual(['sound', 'photo'])
    expect(seen.every((p) => p.totalBytes === 90)).toBe(true)
    const downloading = seen.filter((p) => p.stage === 'downloading').map((p) => p.loadedBytes)
    // 0, 20, 40 for the sound model, then 40 + 0, 40 + 25, 40 + 50 for the photo model: never backwards.
    expect(downloading).toEqual([0, 20, 40, 40, 65, 90])
    expect([...downloading].sort((a, b) => a - b)).toEqual(downloading)
  })

  it('passes a failure on, so the screen can say what went wrong', async () => {
    const { engines } = stubEngines()
    engines.sound.prepare = () => Promise.reject(new Error('no network'))
    await expect(prepareKind('all', engines, () => undefined, totals)).rejects.toThrow('no network')
  })
})
