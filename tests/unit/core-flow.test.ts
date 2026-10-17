// @vitest-environment jsdom
//
// The scan-to-catch flow, written the way the screens will write it, using only the public API of the core modules
// and the fake engines. It is documentation that runs: if a change to the core breaks how the pieces fit together,
// this fails.
import 'fake-indexeddb/auto'
import { Blob as NodeBlob } from 'node:buffer'
import { cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  addCatch,
  catchesBySpecies,
  countCatches,
  deleteAllCatches,
  deleteCatch,
  exportBackup,
  getMedia,
  importBackup,
  useCaughtSummary,
} from '../../src/db'
import { evaluateCandidates } from '../../src/domain/thresholds'
import type { SoundUpdate } from '../../src/domain/engines'
import { getEngines, resetEngines } from '../../src/ml/engines'
import { clearPending, getPending, getPendingCatchId, setPending } from '../../src/state/pending'
import { getCachedLocation, getCurrentLocation, resetLocationForTests } from '../../src/state/location'
import { getSettings, reloadSettingsForTests, updateSettings } from '../../src/state/settings'

// jsdom's Blob cannot be stored by fake-indexeddb, so use Node's own Blob (see core-db-live.test.ts).
beforeAll(() => {
  vi.stubGlobal('Blob', NodeBlob)
})

beforeEach(async () => {
  window.history.replaceState({}, '', '/?engines=fake&fakeDelay=0')
  localStorage.clear()
  reloadSettingsForTests()
  resetEngines()
  resetLocationForTests()
  clearPending()
  await deleteAllCatches()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.stubGlobal('Blob', NodeBlob)
})

const jpeg = () => new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])], { type: 'image/jpeg' })

function pretendPhoneAt(lat: number, lon: number) {
  vi.stubGlobal('navigator', {
    geolocation: { getCurrentPosition: (success: PositionCallback) => success({ coords: { latitude: lat, longitude: lon, accuracy: 20 } } as GeolocationPosition) },
  })
}

describe('photo: from the picture to the Dex', () => {
  it('identifies, judges, saves once even if the button is tapped twice, and shows up in the Dex', async () => {
    pretendPhoneAt(50.08, 14.43)
    const engines = getEngines()
    await engines.photo.prepare()
    const identified = await engines.photo.identify({} as HTMLCanvasElement)

    // The scan screen hands over to the result screen.
    const location = await getCurrentLocation({ timeoutMs: 2000 })
    setPending({ method: 'photo', candidates: identified.candidates, media: { kind: 'image', blob: jpeg(), mime: 'image/jpeg' }, location, createdAt: Date.now() })

    // The result screen judges the guesses with the user's sensitivity setting.
    const pending = getPending()
    if (!pending) throw new Error('nothing pending')
    const verdicts = evaluateCandidates(pending.candidates, pending.method, 'normal')
    expect(verdicts[0]).toMatchObject({ speciesId: 'parus-major', allowed: true })
    expect(verdicts.slice(1).every((verdict) => !verdict.allowed)).toBe(true)

    // The user confirms; a nervous second tap does no harm.
    const save = () =>
      addCatch(
        { id: getPendingCatchId(), speciesId: verdicts[0].speciesId, method: pending.method, confidence: verdicts[0].confidence, location: pending.location, placeName: 'Praha' },
        pending.media,
      )
    const [first, second] = await Promise.all([save(), save()])
    clearPending()
    expect(second.id).toBe(first.id)
    expect(await countCatches()).toBe(1)
    expect(first).toMatchObject({ speciesId: 'parus-major', method: 'photo', location: { lat: 50.08, lon: 14.43, accuracyM: 20 }, placeName: 'Praha' })

    // The Dex shows the bird as caught, with the picture.
    const dex = renderHook(() => useCaughtSummary())
    await waitFor(() => expect(dex.result.current.bySpecies.get('parus-major')?.count).toBe(1))
    const entry = dex.result.current.bySpecies.get('parus-major')
    expect(entry).toMatchObject({ mediaKind: 'image', firstCaughtAt: first.caughtAt, lastCaughtAt: first.caughtAt })
    expect((await getMedia(entry?.mediaId as string))?.mime).toBe('image/jpeg')
    expect(await catchesBySpecies('parus-major')).toHaveLength(1)
  })

  it('finds a second sighting of the same bird, keeping the first date and the newest picture', async () => {
    const dex = renderHook(() => useCaughtSummary())
    await addCatch({ speciesId: 'parus-major', method: 'photo', confidence: 0.9, caughtAt: 1000 }, { kind: 'image', blob: jpeg() })
    const newer = await addCatch({ speciesId: 'parus-major', method: 'live', confidence: 0.8, caughtAt: 9000 }, { kind: 'image', blob: jpeg() })
    await waitFor(() => expect(dex.result.current.bySpecies.get('parus-major')?.count).toBe(2))
    expect(dex.result.current.bySpecies.get('parus-major')).toMatchObject({ firstCaughtAt: 1000, lastCaughtAt: 9000, mediaId: newer.mediaId })
  })

  it('does not let a low-confidence scene be caught, whatever the sensitivity', async () => {
    window.history.replaceState({}, '', '/?engines=fake&fakeDelay=0&fake=low')
    resetEngines()
    const { candidates } = await getEngines().photo.identify({} as HTMLCanvasElement)
    for (const sensitivity of ['strict', 'normal', 'easy'] as const) {
      expect(evaluateCandidates(candidates, 'photo', sensitivity).some((verdict) => verdict.allowed)).toBe(false)
    }
  })

  it('follows the sensitivity setting', () => {
    const sixty = [{ speciesId: 'parus-major', confidence: 0.6 }]
    const allowedNow = () => evaluateCandidates(sixty, 'sound', getSettings().sensitivity)[0].allowed
    expect(allowedNow()).toBe(false) // normal asks for 0.70
    updateSettings({ sensitivity: 'easy' })
    expect(allowedNow()).toBe(true)
    updateSettings({ sensitivity: 'strict' })
    expect(allowedNow()).toBe(false)
  })
})

describe('sound: from listening to the Dex', () => {
  it('listens, stops, saves the clip with the catch, and the Dex knows it is a clip', async () => {
    const engines = getEngines()
    await engines.sound.prepare()
    const updates: SoundUpdate[] = []
    const session = await engines.sound.start({ onUpdate: (update) => updates.push(update) })
    await vi.waitFor(() => expect(updates.length).toBeGreaterThanOrEqual(6))
    expect(updates.at(-1)?.hearingBird).toBe(true)
    const result = await session.stop()
    expect(result.clip).toBeDefined()

    const best = evaluateCandidates(result.candidates, 'sound', 'normal')[0]
    expect(best.allowed).toBe(true)
    const saved = await addCatch(
      { speciesId: best.speciesId, method: 'sound', confidence: best.confidence },
      { kind: 'audio', blob: result.clip as Blob, mime: 'audio/wav', durationS: result.clipSeconds },
    )

    const dex = renderHook(() => useCaughtSummary())
    await waitFor(() => expect(dex.result.current.bySpecies.get('parus-major')).toMatchObject({ count: 1, mediaKind: 'audio', mediaId: saved.mediaId }))
    const media = await getMedia(saved.mediaId as string)
    expect(media).toMatchObject({ kind: 'audio', mime: 'audio/wav', durationS: 2 })
    expect(media?.blob.size).toBe(44 + 2 * 48_000 * 2)
  })
})

describe('the Dex after a delete and after a restore', () => {
  it('follows a deleted catch and a restored backup without being told', async () => {
    const dex = renderHook(() => useCaughtSummary())
    const a = await addCatch({ speciesId: 'parus-major', method: 'photo', confidence: 0.9 }, { kind: 'image', blob: jpeg() })
    await addCatch({ speciesId: 'turdus-merula', method: 'sound', confidence: 0.8 })
    await waitFor(() => expect(dex.result.current.speciesCount).toBe(2))
    const backup = await exportBackup()

    await deleteCatch(a.id)
    await waitFor(() => expect(dex.result.current.speciesCount).toBe(1))
    expect(await getMedia(a.mediaId as string)).toBeUndefined()

    const report = await importBackup(backup)
    expect(report).toMatchObject({ added: 1, skipped: 1, mediaAdded: 1 })
    await waitFor(() => expect(dex.result.current.speciesCount).toBe(2))
    expect(dex.result.current.bySpecies.get('parus-major')?.mediaKind).toBe('image')
    expect(dex.result.current.catchCount).toBe(2)
  })
})

describe('location in the flow', () => {
  it('lets a tap handler use the position that was looked up when the screen opened', async () => {
    pretendPhoneAt(49.2, 16.6)
    expect(getCachedLocation()).toBeUndefined()
    await getCurrentLocation({ timeoutMs: 2000 }) // when the scan screen opens
    expect(getCachedLocation()).toMatchObject({ lat: 49.2, lon: 16.6 }) // in the tap, without waiting
  })
})
