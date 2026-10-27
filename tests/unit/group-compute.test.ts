import { describe, expect, it } from 'vitest'
import { agoText } from '../../src/features/group/ago'
import { boardOf, feedOf, longestRun, periodStart, pragueDay, withRanks, type StoredPost } from '../../src/features/group/compute'
import type { MemberRow } from '../../src/features/group/types'

// What the server works out from the posts (leaderboards, badges, periods), done here the same way for the fake server and the tests.

const HOUR = 3_600_000
const NOW = Date.UTC(2026, 8, 16, 10, 0, 0) // a Wednesday

const member = (userId: string, nickname: string): MemberRow => ({ userId, nickname, color: '#1971C2', isAdmin: false, joinedAt: 1 })
const MEMBERS = [member('a', 'Anna'), member('t', 'Tomáš'), member('z', 'Žaneta')]

let n = 0
const post = (userId: string, speciesId: string, hoursAgo: number, patch: Partial<StoredPost> = {}): StoredPost => ({
  id: `p${++n}`,
  groupId: 'g',
  userId,
  catchId: `c${n}`,
  speciesId,
  method: 'live',
  confidence: 0.9,
  caughtAt: NOW - hoursAgo * HOUR,
  createdAt: NOW - hoursAgo * HOUR,
  ...patch,
})

describe('days', () => {
  it('counts a day in Czechia, not in UTC', () => {
    // 23:30 UTC in summer is already after midnight in Prague.
    expect(pragueDay(Date.UTC(2026, 6, 1, 23, 30))).toBe('2026-07-02')
    expect(pragueDay(Date.UTC(2026, 6, 1, 21, 30))).toBe('2026-07-01')
  })

  it('finds the longest run of days in a list', () => {
    expect(longestRun([])).toBe(0)
    expect(longestRun(['2026-09-01'])).toBe(1)
    expect(longestRun(['2026-09-03', '2026-09-01', '2026-09-02', '2026-09-02', '2026-09-10'])).toBe(3)
    expect(longestRun(['2026-08-31', '2026-09-01', '2026-09-03'])).toBe(2)
    expect(longestRun(['2026-12-31', '2027-01-01'])).toBe(2)
  })

  it('starts a week on Monday and a month on the first, on this clock', () => {
    const wednesday = new Date(2026, 8, 16, 15, 20).getTime()
    expect(periodStart('all', wednesday)).toBeUndefined()
    expect(new Date(periodStart('week', wednesday) as number)).toEqual(new Date(2026, 8, 14))
    expect(new Date(periodStart('month', wednesday) as number)).toEqual(new Date(2026, 8, 1))
    const sunday = new Date(2026, 8, 20, 9).getTime()
    expect(new Date(periodStart('week', sunday) as number)).toEqual(new Date(2026, 8, 14))
  })
})

describe('the leaderboards', () => {
  const posts = [
    post('a', 'parus-major', 50, { bp: 300 }),
    post('a', 'parus-major', 49, { bp: 380 }),
    post('a', 'turdus-merula', 2, { bp: 410 }),
    post('t', 'parus-major', 30, { bp: 500, bpRange: [50, 600] }),
    post('t', 'upupa-epops', 29, { bp: 790 }),
    post('t', 'alcedo-atthis', 28),
  ]

  it('Druhy counts different species and lists everybody, also with nothing', () => {
    const rows = boardOf(MEMBERS, posts, 'species')
    expect(rows.map((row) => [row.nickname, row.value])).toEqual([
      ['Tomáš', 3],
      ['Anna', 2],
      ['Žaneta', 0],
    ])
  })

  it('Úlovky counts every catch', () => {
    expect(boardOf(MEMBERS, posts, 'catches').map((row) => row.value)).toEqual([3, 3, 0])
    // A tie is ordered by nickname, in Czech.
    expect(boardOf(MEMBERS, posts, 'catches').map((row) => row.nickname)).toEqual(['Anna', 'Tomáš', 'Žaneta'])
  })

  it('Nejsilnější takes the highest BP of one bird and says which species it was', () => {
    const rows = boardOf(MEMBERS, posts, 'strongest')
    expect(rows[0]).toMatchObject({ nickname: 'Tomáš', value: 790, speciesId: 'upupa-epops' })
    expect(rows[1]).toMatchObject({ nickname: 'Anna', value: 410, speciesId: 'turdus-merula' })
    expect(rows[2]).toMatchObject({ nickname: 'Žaneta', value: 0 })
    expect(rows[2].speciesId).toBeUndefined()
  })

  it('Série is the longest run of days with a catch', () => {
    const rows = boardOf(MEMBERS, posts, 'streak')
    // Anna: 50 h and 49 h ago are the same or neighbouring days; Tomáš: three posts within 2 hours.
    expect(rows.find((row) => row.nickname === 'Tomáš')?.value).toBe(1)
    expect(rows.find((row) => row.nickname === 'Anna')?.value).toBeGreaterThanOrEqual(1)
    const days = [post('a', 'x', 0), post('a', 'x', 24), post('a', 'x', 48), post('a', 'x', 96)]
    expect(boardOf(MEMBERS, days, 'streak')[0]).toMatchObject({ nickname: 'Anna', value: 3 })
  })

  it('a period counts only what was caught since it began', () => {
    const since = NOW - 24 * HOUR
    const rows = boardOf(MEMBERS, posts, 'catches', since)
    expect(rows.map((row) => [row.nickname, row.value])).toEqual([
      ['Anna', 1],
      ['Tomáš', 0],
      ['Žaneta', 0],
    ])
  })

  it('a tie shares the place and the next place is skipped', () => {
    const ranked = withRanks([{ value: 5 }, { value: 5 }, { value: 3 }, { value: 0 }, { value: 0 }])
    expect(ranked.map((row) => row.rank)).toEqual([1, 1, 3, 4, 4])
  })
})

describe('the feed', () => {
  const context = (reactions: Array<{ postId: string; userId: string }> = []) => ({ members: MEMBERS, reactions, viewerId: 'a' })

  it('lists the newest first and marks the first catch of a species for its member and for the group', () => {
    const first = post('a', 'parus-major', 10)
    const again = post('a', 'parus-major', 5)
    const other = post('t', 'parus-major', 3)
    const feed = feedOf([again, other, first], context())
    expect(feed.map((item) => item.id)).toEqual([other.id, again.id, first.id])
    const byId = Object.fromEntries(feed.map((item) => [item.id, item]))
    expect(byId[first.id]).toMatchObject({ newForUser: true, firstInGroup: true })
    expect(byId[again.id]).toMatchObject({ newForUser: false, firstInGroup: false })
    expect(byId[other.id]).toMatchObject({ newForUser: true, firstInGroup: false })
  })

  it('does not change the badges when only a later page is asked for', () => {
    const first = post('a', 'parus-major', 10)
    const again = post('a', 'parus-major', 5)
    const page = feedOf([first, again], context(), { before: again.createdAt })
    expect(page).toHaveLength(1)
    expect(page[0]).toMatchObject({ id: first.id, newForUser: true, firstInGroup: true })
  })

  it('filters to one member and to new species, and pages by the time of the last post', () => {
    const posts = [post('a', 'parus-major', 10), post('a', 'parus-major', 9), post('t', 'turdus-merula', 8), post('a', 'turdus-merula', 7)]
    expect(feedOf(posts, context(), { userId: 'a' })).toHaveLength(3)
    expect(feedOf(posts, context(), { newOnly: true }).map((item) => item.speciesId)).toEqual(['turdus-merula', 'turdus-merula', 'parus-major'])
    expect(feedOf(posts, context(), { limit: 2 })).toHaveLength(2)
    const second = feedOf(posts, context(), { limit: 2, before: feedOf(posts, context(), { limit: 2 })[1].createdAt })
    expect(second).toHaveLength(2)
  })

  it('counts the reactions and knows which one is mine', () => {
    const one = post('t', 'parus-major', 3)
    const feed = feedOf(
      [one],
      context([
        { postId: one.id, userId: 'a' },
        { postId: one.id, userId: 'z' },
      ]),
    )
    expect(feed[0]).toMatchObject({ reactions: 2, iReacted: true, nickname: 'Tomáš' })
  })

  it('leaves out the posts of somebody who is no longer a member', () => {
    expect(feedOf([post('gone', 'parus-major', 1)], context())).toEqual([])
  })
})

describe('how long ago, in Czech', () => {
  const at = (ms: number) => agoText(NOW - ms, NOW)
  it('says it in the right form', () => {
    expect(at(10_000)).toBe('právě teď')
    expect(at(60_000)).toBe('před minutou')
    expect(at(5 * 60_000)).toBe('před 5 min.')
    expect(at(HOUR)).toBe('před hodinou')
    expect(at(3 * HOUR)).toBe('před 3 hod.')
    expect(at(30 * HOUR)).toBe('včera')
    expect(at(3 * 24 * HOUR)).toBe('před 3 dny')
    expect(at(9 * 24 * HOUR)).toMatch(/^\d{1,2}\. \d{1,2}\. \d{4}$/)
  })
})
