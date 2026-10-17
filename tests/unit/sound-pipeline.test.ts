import { describe, expect, it, vi } from 'vitest'
import type { SoundUpdate } from '../../src/domain/engines'
import { meterPosition } from '../../src/ml/audio/loudness'
import { decodeWav } from '../../src/ml/audio/wav'
import type { WindowScores } from '../../src/ml/sound/aggregate'
import { SoundPipeline, type PipelineOptions, type WindowInfo } from '../../src/ml/sound/pipeline'

const RATE = 48000

/** Audio whose sample value tells its position (position / 1e7), so any cut of it can be checked exactly. */
function timeline(seconds: number, from = 0): Float32Array {
  return Float32Array.from({ length: Math.round(seconds * RATE) }, (_, i) => (from + i) / 1e7)
}

const tick = () => new Promise<void>((resolve) => setImmediate(resolve))

/** Pushes audio block by block like the microphone does, letting the pipeline's async work run between blocks. */
async function feed(pipeline: SoundPipeline, samples: Float32Array, options: { block?: number; rate?: number; rms?: number } = {}): Promise<void> {
  const block = options.block ?? 2048
  for (let at = 0; at < samples.length; at += block) {
    pipeline.push(samples.subarray(at, at + block), options.rms ?? 0.05, 0.2, options.rate ?? RATE)
    await tick()
  }
}

type Script = Array<Array<[string, number]>> | ((index: number, end: number) => Array<[string, number]>)

function harness(script: Script = [], extra: Partial<PipelineOptions> = {}) {
  const updates: SoundUpdate[] = []
  const windows: WindowInfo[] = []
  const seen: Array<{ end: number; first: number; length: number }> = []
  const errors: unknown[] = []
  let clock = 0
  let index = 0
  const pipeline = new SoundPipeline({
    analyse: async (window, end) => {
      seen.push({ end, first: window[0], length: window.length })
      const entries = typeof script === 'function' ? script(index, end) : (script[index] ?? [])
      index++
      return { end, top: entries.map(([speciesId, confidence]) => ({ speciesId, confidence })) } satisfies WindowScores
    },
    onUpdate: (update) => updates.push(update),
    onWindow: (info) => windows.push(info),
    onError: (error) => errors.push(error),
    now: () => (clock += 43),
    levelIntervalMs: 0, // tell the screen after every block, so the tests see every change
    ...extra,
  })
  return { pipeline, updates, windows, seen, errors }
}

describe('SoundPipeline: windows', () => {
  it('analyses the first 3 seconds after 3 seconds, then a new window every second, each the right cut of the audio', async () => {
    const { pipeline, seen } = harness()
    await feed(pipeline, timeline(10))
    expect(seen.map((window) => window.end / RATE)).toEqual([3, 4, 5, 6, 7, 8, 9, 10])
    for (const window of seen) {
      expect(window.length).toBe(144000)
      expect(window.first).toBeCloseTo((window.end - 144000) / 1e7, 6) // the window starts 3 seconds before its end (float32 precision)
    }
    expect(pipeline.capturedSeconds).toBeCloseTo(10, 1)
  })

  it('does not start before there are 3 seconds', async () => {
    const { pipeline, seen, updates } = harness()
    await feed(pipeline, timeline(2.9))
    expect(seen).toHaveLength(0)
    expect(updates.every((update) => update.analysedSeconds === 0 && update.candidates.length === 0)).toBe(true)
  })

  it('analyses one window at a time and skips the ones it missed when the model is slow', async () => {
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => (release = resolve))
    const seen: number[] = []
    const infos: WindowInfo[] = []
    const pipeline = new SoundPipeline({
      analyse: async (_window, end) => {
        seen.push(end)
        if (seen.length === 1) await gate // the first window takes "forever"
        return { end, top: [] }
      },
      onUpdate: () => undefined,
      onWindow: (info) => infos.push(info),
    })
    await feed(pipeline, timeline(8.5)) // windows ending at 3, 4, 5, 6, 7, 8 seconds come due while the first one is stuck
    expect(seen).toEqual([3 * RATE]) // nothing else started in the meantime
    release!()
    await tick()
    await tick()
    // It went on with the newest window, the one ending at 8 seconds, and counted the four it passed over.
    expect(seen).toEqual([3 * RATE, 8 * RATE])
    expect(infos.map((info) => info.skipped)).toEqual([0, 4])
  })

  it('takes audio at other sample rates and converts it to 48 kHz', async () => {
    const { pipeline, seen } = harness()
    const tone = Float32Array.from({ length: 44100 * 5 }, (_, i) => 0.3 * Math.sin((2 * Math.PI * 1000 * i) / 44100))
    await feed(pipeline, tone, { rate: 44100 })
    expect(pipeline.capturedSeconds).toBeGreaterThan(4.95)
    expect(pipeline.capturedSeconds).toBeLessThan(5.01)
    expect(seen.map((window) => window.length)).toEqual([144000, 144000]) // windows ending at 3 and 4 seconds
    expect(seen[0].end).toBe(144000)
  })

  it('ignores empty blocks', async () => {
    const { pipeline, seen } = harness()
    pipeline.push(new Float32Array(0), 0, 0, RATE)
    await feed(pipeline, timeline(3))
    expect(seen).toHaveLength(1)
  })
})

describe('SoundPipeline: what the screen is told', () => {
  it('shows nothing until two windows agree, then the bird with the mean of its two best windows', async () => {
    const { pipeline, updates } = harness([[['a', 0.9]], [['a', 0.7]], [['a', 0.8]]])
    await feed(pipeline, timeline(6.2))
    const withBird = updates.filter((update) => update.candidates.length > 0)
    expect(updates[0].candidates).toEqual([])
    expect(withBird[0].candidates).toEqual([{ speciesId: 'a', confidence: expect.closeTo(0.8, 10) }]) // (0.9 + 0.7) / 2 after window 2
    expect(updates.at(-1)!.candidates[0].confidence).toBeCloseTo(0.85, 10) // after window 3: the best two are 0.9 and 0.8
  })

  it('says how much audio has been analysed and whether it hears a bird', async () => {
    const { pipeline, updates } = harness([[['a', 0.9]], [['a', 0.1]], []])
    await feed(pipeline, timeline(6.3))
    const analysed = updates.map((update) => update.analysedSeconds)
    expect(Math.min(...analysed)).toBe(0)
    expect(Math.max(...analysed)).toBe(6) // windows ended at 3, 4, 5 and 6 seconds
    const afterFirst = updates.find((update) => update.analysedSeconds === 3)!
    expect(afterFirst.hearingBird).toBe(true)
    const afterSecond = updates.find((update) => update.analysedSeconds === 4)!
    expect(afterSecond.hearingBird).toBe(false) // the newest window only scored 0.1
  })

  it('reuses the same candidates array until a window changes them (cheap for the screen to compare)', async () => {
    const { pipeline, updates } = harness([[['a', 0.9]], [['a', 0.9]]])
    await feed(pipeline, timeline(4.5))
    const last = updates.slice(-5)
    expect(new Set(last.map((update) => update.candidates)).size).toBe(1)
  })

  it('follows the loudness of the microphone, rising at once and falling gently', async () => {
    const { pipeline, updates } = harness()
    pipeline.push(new Float32Array(2048), 0.2, 0.5, RATE)
    pipeline.push(new Float32Array(2048), 0, 0, RATE)
    await tick()
    expect(updates[0].level).toBeCloseTo(meterPosition(0.2), 6)
    const quiet = updates.at(-1)!.level
    expect(quiet).toBeLessThan(updates[0].level)
    expect(quiet).toBeGreaterThan(0)
    for (const update of updates) {
      expect(update.level).toBeGreaterThanOrEqual(0)
      expect(update.level).toBeLessThanOrEqual(1)
    }
  })

  it('does not flood the screen with level updates (50 ms apart at most)', async () => {
    let clock = 0
    const updates: SoundUpdate[] = []
    const pipeline = new SoundPipeline({ analyse: async (_w, end) => ({ end, top: [] }), onUpdate: (u) => updates.push(u), now: () => clock })
    for (let block = 0; block < 100; block++) {
      clock += 10 // blocks arrive every 10 ms
      pipeline.push(new Float32Array(480), 0.1, 0.1, RATE)
    }
    expect(updates.length).toBeGreaterThan(15)
    expect(updates.length).toBeLessThanOrEqual(21) // 1 second at one update per 50 ms
  })
})

describe('SoundPipeline: a screen that fails', () => {
  it('does not stop the listening when the update handler throws', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const seen: number[] = []
    const pipeline = new SoundPipeline({
      analyse: async (_window, end) => {
        seen.push(end)
        return { end, top: [{ speciesId: 'a', confidence: 0.9 }] }
      },
      onUpdate: () => {
        throw new Error('bug in the screen')
      },
      levelIntervalMs: 0,
    })
    await feed(pipeline, timeline(5.5))
    expect(seen.length).toBeGreaterThanOrEqual(3) // windows at 3, 4 and 5 seconds were still analysed
    expect((await pipeline.finish()).candidates[0].speciesId).toBe('a')
    expect(error).toHaveBeenCalled()
    error.mockRestore()
  })
})

describe('SoundPipeline: the result', () => {
  it('gives the best guesses and a WAV clip around the strongest window', async () => {
    // The bird is loudest in the window that ends at 6 seconds (the fourth window).
    const { pipeline } = harness([[['a', 0.5]], [['a', 0.6]], [['a', 0.7]], [['a', 0.9]], [['a', 0.6]], [['a', 0.5]], [['a', 0.5]]])
    await feed(pipeline, timeline(10))
    const result = await pipeline.finish()

    expect(result.candidates[0].speciesId).toBe('a')
    expect(result.candidates[0].confidence).toBeCloseTo(0.8, 10) // (0.9 + 0.7) / 2, the best moment
    // The clip: 4.5 seconds before the end of the window that scored 0.9 (6 s) and 1.5 seconds after = 1.5 s to 7.5 s.
    expect(result.clipSeconds).toBeCloseTo(6, 6)
    const wav = decodeWav(new Uint8Array(await result.clip!.arrayBuffer()))
    expect(wav.sampleRate).toBe(RATE)
    expect(wav.channels).toBe(1)
    expect(wav.samples.length).toBe(6 * RATE)
    expect(wav.samples[0]).toBeCloseTo((1.5 * RATE) / 1e7, 4)
    expect(wav.samples.at(-1)).toBeCloseTo((7.5 * RATE - 1) / 1e7, 4)
  })

  it('keeps the clip of an early best moment even when the ring has long forgotten that audio', async () => {
    // The strong detection is early (window ending at 4 s); then 36 more seconds of nothing special.
    const script: Script = (index) => (index <= 1 ? [['a', 0.9]] : [])
    const { pipeline } = harness(script)
    await feed(pipeline, timeline(40))
    const result = await pipeline.finish()
    expect(result.candidates[0].speciesId).toBe('a')
    const wav = decodeWav(new Uint8Array(await result.clip!.arrayBuffer()))
    // Window ends at 3 s and 4 s scored 0.9; the best is the first of them, so the clip is 0 s to 4.5 s (it cannot start before 0).
    expect(wav.samples[0]).toBeCloseTo(0, 4)
    expect(wav.samples.length / RATE).toBeLessThan(6.01)
    expect(wav.samples[10]).toBeCloseTo(10 / 1e7, 4)
  })

  it('has fewer seconds of clip when the scan ends right after the best moment', async () => {
    const { pipeline } = harness([[['a', 0.9]], [['a', 0.9]]])
    await feed(pipeline, timeline(4.2))
    const result = await pipeline.finish()
    expect(result.clipSeconds!).toBeLessThanOrEqual(6)
    expect(result.clipSeconds!).toBeGreaterThan(3)
  })

  it('analyses a last window on stop when half a second or more has arrived since the last one', async () => {
    const { pipeline, seen } = harness([[['a', 0.9]], [['a', 0.9]]])
    await feed(pipeline, timeline(3.6)) // one window so far, at 3 s
    expect(seen).toHaveLength(1)
    const result = await pipeline.finish()
    expect(seen).toHaveLength(2) // the last look, at 3.6 s
    expect(seen[1].end).toBe(Math.round(3.6 * RATE))
    expect(result.candidates[0].speciesId).toBe('a') // now two windows agree
  })

  it('does not analyse a last window when almost nothing is new', async () => {
    const { pipeline, seen } = harness()
    await feed(pipeline, timeline(4.3))
    const before = seen.length
    await pipeline.finish()
    expect(seen).toHaveLength(before)
  })

  it('waits for the window that is being analysed', async () => {
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => (release = resolve))
    const pipeline = new SoundPipeline({
      analyse: async (_window, end) => {
        await gate
        return { end, top: [{ speciesId: 'a', confidence: 0.9 }] }
      },
      onUpdate: () => undefined,
    })
    await feed(pipeline, timeline(3.2))
    let done = false
    const finished = pipeline.finish().then((result) => {
      done = true
      return result
    })
    await tick()
    expect(done).toBe(false)
    release!()
    const result = await finished
    expect(result.candidates.length).toBeGreaterThanOrEqual(0)
    expect(done).toBe(true)
  })

  it('gives no candidates and the newest audio as a clip when nothing was heard', async () => {
    const { pipeline } = harness()
    await feed(pipeline, timeline(8))
    const result = await pipeline.finish()
    expect(result.candidates).toEqual([])
    expect(result.clipSeconds).toBeCloseTo(6, 6)
    const wav = decodeWav(new Uint8Array(await result.clip!.arrayBuffer()))
    expect(wav.samples[0]).toBeCloseTo((2 * RATE) / 1e7, 4) // the last 6 of 8 seconds
  })

  it('gives no clip when less than a second was recorded', async () => {
    const { pipeline } = harness()
    await feed(pipeline, timeline(0.8))
    expect(await pipeline.finish()).toEqual({ candidates: [] })
  })

  it('answers the same every time, and ignores audio and updates after it was asked to finish', async () => {
    const { pipeline, updates, seen } = harness([[['a', 0.9]], [['a', 0.9]]])
    await feed(pipeline, timeline(5))
    const first = pipeline.finish()
    const count = updates.length
    pipeline.push(timeline(2), 0.5, 0.5, RATE)
    await tick()
    expect(await pipeline.finish()).toBe(await first)
    expect(updates.length).toBe(count)
    expect(seen.length).toBeLessThanOrEqual(4)
  })
})

describe('SoundPipeline: when analysis fails', () => {
  it('reports the failure, tries the next window, and gives up after three in a row', async () => {
    const attempts: number[] = []
    const errors: unknown[] = []
    const pipeline = new SoundPipeline({
      analyse: async (_window, end) => {
        attempts.push(end)
        throw new Error(`broken at ${end}`)
      },
      onUpdate: () => undefined,
      onError: (error) => errors.push(error),
    })
    await feed(pipeline, timeline(10))
    expect(attempts).toHaveLength(3) // 3 s, 4 s, 5 s; after that it stops trying
    expect(errors).toHaveLength(3)
    const result = await pipeline.finish()
    expect(result.candidates).toEqual([])
    expect(result.clip).toBeDefined() // the recording is still returned
  })

  it('forgets earlier failures after a success', async () => {
    let calls = 0
    const errors: unknown[] = []
    const pipeline = new SoundPipeline({
      analyse: async (_window, end) => {
        calls++
        if (calls % 2 === 1) throw new Error('every other time')
        return { end, top: [] }
      },
      onUpdate: () => undefined,
      onError: (error) => errors.push(error),
    })
    await feed(pipeline, timeline(9))
    expect(calls).toBe(7) // never three failures in a row, so it keeps going
    expect(errors).toHaveLength(4)
  })
})

describe('SoundPipeline with a real clock', () => {
  it('uses performance.now by default', async () => {
    const spy = vi.spyOn(performance, 'now')
    const pipeline = new SoundPipeline({ analyse: async (_w, end) => ({ end, top: [] }), onUpdate: () => undefined })
    pipeline.push(new Float32Array(100), 0.1, 0.1, RATE)
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })
})
