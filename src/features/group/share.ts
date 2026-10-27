// Sharing a catch with the group: what is decided when a catch is saved, what goes to the server (and what stays at home), and
// the outbox that sends it. A catch never waits for the server: it is saved first, with `shareState: 'pending'`, and a few seconds
// later (so that the person can still say "no" on the success screen) the outbox sends it. A lost connection only means
// "later". Every post is made with the id of its catch, so sending twice posts once.

import {
  catchesWithPost,
  catchesWithShare,
  clearAllShares,
  getCatch,
  getMedia,
  markOlderCatchesForStats,
  updateCatchShare,
  type NewCatch,
} from '../../db'
import type { CatchRecord, SharePlace } from '../../domain/types'
import { readChoice } from '../../ml/engines'
import { shrinkImage } from '../dex/thumbnails'
import { getGroupApi } from './api'
import { addPostToDelete, clearMembership, getGroupState, getMembership, removePostToDelete, type Membership } from './state'
import { GroupError, type GroupApi, type PostInput, type PostMedia } from './types'

/** How long a new catch waits before it is sent: the person can still hide it. Browser tests shorten it ("birddex:shareDelay"). */
export const SHARE_DELAY_MS = 10_000

export function shareDelayMs(): number {
  const choice = readChoice('shareDelay')
  return choice !== undefined && choice.trim() !== '' && Number.isFinite(Number(choice)) && Number(choice) >= 0 ? Number(choice) : SHARE_DELAY_MS
}
/** The longer side of the shared picture (the original never leaves the phone). */
export const SHARED_PHOTO_SIDE = 720
const SHARED_PHOTO_QUALITY = 0.8
/** The bucket on the server takes files up to 2 MB. */
export const MAX_CLIP_BYTES = 1_900_000
/** How many catches from before joining are sent at the same time. */
const STATS_PARALLEL = 4
/** A position is shared to about one metre. */
const coordinate = (value: number): number => Math.round(value * 100_000) / 100_000

/** What a catch that is being saved gets: nothing without a group, hidden when sharing is off, otherwise waiting to be sent. */
export function initialShare(now: number = Date.now()): NonNullable<NewCatch['share']> | undefined {
  const { membership, prefs } = getGroupState()
  if (!membership) return undefined
  if (!prefs.autoShare) return { state: 'hidden' }
  return { state: 'pending', at: now + shareDelayMs() }
}

/** What the group sees of a catch. A catch from before joining gives only its species, BP and date, and stays out of the feed. */
export function postInputOf(record: CatchRecord, place: SharePlace): PostInput {
  const input: PostInput = {
    catchId: record.id,
    speciesId: record.speciesId,
    method: record.method,
    confidence: record.confidence,
    caughtAt: record.caughtAt,
  }
  if (record.bp !== undefined) input.bp = record.bp
  if (record.bpBase !== undefined) input.bpBase = record.bpBase
  if (record.bpRange) input.bpRange = [record.bpRange[0], record.bpRange[1]]
  if (record.bpFactors) input.bpFactors = [...record.bpFactors]
  if (record.shareStatsOnly) {
    input.inFeed = false
    return input
  }
  if (place !== 'none' && record.placeName) input.placeName = record.placeName
  if (place === 'exact' && record.location) {
    input.lat = coordinate(record.location.lat)
    input.lon = coordinate(record.location.lon)
  }
  return input
}

/** The picture (redrawn small, so without the camera's hidden data) or the clip of a catch, ready to send. Undefined when there is none. */
export async function mediaOf(record: CatchRecord): Promise<PostMedia | undefined> {
  if (!record.mediaId || record.shareStatsOnly) return undefined
  const media = await getMedia(record.mediaId)
  if (!media) return undefined
  if (media.kind === 'image') {
    try {
      return { blob: await shrinkImage(media.blob, SHARED_PHOTO_SIDE, SHARED_PHOTO_QUALITY), contentType: 'image/jpeg', ext: 'jpg' }
    } catch {
      return undefined
    }
  }
  if (/wav/i.test(media.mime) && media.blob.size <= MAX_CLIP_BYTES) return { blob: media.blob, contentType: 'audio/wav', ext: 'wav' }
  return undefined
}

// ---------- The outbox ----------

export interface FlushResult {
  sent: number
  /** True when something is left that a later try may do (no connection, server trouble). */
  retry: boolean
  /** The moment the next waiting catch is due, if any. */
  nextDueAt?: number
}

let running: Promise<FlushResult> | undefined

/** Sends what is due and takes out what is to be taken out. Calls that overlap share one run. */
export function flushShares(now: number = Date.now()): Promise<FlushResult> {
  running ??= doFlush(now).finally(() => {
    running = undefined
  })
  return running
}

/** The group is gone for this phone (the admin removed it, or the sign-in was lost): forget it and say why. */
export async function lostMembership(membership: Membership): Promise<void> {
  clearMembership(membership.groupName)
  await clearAllShares()
}

/**
 * The sign-in belongs to the phone's browser: when it was lost (data cleared, another browser) the server sees a stranger, who is
 * in no group. True when it is still the member that joined.
 */
export async function stillTheSameMember(api: GroupApi, membership: Membership): Promise<boolean> {
  return (await api.session()) === membership.userId
}

async function doFlush(now: number): Promise<FlushResult> {
  const result: FlushResult = { sent: 0, retry: false }
  const membership = getMembership()
  if (!membership) return result
  const { prefs, deletes } = getGroupState()
  let api: GroupApi
  try {
    api = await getGroupApi()
  } catch {
    return { ...result, retry: true }
  }

  try {
    if (!(await stillTheSameMember(api, membership))) {
      await lostMembership(membership)
      return result
    }
  } catch (error) {
    if (!(error instanceof GroupError && error.kind === 'removed')) return { ...result, retry: true }
  }

  const stop = async (error: unknown): Promise<boolean> => {
    if (error instanceof GroupError && error.kind === 'removed') {
      await lostMembership(membership)
      return true
    }
    result.retry = true
    return true
  }

  // 1. Posts of catches that were deleted.
  for (const item of deletes) {
    if (item.groupId !== membership.groupId) continue
    try {
      await api.deletePost(item.groupId, item.postId)
      removePostToDelete(item.postId)
    } catch (error) {
      if (error instanceof GroupError && error.kind === 'rejected') removePostToDelete(item.postId)
      else if (await stop(error)) return result
    }
  }

  // 2. Catches that were hidden or changed after they were sent: the old post goes first.
  for (const record of await catchesWithPost()) {
    if (!record.sharedPostId || record.shareState === 'sent') continue
    try {
      await api.deletePost(membership.groupId, record.sharedPostId)
    } catch (error) {
      if (!(error instanceof GroupError && error.kind === 'rejected') && (await stop(error))) return result
    }
    await updateCatchShare(record.id, { sharedPostId: null })
  }

  // 3. Catches that are due. The older ones (stats only) go first, a few at a time, so that a species a member had before joining is
  // already known when their first new catch arrives (the feed's badges go by the order of arrival).
  const due: CatchRecord[] = []
  for (const record of await catchesWithShare(['pending'])) {
    const at = record.shareAt ?? 0
    if (at > now) result.nextDueAt = Math.min(result.nextDueAt ?? Infinity, at)
    else due.push(record)
  }
  let stopped = false
  const send = async (record: CatchRecord): Promise<void> => {
    try {
      const { postId } = await api.publish(membership.groupId, postInputOf(record, record.sharePlace ?? prefs.place), await mediaOf(record))
      const current = await getCatch(record.id)
      if (!current) addPostToDelete({ groupId: membership.groupId, postId })
      else if (current.shareState === 'pending') await updateCatchShare(record.id, { shareState: 'sent', sharedPostId: postId, shareAt: null })
      else await updateCatchShare(record.id, { sharedPostId: postId }) // hidden while it was on its way: step 2 takes it out
      result.sent++
    } catch (error) {
      if (error instanceof GroupError && error.kind === 'rejected') await updateCatchShare(record.id, { shareState: 'hidden', shareAt: null })
      else stopped = (await stop(error)) || stopped
    }
  }
  const older = due.filter((record) => record.shareStatsOnly)
  await Promise.all(
    Array.from({ length: Math.min(STATS_PARALLEL, older.length) }, async () => {
      for (let record = older.shift(); record && !stopped; record = older.shift()) await send(record)
    }),
  )
  for (const record of due.filter((one) => !one.shareStatsOnly)) {
    if (stopped) break
    await send(record)
  }
  if (stopped) return result
  // A catch that was hidden while it was on its way has a post to take out: one more round does it.
  if (result.sent > 0 && (await catchesWithPost()).some((record) => record.sharedPostId && record.shareState !== 'sent')) {
    const next = await doFlush(now)
    return { ...next, sent: result.sent + next.sent }
  }
  return result
}

/**
 * The catches from before joining (or restored from a backup) count in the leaderboards, so they are marked to be sent as stats-only
 * posts: species, BP and date, without a picture or a place, never in the feed. Does nothing for those already dealt with.
 */
export async function backfillOlderCatches(now: number = Date.now()): Promise<number> {
  if (!getMembership()) return 0
  const marked = await markOlderCatchesForStats(now)
  if (marked > 0) scheduleFlush(200)
  return marked
}

// ---------- When to look at the outbox ----------

let timer: ReturnType<typeof setTimeout> | undefined
let timerAt = Infinity

/** Looks at the outbox in `ms` milliseconds (an earlier plan stays). After a run it plans the next waiting catch itself. */
export function scheduleFlush(ms: number): void {
  const at = Date.now() + Math.max(0, ms)
  if (timer && timerAt <= at) return
  clearTimeout(timer)
  timerAt = at
  timer = setTimeout(
    () => {
      timer = undefined
      timerAt = Infinity
      void flushShares().then((result) => {
        if (result.nextDueAt) scheduleFlush(result.nextDueAt - Date.now() + 200)
      })
    },
    Math.max(0, ms),
  )
}

// ---------- What the person can change afterwards ----------

export interface ShareChange {
  /** true: share it (or keep sharing), false: keep it to myself. */
  shared?: boolean
  /** The place of this catch: a value overrides the setting, null follows the setting again. */
  place?: SharePlace | null
}

/** Whether a catch can be shared at all: only the ones made while this phone was in the group. */
export const isShareable = (record: CatchRecord): boolean => record.shareState !== undefined && getMembership() !== undefined

/**
 * Hides or shares a catch, or changes how much of its place the group sees. A catch that is already in the feed is taken out
 * and, when it stays shared, sent again with the new place. Returns the catch as it is now.
 */
export async function changeShare(id: string, change: ShareChange, now: number = Date.now()): Promise<CatchRecord | undefined> {
  const record = await getCatch(id)
  if (!record || !isShareable(record)) return record
  const shared = change.shared ?? record.shareState !== 'hidden'
  // A catch from before joining has no place to hide: only its species, BP and date are counted.
  const place = change.place === undefined || record.shareStatsOnly ? record.sharePlace : (change.place ?? undefined)
  const placeChanged = place !== record.sharePlace
  const sent = record.shareState === 'sent'
  let next: CatchRecord | undefined
  if (!shared) {
    next = await updateCatchShare(id, { shareState: 'hidden', shareAt: null, sharePlace: place ?? null })
  } else if (sent && !placeChanged) {
    next = record
  } else {
    // Shared again, or sent again with another place. A post that is already there is replaced.
    next = await updateCatchShare(id, {
      shareState: 'pending',
      shareAt: now + (sent || record.shareStatsOnly ? Math.min(1_000, shareDelayMs()) : shareDelayMs()),
      sharePlace: place ?? null,
    })
  }
  scheduleFlush(shared ? (sent || record.shareStatsOnly ? Math.min(1_200, shareDelayMs() + 200) : shareDelayMs() + 200) : 100)
  return next
}

/** A catch is being deleted: its post goes too. Call it with the record from before the deletion. */
export async function forgetShared(record: CatchRecord): Promise<void> {
  const membership = getMembership()
  if (!membership || !record.sharedPostId) return
  addPostToDelete({ groupId: membership.groupId, postId: record.sharedPostId })
  scheduleFlush(100)
}

/** The person leaves the group: the posts and pictures go (server), the catches stay and are not shared any more. */
export async function leaveAndForget(): Promise<void> {
  const membership = getMembership()
  if (!membership) return
  const api = await getGroupApi()
  await api.leaveGroup(membership.groupId)
  clearMembership()
  await clearAllShares()
}
