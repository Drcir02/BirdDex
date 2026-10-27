// What the server works out from the posts, as pure functions: the leaderboards, the feed's badges, the periods. The real server
// does this in SQL (supabase/migrations/001_group.sql); the fake server and the tests use these, and the two must agree.

import type { Board, BoardRow, FeedPost, FeedQuery, MemberRow, Period, PostInput } from './types'

/** A post as the fake server keeps it. */
export interface StoredPost extends PostInput {
  id: string
  groupId: string
  userId: string
  createdAt: number
  mediaPath?: string
  mediaKind?: 'image' | 'audio'
}

const PRAGUE_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Prague', year: 'numeric', month: '2-digit', day: '2-digit' })

/** The calendar day of a moment in Czechia, as "2026-09-12". */
export function pragueDay(ms: number): string {
  return PRAGUE_DAY.format(new Date(ms))
}

const dayNumber = (day: string): number => Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10))) / 86_400_000

/** The longest run of consecutive days in a list of days ("2026-09-12"), in any order, with repeats. */
export function longestRun(days: readonly string[]): number {
  const numbers = [...new Set(days.map(dayNumber))].sort((a, b) => a - b)
  let best = 0
  let run = 0
  for (const [index, value] of numbers.entries()) {
    run = index > 0 && value === numbers[index - 1] + 1 ? run + 1 : 1
    best = Math.max(best, run)
  }
  return best
}

/** The start of a period: midnight of the first of the month, or of Monday, on this device's clock. All time has no start. */
export function periodStart(period: Period, now: number = Date.now()): number | undefined {
  if (period === 'all') return undefined
  const date = new Date(now)
  if (period === 'month') return new Date(date.getFullYear(), date.getMonth(), 1).getTime()
  const sinceMonday = (date.getDay() + 6) % 7
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() - sinceMonday).getTime()
}

const byNickname = (a: { nickname: string }, b: { nickname: string }): number => a.nickname.localeCompare(b.nickname, 'cs')

/** One row per member (also with 0), the best first, a tie in the order of the nicknames. */
export function boardOf(members: readonly MemberRow[], posts: readonly StoredPost[], board: Board, sinceMs?: number): BoardRow[] {
  const rows = members.map((member): BoardRow => {
    const mine = posts.filter((post) => post.userId === member.userId && (sinceMs === undefined || post.caughtAt >= sinceMs))
    const row: BoardRow = { userId: member.userId, nickname: member.nickname, color: member.color, value: 0 }
    if (board === 'species') row.value = new Set(mine.map((post) => post.speciesId)).size
    else if (board === 'catches') row.value = mine.length
    else if (board === 'streak') row.value = longestRun(mine.map((post) => pragueDay(post.caughtAt)))
    else {
      const best = mine.filter((post) => post.bp !== undefined).sort((a, b) => (b.bp as number) - (a.bp as number) || a.createdAt - b.createdAt)[0]
      if (best) {
        row.value = best.bp as number
        row.speciesId = best.speciesId
      }
    }
    return row
  })
  return rows.sort((a, b) => b.value - a.value || byNickname(a, b))
}

/** Rows with their place: a tie shares the place and the next place is skipped (1, 1, 3). */
export function withRanks<T extends { value: number }>(rows: readonly T[]): Array<T & { rank: number }> {
  return rows.map((row, index) => {
    const before = rows.findIndex((other) => other.value === row.value)
    return { ...row, rank: before === -1 ? index + 1 : before + 1 }
  })
}

export interface FeedContext {
  members: readonly MemberRow[]
  reactions: ReadonlyArray<{ postId: string; userId: string }>
  viewerId: string
}

/** The page of the feed: newest first, with the badges and the reactions. */
export function feedOf(posts: readonly StoredPost[], context: FeedContext, query: FeedQuery = {}): FeedPost[] {
  const limit = Math.min(50, Math.max(1, query.limit ?? 20))
  const order = (a: StoredPost, b: StoredPost) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1)
  const oldestFirst = [...posts].sort(order)
  const seenByUser = new Set<string>()
  const seenInGroup = new Set<string>()
  const badge = new Map<string, { newForUser: boolean; firstInGroup: boolean }>()
  for (const post of oldestFirst) {
    const key = `${post.userId}|${post.speciesId}`
    badge.set(post.id, { newForUser: !seenByUser.has(key), firstInGroup: !seenInGroup.has(post.speciesId) })
    seenByUser.add(key)
    seenInGroup.add(post.speciesId)
  }
  const out: FeedPost[] = []
  for (const post of oldestFirst.reverse()) {
    if (query.before !== undefined && post.createdAt >= query.before) continue
    if (query.userId && post.userId !== query.userId) continue
    const flags = badge.get(post.id) as { newForUser: boolean; firstInGroup: boolean }
    if (query.newOnly && !flags.newForUser) continue
    const member = context.members.find((m) => m.userId === post.userId)
    if (!member) continue
    const { groupId: _group, ...input } = post
    out.push({
      ...input,
      nickname: member.nickname,
      color: member.color,
      reactions: context.reactions.filter((r) => r.postId === post.id).length,
      iReacted: context.reactions.some((r) => r.postId === post.id && r.userId === context.viewerId),
      ...flags,
    })
    if (out.length >= limit) break
  }
  return out
}
