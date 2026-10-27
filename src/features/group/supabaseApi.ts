// The real group server: Supabase (database, file storage, anonymous sign-in). The client library is loaded only when a group
// is used, so the app stays small for everybody else. The rules of who may read and write what live on the server
// (supabase/migrations/001_group.sql); this file only asks politely and turns the answers into the types of ./types.ts.

import type { SupabaseClient } from '@supabase/supabase-js'
import { GROUP_SERVER_KEY, GROUP_SERVER_URL } from './server'
import {
  GroupError,
  type Board,
  type BoardRow,
  type FeedPost,
  type FeedQuery,
  type GroupApi,
  type MemberRow,
  type PostInput,
  type PostMedia,
} from './types'

const BUCKET = 'posts'
const SIGNED_URL_SECONDS = 3600
const AUTH_STORAGE_KEY = 'birddex-group-auth'

interface ServerError {
  message?: string
  code?: string
  status?: number
  statusCode?: string | number
  name?: string
}

/** Turns whatever the client library threw or returned into a GroupError the screens understand. */
export function toGroupError(error: unknown, whenPosting = false): GroupError {
  if (error instanceof GroupError) return error
  const e = (typeof error === 'object' && error !== null ? error : { message: String(error) }) as ServerError
  const message = e.message ?? 'server error'
  const status = Number(e.status ?? e.statusCode ?? 0)
  switch (e.code) {
    case '28P01':
      return new GroupError('wrong-founder-code', message, { cause: error })
    case 'P0002':
      return new GroupError('no-group', message, { cause: error })
    case '53400':
      return new GroupError('full', message, { cause: error })
    case '23505':
      return new GroupError('name-taken', message, { cause: error })
    case '28000':
    case 'PGRST301':
    case 'PGRST303':
      return new GroupError('auth', message, { cause: error })
    case '23503':
      return new GroupError('removed', message, { cause: error })
    case '42501':
      return new GroupError(whenPosting ? 'removed' : 'rejected', message, { cause: error })
    case '22023':
    case '23514':
    case '22P02':
      return new GroupError('rejected', message, { cause: error })
  }
  if (status === 401) return new GroupError('auth', message, { cause: error })
  if (status === 403) return new GroupError(whenPosting ? 'removed' : 'rejected', message, { cause: error })
  if (status >= 500) return new GroupError('server', message, { cause: error })
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false
  if (offline || status === 0 || /fetch|network|load failed|timeout|offline|aborted/i.test(`${e.name ?? ''} ${message}`)) {
    return new GroupError('network', message, { cause: error })
  }
  return new GroupError('server', message, { cause: error })
}

function check<T>(result: { data: T | null; error: unknown }, whenPosting = false): T {
  if (result.error) throw toGroupError(result.error, whenPosting)
  return result.data as T
}

const toMs = (value: unknown): number => {
  const ms = typeof value === 'string' ? Date.parse(value) : Number.NaN
  return Number.isFinite(ms) ? ms : 0
}

interface FeedRow {
  id: string
  user_id: string
  nickname: string
  color: string
  catch_id: string
  species_id: string
  method: 'sound' | 'photo' | 'live'
  confidence: number
  bp: number | null
  bp_base: number | null
  bp_range: number[] | null
  bp_factors: number[] | null
  caught_at: string
  place_name: string | null
  lat: number | null
  lon: number | null
  media_path: string | null
  media_kind: 'image' | 'audio' | null
  created_at: string
  reactions: number | string
  i_reacted: boolean
  new_for_user: boolean
  first_in_group: boolean
  in_feed: boolean
}

export function toFeedPost(row: FeedRow): FeedPost {
  const post: FeedPost = {
    id: row.id,
    userId: row.user_id,
    nickname: row.nickname,
    color: row.color,
    catchId: row.catch_id,
    speciesId: row.species_id,
    method: row.method,
    confidence: row.confidence,
    caughtAt: toMs(row.caught_at),
    createdAt: toMs(row.created_at),
    reactions: Number(row.reactions) || 0,
    iReacted: row.i_reacted === true,
    newForUser: row.new_for_user === true,
    firstInGroup: row.first_in_group === true,
    inFeed: row.in_feed !== false,
  }
  if (row.bp !== null) post.bp = row.bp
  if (row.bp_base !== null) post.bpBase = row.bp_base
  if (row.bp_range && row.bp_range.length === 2) post.bpRange = [row.bp_range[0], row.bp_range[1]]
  if (row.bp_factors && row.bp_factors.length === 5) post.bpFactors = row.bp_factors.map(Number)
  if (row.place_name) post.placeName = row.place_name
  if (row.lat !== null && row.lon !== null) {
    post.lat = row.lat
    post.lon = row.lon
  }
  if (row.media_path && row.media_kind) {
    post.mediaPath = row.media_path
    post.mediaKind = row.media_kind
  }
  return post
}

export function createSupabaseApi(url: string = GROUP_SERVER_URL, key: string = GROUP_SERVER_KEY): GroupApi {
  let clientPromise: Promise<SupabaseClient> | undefined
  const client = (): Promise<SupabaseClient> => {
    clientPromise ??= import('@supabase/supabase-js').then(({ createClient }) =>
      createClient(url, key, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: AUTH_STORAGE_KEY },
      }),
    )
    return clientPromise
  }

  const urlCache = new Map<string, { url: string; until: number }>()
  let sessionPromise: Promise<string> | undefined

  async function session(): Promise<string> {
    const sb = await client()
    try {
      const { data, error } = await sb.auth.getSession()
      if (error) throw toGroupError(error)
      if (data.session) return data.session.user.id
      const signedIn = await sb.auth.signInAnonymously()
      if (signedIn.error || !signedIn.data.user) throw toGroupError(signedIn.error ?? { message: 'no user', code: '28000' })
      return signedIn.data.user.id
    } catch (error) {
      throw toGroupError(error)
    }
  }

  const me = (): Promise<string> => {
    sessionPromise ??= session().catch((error) => {
      sessionPromise = undefined
      throw error
    })
    return sessionPromise
  }

  /** Deletes every picture and clip a member has in a group (leaving, or being removed). */
  async function removeFilesOf(sb: SupabaseClient, groupId: string, userId: string): Promise<void> {
    const folder = `${groupId}/${userId}`
    for (let round = 0; round < 20; round++) {
      const listed = await sb.storage.from(BUCKET).list(folder, { limit: 100 })
      if (listed.error) throw toGroupError(listed.error)
      const names = (listed.data ?? []).filter((file) => file.name).map((file) => `${folder}/${file.name}`)
      if (names.length === 0) return
      const removed = await sb.storage.from(BUCKET).remove(names)
      if (removed.error) throw toGroupError(removed.error)
      if (names.length < 100) return
    }
  }

  return {
    kind: 'supabase',
    session: me,

    async createGroup({ founderCode, name, nickname, color }) {
      await me()
      const sb = await client()
      const rows = check(await sb.rpc('create_group', { p_secret: founderCode, p_name: name, p_nickname: nickname, p_color: color })) as Array<{
        group_id: string
        code: string
      }>
      const row = rows[0]
      if (!row) throw new GroupError('server', 'no group made')
      return { groupId: row.group_id, groupName: name.trim(), code: row.code }
    },

    async joinGroup({ code, nickname, color }) {
      await me()
      const sb = await client()
      const rows = check(await sb.rpc('join_group', { p_code: code, p_nickname: nickname, p_color: color })) as Array<{
        group_id: string
        group_name: string
      }>
      const row = rows[0]
      if (!row) throw new GroupError('no-group')
      return { groupId: row.group_id, groupName: row.group_name }
    },

    async leaveGroup(groupId) {
      const userId = await me()
      const sb = await client()
      await removeFilesOf(sb, groupId, userId)
      check(await sb.rpc('leave_group', { p_group: groupId }))
    },

    async updateProfile(groupId, { nickname, color }) {
      const userId = await me()
      const sb = await client()
      check(await sb.from('members').update({ nickname, color }).eq('group_id', groupId).eq('user_id', userId).select('user_id'))
    },

    async removeMember(groupId, userId) {
      await me()
      const sb = await client()
      await removeFilesOf(sb, groupId, userId)
      check(await sb.rpc('remove_member', { p_group: groupId, p_user: userId }))
    },

    async publish(groupId, post: PostInput, media?: PostMedia) {
      const userId = await me()
      const sb = await client()
      let mediaPath: string | undefined
      if (media) {
        mediaPath = `${groupId}/${userId}/${post.catchId}.${media.ext}`
        const uploaded = await sb.storage.from(BUCKET).upload(mediaPath, media.blob, { contentType: media.contentType, upsert: false })
        if (uploaded.error) {
          const e = uploaded.error as ServerError
          const already = Number(e.statusCode ?? e.status) === 409 || /already exists|duplicate/i.test(e.message ?? '')
          if (!already) throw toGroupError(uploaded.error, true)
        }
      }
      const row = {
        group_id: groupId,
        user_id: userId,
        catch_id: post.catchId,
        species_id: post.speciesId,
        method: post.method,
        confidence: Math.min(1, Math.max(0, post.confidence)),
        bp: post.bp ?? null,
        bp_base: post.bpBase ?? null,
        bp_range: post.bpRange ?? null,
        bp_factors: post.bpFactors ?? null,
        caught_at: new Date(post.caughtAt).toISOString(),
        place_name: post.placeName?.slice(0, 80) ?? null,
        lat: post.lat ?? null,
        lon: post.lon ?? null,
        media_path: mediaPath ?? null,
        media_kind: media ? (media.ext === 'jpg' ? 'image' : 'audio') : null,
        in_feed: post.inFeed !== false,
      }
      const inserted = await sb.from('posts').insert(row).select('id').single()
      if (inserted.error) {
        if ((inserted.error as ServerError).code === '23505') {
          // The same catch was posted before (a retry after a lost answer): that post is the one.
          const found = await sb.from('posts').select('id').eq('group_id', groupId).eq('user_id', userId).eq('catch_id', post.catchId).single()
          return { postId: check(found, true).id as string }
        }
        throw toGroupError(inserted.error, true)
      }
      return { postId: inserted.data.id as string }
    },

    async deletePost(groupId, postId) {
      await me()
      const sb = await client()
      const found = await sb.from('posts').select('media_path').eq('id', postId).eq('group_id', groupId).maybeSingle()
      const path = check(found)?.media_path as string | null | undefined
      if (path) await sb.storage.from(BUCKET).remove([path])
      check(await sb.from('posts').delete().eq('id', postId).eq('group_id', groupId).select('id'))
    },

    async feed(groupId, query: FeedQuery = {}) {
      await me()
      const sb = await client()
      const rows = check(
        await sb.rpc('group_feed', {
          p_group: groupId,
          p_before: query.before ? new Date(query.before).toISOString() : null,
          p_limit: query.limit ?? 20,
          p_user: query.userId ?? null,
          p_new_only: query.newOnly === true,
          p_all: query.all === true,
        }),
      ) as FeedRow[]
      return rows.map(toFeedPost)
    },

    async latest(groupId) {
      const userId = await me()
      const sb = await client()
      const rows = check(
        await sb
          .from('posts')
          .select('created_at')
          .eq('group_id', groupId)
          .neq('user_id', userId)
          .eq('in_feed', true)
          .order('created_at', { ascending: false })
          .limit(1),
      ) as Array<{ created_at: string }>
      return rows[0] ? toMs(rows[0].created_at) : undefined
    },

    async mediaUrls(paths) {
      const sb = await client()
      const now = Date.now()
      const result: Record<string, string> = {}
      const missing: string[] = []
      for (const path of paths) {
        const known = urlCache.get(path)
        if (known && known.until > now) result[path] = known.url
        else missing.push(path)
      }
      if (missing.length > 0) {
        const signed = check(await sb.storage.from(BUCKET).createSignedUrls(missing, SIGNED_URL_SECONDS)) as Array<{
          path: string | null
          signedUrl: string
        }>
        for (const item of signed) {
          if (!item.path || !item.signedUrl) continue
          result[item.path] = item.signedUrl
          urlCache.set(item.path, { url: item.signedUrl, until: now + (SIGNED_URL_SECONDS - 300) * 1000 })
        }
      }
      return result
    },

    async react(postId, on) {
      const userId = await me()
      const sb = await client()
      if (on) {
        const { error } = await sb.from('reactions').insert({ post_id: postId, user_id: userId })
        if (error && (error as ServerError).code !== '23505') throw toGroupError(error)
      } else {
        check(await sb.from('reactions').delete().eq('post_id', postId).eq('user_id', userId).select('post_id'))
      }
    },

    async leaderboard(groupId, board: Board, sinceMs) {
      await me()
      const sb = await client()
      const rows = check(
        await sb.rpc('group_leaderboard', { p_group: groupId, p_board: board, p_since: sinceMs ? new Date(sinceMs).toISOString() : null }),
      ) as Array<{
        user_id: string
        nickname: string
        color: string
        value: number | string
        species_id: string | null
      }>
      return rows.map((row): BoardRow => {
        const out: BoardRow = { userId: row.user_id, nickname: row.nickname, color: row.color, value: Number(row.value) || 0 }
        if (row.species_id) out.speciesId = row.species_id
        return out
      })
    },

    async members(groupId) {
      await me()
      const sb = await client()
      const rows = check(
        await sb
          .from('members')
          .select('user_id, nickname, color, is_admin, joined_at')
          .eq('group_id', groupId)
          .order('joined_at', { ascending: true }),
      ) as Array<{ user_id: string; nickname: string; color: string; is_admin: boolean; joined_at: string }>
      return rows.map(
        (row): MemberRow => ({ userId: row.user_id, nickname: row.nickname, color: row.color, isAdmin: row.is_admin, joinedAt: toMs(row.joined_at) }),
      )
    },
  }
}
