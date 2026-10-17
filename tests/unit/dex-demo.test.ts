import 'fake-indexeddb/auto'
import { readFileSync } from 'node:fs'
import { Blob as NodeBlob } from 'node:buffer'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { addCatch, countCatches, deleteAllCatches, getDb, getMedia, listCatches } from '../../src/db'
import { parseSpecies } from '../../src/data/species'
import type { Species } from '../../src/domain/types'
import { clearDemoData, countDemoCatches, demoCatchIds, seedDemoData, type DemoMediaMaker } from '../../src/features/dex/demo/demoData'
import { DEMO_CATCH_COUNT, DEMO_ID_PREFIX, buildDemoPlan, isDemoId, seededRandom } from '../../src/features/dex/demo/demoPlan'
import { DEMO_CLIP_RATE, DEMO_CLIP_SECONDS, makeDemoClip, makeDemoSamples } from '../../src/features/dex/demo/demoMedia'
import { decodeWav } from '../../src/ml/audio/wav'

// fake-indexeddb copies the Blob of the test environment as an empty object, so the database tests use Node's own Blob.
beforeAll(() => {
  vi.stubGlobal('Blob', NodeBlob)
})

const list = parseSpecies(JSON.parse(readFileSync('public/data/species.json', 'utf8')) as unknown)
const NOW = Date.UTC(2026, 9, 17, 12, 0, 0)

describe('the demo plan', () => {
  const plan = buildDemoPlan(list, NOW)

  it('has 30 catches with unique demo ids', () => {
    expect(plan).toHaveLength(DEMO_CATCH_COUNT)
    expect(new Set(plan.map((entry) => entry.id)).size).toBe(30)
    expect(plan.every((entry) => entry.id.startsWith(DEMO_ID_PREFIX) && isDemoId(entry.id))).toBe(true)
    expect(plan[0].id).toBe('demo-01')
    expect(plan[29].id).toBe('demo-30')
  })

  it('uses only birds of the Dex, 24 different ones, six of them caught twice or more', () => {
    const known = new Set(list.map((species) => species.id))
    expect(plan.every((entry) => known.has(entry.speciesId))).toBe(true)
    const counts = new Map<string, number>()
    for (const entry of plan) counts.set(entry.speciesId, (counts.get(entry.speciesId) ?? 0) + 1)
    expect(counts.size).toBe(24)
    expect([...counts.values()].filter((count) => count > 1).length).toBe(5)
    expect(counts.get('parus-major')).toBe(3)
  })

  it('mixes the ways of catching, the rarities and Czech and non-Czech birds', () => {
    expect(new Set(plan.map((entry) => entry.method))).toEqual(new Set(['sound', 'photo', 'live']))
    const bySpecies = new Map(list.map((species) => [species.id, species]))
    const rarities = new Set(plan.map((entry) => bySpecies.get(entry.speciesId)?.rarity))
    expect(rarities.size).toBeGreaterThanOrEqual(4)
    expect(plan.some((entry) => !bySpecies.get(entry.speciesId)?.inCzechia)).toBe(true)
    // Owls are heard, not photographed.
    expect(plan.filter((entry) => ['bubo-bubo', 'strix-aluco'].includes(entry.speciesId)).every((entry) => entry.method === 'sound')).toBe(true)
  })

  it('has sound catches with a recording and the others with a picture, except two without anything', () => {
    for (const entry of plan) {
      if (entry.media === 'audio') expect(entry.method).toBe('sound')
      if (entry.media === 'image') expect(entry.method).not.toBe('sound')
    }
    expect(plan.filter((entry) => entry.media === 'none')).toHaveLength(2)
  })

  it('has places with names, places with coordinates only and catches with no place', () => {
    expect(plan.filter((entry) => entry.placeName && entry.location).length).toBeGreaterThan(10)
    expect(plan.filter((entry) => !entry.placeName && entry.location).length).toBeGreaterThan(3)
    expect(plan.filter((entry) => !entry.location).length).toBeGreaterThan(2)
    for (const entry of plan) {
      if (entry.location) {
        expect(Math.abs(entry.location.lat)).toBeLessThanOrEqual(90)
        expect(Math.abs(entry.location.lon)).toBeLessThanOrEqual(180)
      }
    }
  })

  it('spreads the catches over the last weeks, none in the future, with sensible confidences', () => {
    for (const entry of plan) {
      expect(entry.caughtAt).toBeLessThan(NOW)
      expect(entry.caughtAt).toBeGreaterThan(NOW - 100 * 24 * 3600 * 1000)
      expect(entry.confidence).toBeGreaterThanOrEqual(0.6)
      expect(entry.confidence).toBeLessThanOrEqual(0.97)
    }
    expect(Math.min(...plan.map((entry) => entry.caughtAt))).toBeLessThan(NOW - 14 * 24 * 3600 * 1000)
    expect(plan.filter((entry) => entry.note)).toHaveLength(4)
  })

  it('is the same every time for the same input', () => {
    expect(buildDemoPlan(list, NOW)).toEqual(plan)
    expect(buildDemoPlan(list, NOW + 1000)[0].caughtAt).toBe(plan[0].caughtAt + 1000)
  })

  it('still gives 30 catches for a short list of other birds', () => {
    const small: Species[] = list.slice(100, 106)
    const smallPlan = buildDemoPlan(small, NOW)
    expect(smallPlan).toHaveLength(30)
    expect(smallPlan.every((entry) => small.some((species) => species.id === entry.speciesId))).toBe(true)
    expect(buildDemoPlan([], NOW)).toEqual([])
  })

  it('has a repeatable random generator', () => {
    const a = seededRandom(7)
    const b = seededRandom(7)
    expect([a(), a(), a()]).toEqual([b(), b(), b()])
    expect(seededRandom(8)()).not.toBe(seededRandom(7)())
    const value = seededRandom(1)()
    expect(value).toBeGreaterThanOrEqual(0)
    expect(value).toBeLessThan(1)
  })
})

describe('the demo sounds', () => {
  it('make a short WAV that decodes, is not silent and does not clip', () => {
    const { blob, durationS } = makeDemoClip(1000)
    expect(durationS).toBe(DEMO_CLIP_SECONDS)
    expect(blob.type).toBe('audio/wav')
    const samples = makeDemoSamples(1000)
    expect(samples).toHaveLength(Math.round(DEMO_CLIP_RATE * DEMO_CLIP_SECONDS))
    const peak = samples.reduce((max, value) => Math.max(max, Math.abs(value)), 0)
    expect(peak).toBeGreaterThan(0.3)
    expect(peak).toBeLessThanOrEqual(1)
  })

  it('sound different for different seeds and identical for the same seed', () => {
    expect(makeDemoSamples(1000)).toEqual(makeDemoSamples(1000))
    expect(makeDemoSamples(1000)).not.toEqual(makeDemoSamples(1037))
  })

  it('end up as a valid file for the player', async () => {
    const { blob } = makeDemoClip(1111)
    const decoded = decodeWav(new Uint8Array(await blob.arrayBuffer()))
    expect(decoded.sampleRate).toBe(DEMO_CLIP_RATE)
    expect(decoded.seconds).toBeCloseTo(DEMO_CLIP_SECONDS, 2)
  })
})

describe('seeding and clearing the demo catches', () => {
  const maker: DemoMediaMaker = {
    image: async () => new Blob([new Uint8Array(40)], { type: 'image/jpeg' }),
    clip: () => ({ blob: new Blob([new Uint8Array(60)], { type: 'audio/wav' }), durationS: 2.4 }),
  }

  beforeEach(async () => {
    await deleteAllCatches()
  })
  afterEach(async () => {
    await deleteAllCatches()
  })

  it('adds 30 catches with their pictures and recordings, and counts them', async () => {
    const progress: Array<[number, number]> = []
    const result = await seedDemoData({ species: list, now: NOW, media: maker, onProgress: (done, total) => progress.push([done, total]) })
    expect(result).toEqual({ added: 30, kept: 0 })
    expect(await countDemoCatches()).toBe(30)
    expect(await countCatches()).toBe(30)
    expect(progress.at(-1)).toEqual([30, 30])

    const catches = await listCatches()
    expect(catches.filter((record) => record.mediaId)).toHaveLength(28)
    const sound = catches.find((record) => record.method === 'sound' && record.mediaId)
    expect((await getMedia(sound?.mediaId ?? ''))?.kind).toBe('audio')
    const photo = catches.find((record) => record.method === 'photo' && record.mediaId)
    expect((await getMedia(photo?.mediaId ?? ''))?.kind).toBe('image')
    expect(catches.filter((record) => record.note).every((record) => /[ěščřžýáíé.]/.test(record.note ?? ''))).toBe(true)
  })

  it('does not double anything when it runs again', async () => {
    await seedDemoData({ species: list, now: NOW, media: maker })
    const again = await seedDemoData({ species: list, now: NOW + 5000, media: maker })
    expect(again).toEqual({ added: 0, kept: 30 })
    expect(await countCatches()).toBe(30)
    expect(await getDb().media.count()).toBe(28)
  })

  it('finishes a half-done seeding', async () => {
    const plan = buildDemoPlan(list, NOW)
    await addCatch({ id: plan[0].id, speciesId: plan[0].speciesId, method: plan[0].method, confidence: 0.9 })
    const result = await seedDemoData({ species: list, now: NOW, media: maker })
    expect(result).toEqual({ added: 29, kept: 1 })
  })

  it('clears only the demo catches and their media, never a real catch', async () => {
    const real = await addCatch(
      { speciesId: 'parus-major', method: 'photo', confidence: 0.8, caughtAt: NOW - 1000 },
      { kind: 'image', blob: new Blob([new Uint8Array(10)], { type: 'image/jpeg' }) },
    )
    const realSound = await addCatch({ speciesId: 'turdus-merula', method: 'sound', confidence: 0.9, id: 'my-own-catch' })
    await seedDemoData({ species: list, now: NOW, media: maker })
    expect(await countCatches()).toBe(32)
    expect((await demoCatchIds()).length).toBe(30)

    const removed = await clearDemoData()
    expect(removed).toBe(30)
    expect(await countDemoCatches()).toBe(0)
    const left = await listCatches()
    expect(left.map((record) => record.id).sort()).toEqual([real.id, realSound.id].sort())
    // The real photo is still there and only it: all the demo media went with their catches.
    expect(await getDb().media.count()).toBe(1)
    expect(await getMedia(real.mediaId ?? '')).toBeDefined()
  })

  it('has nothing to clear on an empty database', async () => {
    expect(await clearDemoData()).toBe(0)
  })
})
