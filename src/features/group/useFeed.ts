import { useCallback, useEffect, useRef, useState } from 'react'
import { getGroupApi } from './api'
import { readFeedCache, writeFeedCache } from './feedCache'
import { markSeen } from './useGroupSync'
import { useMembership } from './state'
import { GroupError, type FeedPost } from './types'

export type FeedFilter = 'all' | 'new' | 'mine'
export const PAGE_SIZE = 20
const POLL_MS = 60_000

/** The first page of fresh posts in front of the older pages that were loaded before. */
export function mergeFirstPage(previous: readonly FeedPost[], fresh: readonly FeedPost[]): FeedPost[] {
  if (fresh.length < PAGE_SIZE) return [...fresh]
  const oldest = fresh[fresh.length - 1].createdAt
  const ids = new Set(fresh.map((post) => post.id))
  return [...fresh, ...previous.filter((post) => post.createdAt < oldest && !ids.has(post.id))]
}

export interface FeedState {
  posts: FeedPost[]
  /** Nothing has arrived yet. */
  loading: boolean
  /** The last try failed for lack of a connection (the posts shown are the ones seen before). */
  offline: boolean
  failed: boolean
  hasMore: boolean
  loadingMore: boolean
  refresh: () => void
  loadMore: () => void
  /** Gives or takes back a Super, at once on the screen; undone if the server says no. Resolves false on failure. */
  react: (postId: string, on: boolean) => Promise<boolean>
  /** Takes a deleted post off the screen. */
  drop: (postId: string) => void
}

/** The feed of the group: first page, more pages, a refresh every minute while the app is visible, and a copy for offline use. */
export function useFeed(filter: FeedFilter, refreshSignal = 0): FeedState {
  const membership = useMembership()
  const groupId = membership?.groupId
  const userId = membership?.userId
  const [posts, setPosts] = useState<FeedPost[]>(() => (groupId && filter === 'all' ? readFeedCache(groupId) : []))
  const [loading, setLoading] = useState(true)
  const [offline, setOffline] = useState(false)
  const [failed, setFailed] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [tick, setTick] = useState(0)
  const postsRef = useRef(posts)
  postsRef.current = posts

  useEffect(() => {
    if (!groupId) return
    let alive = true
    const query = { limit: PAGE_SIZE, newOnly: filter === 'new', userId: filter === 'mine' ? userId : undefined }
    const run = async () => {
      try {
        const api = await getGroupApi()
        const fresh = await api.feed(groupId, query)
        if (!alive) return
        setPosts((previous) => mergeFirstPage(previous, fresh))
        setHasMore(fresh.length >= PAGE_SIZE)
        setOffline(false)
        setFailed(false)
        if (filter === 'all') {
          writeFeedCache(groupId, fresh)
          const others = fresh.filter((post) => post.userId !== userId)
          if (others.length > 0) markSeen(Math.max(...others.map((post) => post.createdAt)))
        }
      } catch (error) {
        if (!alive) return
        if (error instanceof GroupError && error.kind === 'network') setOffline(true)
        else setFailed(true)
      } finally {
        if (alive) setLoading(false)
      }
    }
    setLoading(true)
    void run()
    const interval = setInterval(() => {
      if (document.visibilityState !== 'hidden') void run()
    }, POLL_MS)
    return () => {
      alive = false
      clearInterval(interval)
    }
  }, [groupId, userId, filter, tick, refreshSignal])

  // A new filter starts from its own list (the cache only stands for "all").
  const [shownFilter, setShownFilter] = useState(filter)
  if (shownFilter !== filter) {
    setShownFilter(filter)
    setPosts(groupId && filter === 'all' ? readFeedCache(groupId) : [])
    setHasMore(false)
  }

  const refresh = useCallback(() => setTick((value) => value + 1), [])

  const loadMore = useCallback(() => {
    const current = postsRef.current
    if (!groupId || loadingMore || current.length === 0) return
    setLoadingMore(true)
    void (async () => {
      try {
        const api = await getGroupApi()
        const older = await api.feed(groupId, {
          limit: PAGE_SIZE,
          before: current[current.length - 1].createdAt,
          newOnly: filter === 'new',
          userId: filter === 'mine' ? userId : undefined,
        })
        setPosts((previous) => {
          const ids = new Set(previous.map((post) => post.id))
          return [...previous, ...older.filter((post) => !ids.has(post.id))]
        })
        setHasMore(older.length >= PAGE_SIZE)
        setOffline(false)
      } catch (error) {
        if (error instanceof GroupError && error.kind === 'network') setOffline(true)
      } finally {
        setLoadingMore(false)
      }
    })()
  }, [groupId, userId, filter, loadingMore])

  const react = useCallback(async (postId: string, on: boolean) => {
    const set = (flag: boolean) =>
      setPosts((previous) =>
        previous.map((post) =>
          post.id === postId && post.iReacted !== flag ? { ...post, iReacted: flag, reactions: Math.max(0, post.reactions + (flag ? 1 : -1)) } : post,
        ),
      )
    set(on)
    try {
      const api = await getGroupApi()
      await api.react(postId, on)
      return true
    } catch {
      set(!on)
      return false
    }
  }, [])

  const drop = useCallback((postId: string) => setPosts((previous) => previous.filter((post) => post.id !== postId)), [])

  return { posts, loading: loading && posts.length === 0, offline, failed, hasMore, loadingMore, refresh, loadMore, react, drop }
}

/** The addresses of the pictures and clips of the posts on the screen (they are short-lived, so they are asked for again with every refresh). */
export function useMediaUrls(posts: readonly FeedPost[]): Record<string, string> {
  const [urls, setUrls] = useState<Record<string, string>>({})
  const key = posts.map((post) => post.mediaPath ?? '').join('|')
  // The addresses last an hour: ask again before they run out.
  const [round, setRound] = useState(0)
  useEffect(() => {
    const interval = setInterval(() => setRound((value) => value + 1), 45 * 60_000)
    return () => clearInterval(interval)
  }, [])
  useEffect(() => {
    const paths = posts.map((post) => post.mediaPath).filter((path): path is string => !!path)
    if (paths.length === 0) return
    let alive = true
    void getGroupApi()
      .then((api) => api.mediaUrls(paths))
      .then((found) => {
        if (alive) setUrls((previous) => ({ ...previous, ...found }))
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [key, round])
  return urls
}
