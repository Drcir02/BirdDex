// The first page of the feed, kept in localStorage so that the feed also shows (what it saw last) without a connection.
import type { FeedPost } from './types'

const KEY = 'birddex:group:feed'

export function readFeedCache(groupId: string): FeedPost[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as { groupId?: string; posts?: FeedPost[] } | null
    return raw && raw.groupId === groupId && Array.isArray(raw.posts) ? raw.posts : []
  } catch {
    return []
  }
}

export function writeFeedCache(groupId: string, posts: readonly FeedPost[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ groupId, posts: posts.slice(0, 20) }))
  } catch {
    // Not kept.
  }
}

export function clearFeedCache(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // Nothing to clear.
  }
}
