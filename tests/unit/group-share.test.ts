// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { Blob as NodeBlob } from 'node:buffer'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { addCatch, deleteAllCatches, deleteCatch, getCatch, getDb, listCatches } from '../../src/db'
import type { CatchRecord } from '../../src/domain/types'
import { useGroupApiForTests } from '../../src/features/group/api'
import { FAKE_GROUP_CODE, createFakeApi, type FakeGroupApi } from '../../src/features/group/fakeApi'
import {
  MAX_CLIP_BYTES,
  SHARE_DELAY_MS,
  changeShare,
  flushShares,
  forgetShared,
  initialShare,
  isShareable,
  leaveAndForget,
  mediaOf,
  postInputOf,
} from '../../src/features/group/share'
import { getGroupState, getMembership, reloadGroupStateForTests, setMembership, updatePrefs } from '../../src/features/group/state'

// Sharing a catch: what is decided when it is saved, what goes to the server, and the outbox that sends it.

beforeAll(() => {
  vi.stubGlobal('Blob', NodeBlob)
})

const NOW = Date.UTC(2026, 8, 16, 10)
let api: FakeGroupApi
let groupId: string

async function join() {
  groupId = (await api.joinGroup({ code: FAKE_GROUP_CODE, nickname: 'Míša', color: '#1971C2' })).groupId
  setMembership({
    groupId,
    groupName: 'Rodina',
    code: FAKE_GROUP_CODE,
    nickname: 'Míša',
    color: '#1971C2',
    userId: 'me',
    isAdmin: false,
    joinedAt: NOW - 1000,
  })
}

/** A catch as the result screen saves it: BP, a place and the share state it gets. */
async function save(id: string, patch: Partial<Parameters<typeof addCatch>[0]> = {}) {
  return addCatch({
    id,
    speciesId: 'parus-major',
    method: 'live',
    confidence: 0.9,
    caughtAt: NOW - 60_000,
    placeName: 'Praha',
    location: { lat: 50.0875123456, lon: 14.4213987654 },
    birdPoints: { bp: 300, bpBase: 280, bpQ: 0.7, bpLuck: 0.02, bpRange: [50, 500], bpFactors: [0.8, 1, 0.7, 1, 1] },
    share: initialShare(NOW),
    ...patch,
  })
}

const posts = async () => (await api.feed(groupId)).filter((post) => post.userId === 'me')

beforeEach(async () => {
  localStorage.clear()
  reloadGroupStateForTests()
  await deleteAllCatches()
  api = createFakeApi({ userId: 'me', persist: false, now: () => NOW })
  useGroupApiForTests(api)
})

afterEach(() => {
  useGroupApiForTests(undefined)
})

describe('what a new catch gets', () => {
  it('nothing without a group: such a catch is never shared', async () => {
    expect(initialShare(NOW)).toBeUndefined()
    const saved = await save('c0')
    expect(saved.shareState).toBeUndefined()
    expect(isShareable(saved)).toBe(false)
  })

  it('waits to be sent when the person is in a group and shares automatically, and is hidden when not', async () => {
    await join()
    expect(initialShare(NOW)).toEqual({ state: 'pending', at: NOW + SHARE_DELAY_MS })
    updatePrefs({ autoShare: false })
    expect(initialShare(NOW)).toEqual({ state: 'hidden' })
    const saved = await save('c1')
    expect(saved.shareState).toBe('hidden')
    expect(isShareable(saved)).toBe(true)
  })
})

describe('what the group sees of a catch', () => {
  const record: CatchRecord = {
    id: 'c1',
    speciesId: 'parus-major',
    method: 'live',
    confidence: 0.9,
    caughtAt: NOW,
    placeName: 'Praha, Stromovka',
    location: { lat: 50.0875123456, lon: 14.4213987654, accuracyM: 12 },
    bp: 300,
    bpBase: 280,
    bpRange: [50, 500],
    bpFactors: [0.8, 1, 0.7, 1, 1],
    note: 'private words',
  }

  it('shows the point, rounded to a metre, when the place is exact', () => {
    expect(postInputOf(record, 'exact')).toEqual({
      catchId: 'c1',
      speciesId: 'parus-major',
      method: 'live',
      confidence: 0.9,
      caughtAt: NOW,
      bp: 300,
      bpBase: 280,
      bpRange: [50, 500],
      bpFactors: [0.8, 1, 0.7, 1, 1],
      placeName: 'Praha, Stromovka',
      lat: 50.08751,
      lon: 14.4214,
    })
  })

  it('shows only the name, or nothing', () => {
    expect(postInputOf(record, 'name')).toMatchObject({ placeName: 'Praha, Stromovka' })
    expect(postInputOf(record, 'name').lat).toBeUndefined()
    const none = postInputOf(record, 'none')
    expect(none.placeName).toBeUndefined()
    expect(none.lat).toBeUndefined()
    expect(none.lon).toBeUndefined()
  })

  it('never carries the note or the accuracy', () => {
    const text = JSON.stringify(postInputOf(record, 'exact'))
    expect(text).not.toContain('private words')
    expect(text).not.toContain('accuracy')
  })
})

describe('the picture and the clip', () => {
  const wav = (size: number, type = 'audio/wav') => new Blob([new Uint8Array(size)], { type })
  it('sends a short WAV clip as it is and leaves out anything else or too big', async () => {
    const make = async (blob: Blob, mime: string) => {
      const saved = await addCatch({ speciesId: 'parus-major', method: 'sound', confidence: 0.9 }, { kind: 'audio', blob, mime })
      return mediaOf(saved)
    }
    expect(await make(wav(1000), 'audio/wav')).toMatchObject({ contentType: 'audio/wav', ext: 'wav' })
    expect(await make(wav(MAX_CLIP_BYTES + 1), 'audio/wav')).toBeUndefined()
    expect(await make(wav(1000, 'audio/webm'), 'audio/webm')).toBeUndefined()
  })

  it('has nothing for a catch without a saved picture or clip', async () => {
    expect(await mediaOf(await save('c2'))).toBeUndefined()
  })
})

describe('the outbox', () => {
  beforeEach(join)

  it('sends a catch that is due, once, and remembers its post', async () => {
    await save('c1')
    expect(await flushShares(NOW + SHARE_DELAY_MS - 1)).toMatchObject({ sent: 0, nextDueAt: NOW + SHARE_DELAY_MS })
    expect(await posts()).toHaveLength(0)
    expect(await flushShares(NOW + SHARE_DELAY_MS)).toMatchObject({ sent: 1, retry: false })
    const after = (await getCatch('c1'))!
    expect(after).toMatchObject({ shareState: 'sent' })
    expect(after.sharedPostId).toBeTruthy()
    expect(after.shareAt).toBeUndefined()
    expect(await posts()).toMatchObject([{ catchId: 'c1', speciesId: 'parus-major', bp: 300, placeName: 'Praha' }])
    expect(await flushShares(NOW + 2 * SHARE_DELAY_MS)).toMatchObject({ sent: 0 })
    expect(await posts()).toHaveLength(1)
  })

  it('does not send a hidden catch or one made before joining', async () => {
    updatePrefs({ autoShare: false })
    await save('hidden')
    await addCatch({ id: 'old', speciesId: 'parus-major', method: 'live', confidence: 0.9, caughtAt: NOW - 5000 })
    await flushShares(NOW + 10 * SHARE_DELAY_MS)
    expect(await posts()).toHaveLength(0)
  })

  it('keeps the catch and tries again when there is no connection', async () => {
    await save('c1')
    api.online = false
    expect(await flushShares(NOW + SHARE_DELAY_MS)).toMatchObject({ sent: 0, retry: true })
    expect((await getCatch('c1'))!.shareState).toBe('pending')
    api.online = true
    expect(await flushShares(NOW + SHARE_DELAY_MS)).toMatchObject({ sent: 1, retry: false })
  })

  it('follows the place setting at the moment of sending, and a place chosen for this one catch over it', async () => {
    updatePrefs({ place: 'name' })
    await save('c1')
    await save('c2', { share: { state: 'pending', at: NOW } })
    await changeShare('c2', { place: 'none' }, NOW)
    await flushShares(NOW + 5 * SHARE_DELAY_MS)
    const sent = await posts()
    const byId = Object.fromEntries(sent.map((post) => [post.catchId, post]))
    expect(byId.c1.placeName).toBe('Praha')
    expect(byId.c1.lat).toBeUndefined()
    expect(byId.c2.placeName).toBeUndefined()
  })

  it('does not post a catch that the server refuses, and does not try it again', async () => {
    await save('bad', { birdPoints: { bp: 900, bpBase: 800, bpQ: 0.7, bpLuck: 0.02, bpRange: [50, 500], bpFactors: [1, 1, 1, 1, 1] } })
    // The record itself is valid for the app (BP stored as it is), but the server says no.
    await getDb().catches.update('bad', { bp: 900 })
    expect(await flushShares(NOW + SHARE_DELAY_MS)).toMatchObject({ sent: 0, retry: false })
    expect((await getCatch('bad'))!.shareState).toBe('hidden')
  })

  it('forgets the group when the server says the phone was removed', async () => {
    await save('c1')
    await api.as('fake-tomas').removeMember(groupId, 'me')
    await flushShares(NOW + SHARE_DELAY_MS)
    expect(getMembership()).toBeUndefined()
    expect(getGroupState().removedFrom).toBe('Rodina')
    expect((await getCatch('c1'))!.shareState).toBeUndefined()
  })
})

describe('changing one’s mind', () => {
  beforeEach(join)

  it('hides a catch before it is sent', async () => {
    await save('c1')
    expect((await changeShare('c1', { shared: false }, NOW))!.shareState).toBe('hidden')
    await flushShares(NOW + SHARE_DELAY_MS)
    expect(await posts()).toHaveLength(0)
  })

  it('shares a hidden catch again, ten seconds later', async () => {
    updatePrefs({ autoShare: false })
    await save('c1')
    const next = (await changeShare('c1', { shared: true }, NOW))!
    expect(next).toMatchObject({ shareState: 'pending', shareAt: NOW + SHARE_DELAY_MS })
    await flushShares(NOW + SHARE_DELAY_MS)
    expect(await posts()).toHaveLength(1)
  })

  it('takes a post that is already in the feed out when the catch is hidden', async () => {
    await save('c1')
    await flushShares(NOW + SHARE_DELAY_MS)
    expect(await posts()).toHaveLength(1)
    await changeShare('c1', { shared: false }, NOW + 20_000)
    await flushShares(NOW + 20_000)
    expect(await posts()).toHaveLength(0)
    expect(await getCatch('c1')).toMatchObject({ shareState: 'hidden' })
    expect((await getCatch('c1'))!.sharedPostId).toBeUndefined()
  })

  it('replaces the post when the place of a sent catch is hidden, so the old place is gone', async () => {
    await save('c1')
    await flushShares(NOW + SHARE_DELAY_MS)
    const [before] = await posts()
    expect(before.lat).toBeDefined()
    await changeShare('c1', { place: 'none' }, NOW + 20_000)
    await flushShares(NOW + 30_000)
    const after = await posts()
    expect(after).toHaveLength(1)
    expect(after[0].id).not.toBe(before.id)
    expect(after[0].lat).toBeUndefined()
    expect(after[0].placeName).toBeUndefined()
    expect((await getCatch('c1'))!.shareState).toBe('sent')
  })

  it('keeps the old post out of the feed even when the connection is lost while replacing it', async () => {
    await save('c1')
    await flushShares(NOW + SHARE_DELAY_MS)
    await changeShare('c1', { shared: false }, NOW + 20_000)
    api.online = false
    expect(await flushShares(NOW + 30_000)).toMatchObject({ retry: true })
    expect((await getCatch('c1'))!.sharedPostId).toBeTruthy()
    api.online = true
    await flushShares(NOW + 31_000)
    expect(await posts()).toHaveLength(0)
    expect((await getCatch('c1'))!.sharedPostId).toBeUndefined()
  })

  it('does nothing to a catch that is not part of the group', async () => {
    await addCatch({ id: 'old', speciesId: 'parus-major', method: 'live', confidence: 0.9 })
    expect((await changeShare('old', { shared: true }, NOW))!.shareState).toBeUndefined()
  })
})

describe('deleting a catch', () => {
  beforeEach(join)

  it('takes its post out of the feed, also when it can only be done later', async () => {
    await save('c1')
    await flushShares(NOW + SHARE_DELAY_MS)
    const record = (await getCatch('c1'))!
    await deleteCatch('c1')
    api.online = false
    await forgetShared(record)
    expect(await flushShares(NOW + 20_000)).toMatchObject({ retry: true })
    expect(getGroupState().deletes).toHaveLength(1)
    api.online = true
    await flushShares(NOW + 21_000)
    expect(await posts()).toHaveLength(0)
    expect(getGroupState().deletes).toHaveLength(0)
  })
})

describe('leaving', () => {
  it('removes everything from the group, keeps the catches and stops sharing them', async () => {
    await join()
    await save('c1')
    await flushShares(NOW + SHARE_DELAY_MS)
    await leaveAndForget()
    expect(getMembership()).toBeUndefined()
    expect(api.snapshot().posts.some((post) => post.userId === 'me')).toBe(false)
    const [kept] = await listCatches()
    expect(kept.id).toBe('c1')
    expect(kept.shareState).toBeUndefined()
    expect(kept.sharedPostId).toBeUndefined()
  })

  it('stays in the group when the server cannot be reached', async () => {
    await join()
    api.online = false
    await expect(leaveAndForget()).rejects.toThrow()
    expect(getMembership()).toBeDefined()
  })
})
