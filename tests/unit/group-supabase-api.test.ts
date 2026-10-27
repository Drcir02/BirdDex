import { describe, expect, it } from 'vitest'
import { toFeedPost, toGroupError } from '../../src/features/group/supabaseApi'
import { GroupError } from '../../src/features/group/types'

// What the real server says, turned into what the screens understand. (The real server itself is tested by scripts/group-smoke-test.mjs.)

describe('errors from the server', () => {
  const kind = (error: unknown, posting = false) => toGroupError(error, posting).kind
  it('knows the codes of the functions of the server', () => {
    expect(kind({ code: '28P01', message: 'wrong founder code' })).toBe('wrong-founder-code')
    expect(kind({ code: 'P0002', message: 'no such group' })).toBe('no-group')
    expect(kind({ code: '53400', message: 'the group is full' })).toBe('full')
    expect(kind({ code: '23505', message: 'the nickname is taken' })).toBe('name-taken')
    expect(kind({ code: '28000' })).toBe('auth')
    expect(kind({ code: 'PGRST301' })).toBe('auth')
    expect(kind({ code: '22023' })).toBe('rejected')
    expect(kind({ code: '23514' })).toBe('rejected')
  })

  it('says "removed" when a member who is gone posts', () => {
    expect(kind({ code: '42501' }, true)).toBe('removed')
    expect(kind({ code: '23503' }, true)).toBe('removed')
    expect(kind({ code: '42501' }, false)).toBe('rejected')
  })

  it('tells a lost connection from a broken server', () => {
    expect(kind({ message: 'TypeError: Failed to fetch' })).toBe('network')
    expect(kind({ name: 'AuthRetryableFetchError', message: 'x' })).toBe('network')
    expect(kind({ message: 'Load failed' })).toBe('network')
    expect(kind({ message: 'boom', status: 500 })).toBe('server')
    expect(kind({ message: 'unauthorized', status: 401 })).toBe('auth')
  })

  it('leaves a GroupError as it is', () => {
    const own = new GroupError('full')
    expect(toGroupError(own)).toBe(own)
  })
})

describe('a row of the feed', () => {
  const row = {
    id: 'p1',
    user_id: 'u1',
    nickname: 'Anna',
    color: '#2F9E44',
    catch_id: 'c1',
    species_id: 'upupa-epops',
    method: 'live' as const,
    confidence: 0.91,
    bp: 790,
    bp_base: 700,
    bp_range: [300, 850],
    bp_factors: [0.8, 1, 0.7, 1, 1],
    caught_at: '2026-09-16T08:00:00+00:00',
    place_name: 'Znojmo',
    lat: 48.8555,
    lon: 16.0488,
    media_path: 'g/u1/c1.jpg',
    media_kind: 'image' as const,
    created_at: '2026-09-16T08:00:05+00:00',
    reactions: '3',
    i_reacted: true,
    new_for_user: true,
    first_in_group: false,
  }

  it('becomes a post with times in milliseconds and the optional parts only when there', () => {
    const post = toFeedPost(row)
    expect(post).toMatchObject({
      id: 'p1',
      userId: 'u1',
      speciesId: 'upupa-epops',
      bp: 790,
      bpRange: [300, 850],
      reactions: 3,
      iReacted: true,
      newForUser: true,
      firstInGroup: false,
    })
    expect(post.caughtAt).toBe(Date.UTC(2026, 8, 16, 8))
    expect(post).toMatchObject({ lat: 48.8555, lon: 16.0488, mediaPath: 'g/u1/c1.jpg', mediaKind: 'image' })
    const bare = toFeedPost({
      ...row,
      bp: null,
      bp_base: null,
      bp_range: null,
      bp_factors: null,
      place_name: null,
      lat: null,
      lon: null,
      media_path: null,
      media_kind: null,
    })
    expect(bare.bp).toBeUndefined()
    expect(bare.bpRange).toBeUndefined()
    expect(bare.placeName).toBeUndefined()
    expect(bare.lat).toBeUndefined()
    expect(bare.mediaPath).toBeUndefined()
  })
})
