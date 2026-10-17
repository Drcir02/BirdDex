import { beforeEach, describe, expect, it, vi } from 'vitest'

// BirdNET and WingCLIP must not be in memory together: preparing one engine gives the other one's model back first.
// The engine modules are replaced by stand-ins that write down what happens.

const log: string[] = []
const soundDispose = vi.fn(async () => {
  log.push('sound.dispose')
})
const visionDispose = vi.fn(async () => {
  log.push('vision.dispose')
})

vi.mock('../../src/ml/sound/engine', () => ({
  createSoundEngine: () => ({
    prepare: async () => void log.push('sound.prepare'),
    start: (options: unknown) => {
      log.push('sound.start')
      return Promise.resolve(options)
    },
    dispose: soundDispose,
  }),
}))
vi.mock('../../src/ml/vision/engine', () => ({
  createPhotoEngine: () => ({
    prepare: async () => void log.push('photo.prepare'),
    identify: async () => {
      log.push('photo.identify')
      return { candidates: [], pBird: 0 }
    },
  }),
}))
vi.mock('../../src/ml/vision/live', () => ({ createLiveScanner: () => ({ start: async () => ({ stop() {}, snapshot: async () => new Blob() }) }) }))
vi.mock('../../src/ml/vision/geoPrior', () => ({ installGeoPrior: () => undefined }))
vi.mock('../../src/ml/vision/runtime', () => ({ getVisionRuntime: () => ({ dispose: visionDispose }) }))

beforeEach(() => {
  log.length = 0
  vi.resetModules()
  soundDispose.mockClear()
  visionDispose.mockClear()
})

async function load() {
  const { createEngines } = await import('../../src/ml/engines')
  return createEngines('real')
}

describe('one big model at a time', () => {
  it('lets go of the sound model before the photo model is prepared', async () => {
    const engines = await load()
    await engines.sound.prepare()
    await engines.photo.prepare()
    expect(log).toEqual(['sound.prepare', 'sound.dispose', 'photo.prepare'])
  })

  it('lets go of the photo model before the sound model is prepared, but only when it was ever loaded', async () => {
    const engines = await load()
    await engines.sound.prepare()
    expect(visionDispose).not.toHaveBeenCalled()
    await engines.photo.prepare()
    await engines.sound.prepare()
    expect(log).toEqual(['sound.prepare', 'sound.dispose', 'photo.prepare', 'vision.dispose', 'sound.prepare'])
  })

  it('never touches the other model on start() or identify(): a scan is not interrupted, and start() stays inside the tap', async () => {
    const engines = await load()
    await engines.sound.prepare()
    await engines.photo.prepare()
    log.length = 0
    await engines.photo.identify({} as unknown as HTMLCanvasElement)
    const options = { onUpdate: () => undefined }
    await engines.sound.start(options)
    expect(log).toEqual(['photo.identify', 'sound.start'])
  })

  it('keeps going when freeing the other model fails', async () => {
    soundDispose.mockRejectedValueOnce(new Error('already gone'))
    const engines = await load()
    await engines.sound.prepare()
    await expect(engines.photo.prepare()).resolves.toBeUndefined()
    expect(log).toContain('photo.prepare')
  })
})
