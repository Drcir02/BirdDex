import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { addCatch, deleteAllCatches, exportBackup, getCatch, getDb, importBackup, listCatches } from '../../src/db'
import { calculateBirdPoints, toStored } from '../../src/domain/birdPoints'
import { syncBirdPoints } from '../../src/features/birds/syncBirdPoints'
import type { Species } from '../../src/domain/types'

// BirdPoints for catches that have none (from before BP existed), and for a bird whose range changed.

const bird = (id: string, patch: Partial<Species> = {}): Species => ({
  id,
  dexNumber: 1,
  scientificName: id,
  czechName: id,
  englishName: id,
  family: 'Paridae',
  inCzechia: true,
  inEurope: true,
  rarity: 'common',
  birdnetIndex: 1,
  wingclipIndex: 1,
  wikiTitle: null,
  info: { months: '333333333333', place: 'woods', shy: 1, day: 'day', tip: 'smallwoods', bp: [50, 750] },
  ...patch,
})

const TIT = bird('parus-major')
const OWL = bird('bubo-bubo', { rarity: 'epic', info: { months: '333333333333', place: 'rocks', shy: 3, day: 'night', tip: 'owls', bp: [1100, 2000] } })
const LIST = [TIT, OWL]
const NOON = new Date(2026, 5, 15, 12).getTime()

/** Dice that always roll the middle: luck is +0.02. */
const middle = () => 0.5

beforeEach(async () => {
  await deleteAllCatches()
})

describe('catches from before BP existed', () => {
  it('get a BP once, inside the range of their bird, marked as worked out afterwards', async () => {
    await addCatch({ id: 'a', speciesId: 'parus-major', method: 'sound', confidence: 0.9, caughtAt: NOON })
    await addCatch({ id: 'b', speciesId: 'bubo-bubo', method: 'live', confidence: 0.8, caughtAt: NOON })
    const report = await syncBirdPoints(LIST, middle)
    expect(report).toEqual({ added: 2, recalculated: 0 })

    const tit = (await getCatch('a'))!
    expect(tit.bp).toBeGreaterThanOrEqual(50)
    expect(tit.bp).toBeLessThanOrEqual(750)
    expect(tit.bpLegacy).toBe(true)
    expect(tit.bpRange).toEqual([50, 750])
    expect(tit.bpFactors).toHaveLength(5)
    expect(tit.bpLuck).toBeCloseTo(0.02, 4)
    const owl = (await getCatch('b'))!
    expect(owl.bp).toBeGreaterThanOrEqual(1100)
    expect(owl.bp).toBeLessThanOrEqual(2000)
    expect(owl.bpRange).toEqual([1100, 2000])
  })

  it('use a middle clarity, and the date of the catch for a photo (it was not old then)', async () => {
    await addCatch({ id: 'p', speciesId: 'parus-major', method: 'photo', confidence: 0.9, caughtAt: new Date(2020, 0, 1, 12).getTime() })
    await syncBirdPoints(LIST, middle)
    const record = (await getCatch('p'))!
    expect(record.bpFactors?.[1]).toBe(0.6)
    // A photo caught at its own date is "fresh": 0.8, not the 0.4 of a week-old picture.
    expect(record.bpFactors?.[4]).toBe(0.8)
  })

  it('are not touched again by the next run, so the number never changes by itself', async () => {
    await addCatch({ id: 'a', speciesId: 'parus-major', method: 'sound', confidence: 0.9, caughtAt: NOON })
    await syncBirdPoints(LIST)
    const first = (await getCatch('a'))!
    const second = await syncBirdPoints(LIST)
    expect(second).toEqual({ added: 0, recalculated: 0 })
    expect(await getCatch('a')).toEqual(first)
  })

  it('stay without a BP when their bird is not in the species list', async () => {
    await addCatch({ id: 'x', speciesId: 'nobody', method: 'sound', confidence: 0.9 })
    expect(await syncBirdPoints(LIST)).toEqual({ added: 0, recalculated: 0 })
    expect((await getCatch('x'))?.bp).toBeUndefined()
  })
})

describe('a catch that has its BP', () => {
  const withBp = async (id: string, range: [number, number], seed = 0.7) => {
    const species = bird('parus-major', { info: { ...TIT.info!, bp: range } })
    const points = calculateBirdPoints({ species, method: 'live', confidence: 0.95, lead: 0.5, caughtAt: NOON, now: NOON, random: () => seed })
    await addCatch({ id, speciesId: 'parus-major', method: 'live', confidence: 0.95, caughtAt: NOON, birdPoints: toStored(points) })
    return points
  }

  it('is left alone while the range of its bird is the same', async () => {
    await withBp('a', [50, 750])
    const before = (await getCatch('a'))!
    expect(await syncBirdPoints(LIST)).toEqual({ added: 0, recalculated: 0 })
    expect(await getCatch('a')).toEqual(before)
  })

  it('follows a changed range with the same quality and the same luck', async () => {
    await withBp('a', [50, 750])
    const before = (await getCatch('a'))!
    const bigger = bird('parus-major', { info: { ...TIT.info!, bp: [300, 1000] } })
    expect(await syncBirdPoints([bigger, OWL])).toEqual({ added: 0, recalculated: 1 })
    const after = (await getCatch('a'))!
    expect(after.bpRange).toEqual([300, 1000])
    expect(after.bp).toBeGreaterThan(before.bp!)
    expect(after.bp).toBeGreaterThanOrEqual(300)
    expect(after.bp).toBeLessThanOrEqual(1000)
    // The quality and the luck are what they were: only the range moved.
    expect(after.bpQ).toBe(before.bpQ)
    expect(after.bpLuck).toBe(before.bpLuck)
    // And it is settled: the next run changes nothing.
    expect(await syncBirdPoints([bigger, OWL])).toEqual({ added: 0, recalculated: 0 })
  })

  it('is recalculated when its range was not saved (a catch that came from a backup without one)', async () => {
    await withBp('a', [50, 750])
    await getDb().catches.update('a', { bpRange: undefined })
    expect(await syncBirdPoints(LIST)).toEqual({ added: 0, recalculated: 1 })
    expect((await getCatch('a'))?.bpRange).toEqual([50, 750])
  })
})

describe('BP in the backup file', () => {
  it('survives a backup and a restore on a phone that lost everything', async () => {
    const points = calculateBirdPoints({ species: TIT, method: 'live', confidence: 0.95, lead: 0.5, caughtAt: NOON, now: NOON, random: middle })
    await addCatch({ id: 'a', speciesId: 'parus-major', method: 'live', confidence: 0.95, caughtAt: NOON, birdPoints: toStored(points) })
    await addCatch({ id: 'old', speciesId: 'parus-major', method: 'sound', confidence: 0.8, caughtAt: NOON })
    await syncBirdPoints(LIST, middle)
    const saved = await listCatches()
    const file = await exportBackup()

    await deleteAllCatches()
    await importBackup(file, { knownSpeciesIds: new Set(['parus-major']) })
    const restored = await listCatches()
    expect(restored.map((record) => record.id).sort()).toEqual(['a', 'old'])
    for (const record of saved) {
      const back = restored.find((entry) => entry.id === record.id)!
      expect(back.bp).toBe(record.bp)
      expect(back.bpBase).toBe(record.bpBase)
      expect(back.bpQ).toBe(record.bpQ)
      expect(back.bpLuck).toBe(record.bpLuck)
      expect(back.bpRange).toEqual(record.bpRange)
      expect(back.bpFactors).toEqual(record.bpFactors)
      expect(back.bpLegacy).toBe(record.bpLegacy)
    }
    expect(restored.find((record) => record.id === 'old')?.bpLegacy).toBe(true)
  })

  it('leaves a broken BP out of an imported catch instead of refusing the backup', async () => {
    await addCatch({ id: 'a', speciesId: 'parus-major', method: 'sound', confidence: 0.9, caughtAt: NOON, birdPoints: toStored(calculateBirdPoints({ species: TIT, method: 'sound', confidence: 0.9, caughtAt: NOON, now: NOON, random: middle })) })
    await getDb().catches.update('a', { bp: -5, bpQ: 7 })
    const file = await exportBackup()
    await deleteAllCatches()
    await importBackup(file, { knownSpeciesIds: new Set(['parus-major']) })
    const record = (await getCatch('a'))!
    expect(record.bp).toBeUndefined()
    expect(record.speciesId).toBe('parus-major')
  })
})
