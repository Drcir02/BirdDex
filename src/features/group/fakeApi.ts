// A group server that lives in memory, for tests and for trying the screens without a server (?group=fake). It follows the same
// rules as the real one (supabase/migrations/001_group.sql): codes, unique nicknames, only members read, the badges and boards of
// compute.ts. It starts with one group, "Rodina" (code RODINA23), with three members who have caught a few birds.
// The state is kept in localStorage (without the pictures) so that a reload in a browser test is still in the same group.

import { boardOf, feedOf, type StoredPost } from './compute'
import { GroupError, type GroupApi, type MemberRow, type PostMedia } from './types'

export const FAKE_STORAGE_KEY = 'birddex:fake-group-server'
export const FAKE_FOUNDER_CODE = 'TESTFOUNDER'
export const FAKE_GROUP_CODE = 'RODINA23'
export const FAKE_GROUP_NAME = 'Rodina'

interface FakeGroup {
  id: string
  name: string
  code: string
}

interface FakeMember extends MemberRow {
  groupId: string
}

interface FakeData {
  groups: FakeGroup[]
  members: FakeMember[]
  posts: StoredPost[]
  reactions: Array<{ postId: string; userId: string }>
  counter: number
}

export const FAKE_MEMBERS = [
  { userId: 'fake-tomas', nickname: 'Tomáš', color: '#E8590C' },
  { userId: 'fake-anna', nickname: 'Anna', color: '#2F9E44' },
  { userId: 'fake-jirka', nickname: 'Jirka', color: '#7048E8' },
] as const

const HOUR = 3_600_000

/** A small picture for the seeded posts that have one: a coloured card, so tests and demos need no files. */
export function fakePictureUrl(label: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 540"><rect width="720" height="540" fill="#5b8c5a"/><circle cx="360" cy="230" r="120" fill="#f1e4b3"/><text x="360" y="450" font-size="48" text-anchor="middle" fill="#fff" font-family="sans-serif">${label}</text></svg>`
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

function seed(now: number): FakeData {
  const groupId = 'fake-group-rodina'
  const members: FakeMember[] = FAKE_MEMBERS.map((member, index) => ({
    ...member,
    groupId,
    isAdmin: index === 0,
    joinedAt: now - (30 - index) * 24 * HOUR,
  }))
  let n = 0
  const post = (
    user: string,
    hoursAgo: number,
    speciesId: string,
    method: 'sound' | 'photo' | 'live',
    bp: number,
    range: [number, number],
    extra: Partial<StoredPost> = {},
  ): StoredPost => ({
    id: `fake-post-${++n}`,
    groupId,
    userId: user,
    catchId: `seed-${n}`,
    speciesId,
    method,
    confidence: 0.9,
    bp,
    bpRange: range,
    caughtAt: now - hoursAgo * HOUR,
    createdAt: now - hoursAgo * HOUR,
    ...extra,
  })
  const posts: StoredPost[] = [
    post('fake-tomas', 120, 'parus-major', 'live', 380, [50, 500], {
      placeName: 'Praha, Stromovka',
      lat: 50.1054,
      lon: 14.4262,
    }),
    post('fake-anna', 100, 'turdus-merula', 'sound', 421, [50, 600], {
      placeName: 'Brno',
    }),
    post('fake-jirka', 80, 'parus-major', 'photo', 250, [50, 500], {
      mediaPath: 'seed/jirka-parus.svg',
      mediaKind: 'image',
    }),
    post('fake-tomas', 49, 'erithacus-rubecula', 'sound', 455, [50, 510], {
      placeName: 'Praha',
    }),
    post('fake-anna', 30, 'upupa-epops', 'live', 790, [300, 850], {
      placeName: 'Znojmo',
      lat: 48.8555,
      lon: 16.0488,
      mediaPath: 'seed/anna-upupa.svg',
      mediaKind: 'image',
    }),
    post('fake-tomas', 40, 'parus-major', 'photo', 410, [50, 500], { placeName: 'Praha' }),
    post('fake-tomas', 25, 'alcedo-atthis', 'live', 560, [50, 600], {
      placeName: 'Praha, Vltava',
      lat: 50.0755,
      lon: 14.4378,
      mediaPath: 'seed/tomas-alcedo.svg',
      mediaKind: 'image',
    }),
    post('fake-jirka', 5, 'turdus-merula', 'live', 530, [50, 600], {
      placeName: 'Plzeň',
    }),
    post('fake-anna', 2, 'cyanistes-caeruleus', 'photo', 300, [50, 480], {
      placeName: 'Brno',
    }),
  ]
  return {
    groups: [{ id: groupId, name: FAKE_GROUP_NAME, code: FAKE_GROUP_CODE }],
    members,
    posts,
    reactions: [
      { postId: 'fake-post-5', userId: 'fake-tomas' },
      { postId: 'fake-post-5', userId: 'fake-jirka' },
      { postId: 'fake-post-6', userId: 'fake-anna' },
    ],
    counter: 100,
  }
}

export interface FakeOptions {
  /** The id of this phone. Default: a stored one, made once. */
  userId?: string
  now?: () => number
  /** Keep the state in localStorage (default true in a browser). Unit tests pass false. */
  persist?: boolean
  /** Wait this long before every answer, in ms (to see the loading states). */
  delayMs?: number
}

/** The fake server, with a few extra handles for tests. */
export interface FakeGroupApi extends GroupApi {
  readonly kind: 'fake'
  /** While false every call fails like a phone without a connection. */
  online: boolean
  /** Another member posts something now (for the red dot and polling tests). */
  addPostBy(userId: string, speciesId: string, extra?: Partial<StoredPost>): StoredPost
  /** The same server as seen by another phone (for example the admin), to test what one does to the other. */
  as(userId: string): FakeGroupApi
  /** The posts and members as they are now (copies). */
  snapshot(): {
    members: FakeMember[]
    posts: StoredPost[]
    groups: FakeGroup[]
  }
}

export function createFakeApi(options: FakeOptions = {}): FakeGroupApi {
  const now = options.now ?? Date.now
  const persist = options.persist ?? typeof localStorage !== 'undefined'
  const media = new Map<string, string>()

  const load = (): FakeData => {
    if (persist) {
      try {
        const raw = localStorage.getItem(FAKE_STORAGE_KEY)
        if (raw) return JSON.parse(raw) as FakeData
      } catch {
        // Start again from the seed.
      }
    }
    return seed(now())
  }
  const data = load()
  const save = () => {
    if (!persist) return
    try {
      localStorage.setItem(FAKE_STORAGE_KEY, JSON.stringify(data))
    } catch {
      // Memory only.
    }
  }

  const ownId = (() => {
    if (options.userId) return options.userId
    if (!persist) return 'fake-me'
    try {
      const stored = localStorage.getItem('birddex:fake-user')
      if (stored) return stored
      const made = `fake-me-${Math.random().toString(36).slice(2, 8)}`
      localStorage.setItem('birddex:fake-user', made)
      return made
    } catch {
      return 'fake-me'
    }
  })()

  /** The server as one phone sees it. The others of a test share the same data. */
  const view = (userId: string): FakeGroupApi => {
    const gate = async (): Promise<void> => {
      if (options.delayMs) await new Promise((resolve) => setTimeout(resolve, options.delayMs))
      if (!api.online) throw new GroupError('network', 'offline')
    }
    const memberOf = (groupId: string, who: string = userId): FakeMember | undefined =>
      data.members.find((m) => m.groupId === groupId && m.userId === who)
    const requireMember = (groupId: string): FakeMember => {
      const member = memberOf(groupId)
      if (!member) throw new GroupError('removed', 'not a member')
      return member
    }
    const membersOf = (groupId: string): FakeMember[] => data.members.filter((m) => m.groupId === groupId)
    const nameTaken = (groupId: string, nickname: string, except?: string): boolean =>
      membersOf(groupId).some((m) => m.userId !== except && m.nickname.trim().toLowerCase() === nickname.trim().toLowerCase())
    const checkNickname = (nickname: string) => {
      const trimmed = nickname.trim()
      if (trimmed.length < 1 || trimmed.length > 24) throw new GroupError('rejected', 'nickname length')
    }
    const newCode = (): string => {
      const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
      for (;;) {
        const code = Array.from({ length: 8 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('')
        if (!data.groups.some((g) => g.code === code)) return code
      }
    }
    const publicMember = ({ userId: id, nickname, color, isAdmin, joinedAt }: FakeMember): MemberRow => ({
      userId: id,
      nickname,
      color,
      isAdmin,
      joinedAt,
    })

    const api: FakeGroupApi = {
      kind: 'fake',
      online: true,

      as: (other: string) => view(other),

      async session() {
        await gate()
        return userId
      },

      async createGroup({ founderCode, name, nickname, color }: { founderCode: string; name: string; nickname: string; color: string }) {
        await gate()
        if (founderCode.trim().toUpperCase() !== FAKE_FOUNDER_CODE) throw new GroupError('wrong-founder-code')
        checkNickname(nickname)
        const group: FakeGroup = {
          id: `fake-group-${++data.counter}`,
          name: name.trim(),
          code: newCode(),
        }
        data.groups.push(group)
        data.members.push({
          groupId: group.id,
          userId,
          nickname: nickname.trim(),
          color,
          isAdmin: true,
          joinedAt: now(),
        })
        save()
        return { groupId: group.id, groupName: group.name, code: group.code }
      },

      async joinGroup({ code, nickname, color }: { code: string; nickname: string; color: string }) {
        await gate()
        const group = data.groups.find((g) => g.code === code.replace(/[^A-Za-z0-9]/g, '').toUpperCase())
        if (!group) throw new GroupError('no-group')
        checkNickname(nickname)
        const existing = memberOf(group.id)
        if (!existing && membersOf(group.id).length >= 60) throw new GroupError('full')
        if (nameTaken(group.id, nickname, userId)) throw new GroupError('name-taken')
        if (existing) Object.assign(existing, { nickname: nickname.trim(), color })
        else
          data.members.push({
            groupId: group.id,
            userId,
            nickname: nickname.trim(),
            color,
            isAdmin: false,
            joinedAt: now(),
          })
        save()
        return { groupId: group.id, groupName: group.name }
      },

      async leaveGroup(groupId: string) {
        await gate()
        const me = memberOf(groupId)
        if (!me) return
        data.members = data.members.filter((m) => m !== me)
        const mine = new Set(data.posts.filter((p) => p.groupId === groupId && p.userId === userId).map((p) => p.id))
        data.posts = data.posts.filter((p) => !mine.has(p.id))
        data.reactions = data.reactions.filter((r) => !mine.has(r.postId))
        const rest = membersOf(groupId)
        if (rest.length === 0) data.groups = data.groups.filter((g) => g.id !== groupId)
        else if (me.isAdmin && !rest.some((m) => m.isAdmin)) rest.sort((a, b) => a.joinedAt - b.joinedAt)[0].isAdmin = true
        save()
      },

      async updateProfile(groupId: string, { nickname, color }: { nickname: string; color: string }) {
        await gate()
        const me = requireMember(groupId)
        checkNickname(nickname)
        if (nameTaken(groupId, nickname, userId)) throw new GroupError('name-taken')
        Object.assign(me, { nickname: nickname.trim(), color })
        save()
      },

      async removeMember(groupId: string, who: string) {
        await gate()
        if (!requireMember(groupId).isAdmin) throw new GroupError('rejected', 'only the admin')
        if (who === userId) throw new GroupError('rejected', 'use leave')
        data.members = data.members.filter((m) => !(m.groupId === groupId && m.userId === who))
        const theirs = new Set(data.posts.filter((p) => p.groupId === groupId && p.userId === who).map((p) => p.id))
        data.posts = data.posts.filter((p) => !theirs.has(p.id))
        data.reactions = data.reactions.filter((r) => !theirs.has(r.postId))
        save()
      },

      async publish(groupId: string, post: Parameters<GroupApi['publish']>[1], file?: PostMedia) {
        await gate()
        requireMember(groupId)
        if (post.caughtAt > now() + 24 * HOUR || post.caughtAt < now() - 366 * 24 * HOUR) throw new GroupError('rejected', 'date')
        if (post.bp !== undefined && post.bpRange && (post.bp < post.bpRange[0] || post.bp > post.bpRange[1])) throw new GroupError('rejected', 'bp')
        const same = data.posts.find((p) => p.groupId === groupId && p.userId === userId && p.catchId === post.catchId)
        if (same) return { postId: same.id }
        const stored: StoredPost = {
          ...post,
          id: `fake-post-${++data.counter}`,
          groupId,
          userId,
          createdAt: now(),
        }
        if (file) {
          stored.mediaPath = `${groupId}/${userId}/${post.catchId}.${file.ext}`
          stored.mediaKind = file.ext === 'jpg' ? 'image' : 'audio'
          media.set(stored.mediaPath, URL.createObjectURL(file.blob))
        }
        data.posts.push(stored)
        save()
        return { postId: stored.id }
      },

      async deletePost(groupId: string, postId: string) {
        await gate()
        const me = requireMember(groupId)
        const post = data.posts.find((p) => p.id === postId && p.groupId === groupId)
        if (!post) return
        if (post.userId !== userId && !me.isAdmin) throw new GroupError('rejected', 'not yours')
        data.posts = data.posts.filter((p) => p !== post)
        data.reactions = data.reactions.filter((r) => r.postId !== postId)
        save()
      },

      async feed(groupId: string, query = {}) {
        await gate()
        requireMember(groupId)
        const posts = data.posts.filter((p) => p.groupId === groupId)
        return feedOf(
          posts,
          {
            members: membersOf(groupId).map(publicMember),
            reactions: data.reactions,
            viewerId: userId,
          },
          query,
        )
      },

      async latest(groupId: string) {
        await gate()
        requireMember(groupId)
        const others = data.posts.filter((p) => p.groupId === groupId && p.userId !== userId)
        return others.length ? Math.max(...others.map((p) => p.createdAt)) : undefined
      },

      async mediaUrls(paths: readonly string[]) {
        await gate()
        const out: Record<string, string> = {}
        for (const path of paths) {
          const known = media.get(path)
          if (known) out[path] = known
          else if (path.startsWith('seed/')) out[path] = fakePictureUrl(path.replace(/^seed\/|\.svg$/g, ''))
        }
        return out
      },

      async react(postId: string, on: boolean) {
        await gate()
        const post = data.posts.find((p) => p.id === postId)
        if (!post) throw new GroupError('rejected', 'no such post')
        requireMember(post.groupId)
        data.reactions = data.reactions.filter((r) => !(r.postId === postId && r.userId === userId))
        if (on) data.reactions.push({ postId, userId })
        save()
      },

      async leaderboard(groupId: string, board: Parameters<GroupApi['leaderboard']>[1], sinceMs?: number) {
        await gate()
        requireMember(groupId)
        return boardOf(
          membersOf(groupId).map(publicMember),
          data.posts.filter((p) => p.groupId === groupId),
          board,
          sinceMs,
        )
      },

      async members(groupId: string) {
        await gate()
        requireMember(groupId)
        return membersOf(groupId)
          .sort((a, b) => a.joinedAt - b.joinedAt)
          .map(publicMember)
      },

      addPostBy(who: string, speciesId: string, extra: Partial<StoredPost> = {}) {
        const group = data.groups[0]
        const stored: StoredPost = {
          id: `fake-post-${++data.counter}`,
          groupId: group.id,
          userId: who,
          catchId: `extra-${data.counter}`,
          speciesId,
          method: 'live',
          confidence: 0.9,
          bp: 400,
          bpRange: [50, 600],
          caughtAt: now(),
          createdAt: now(),
          ...extra,
        }
        data.posts.push(stored)
        save()
        return stored
      },

      snapshot() {
        return structuredClone({
          members: data.members,
          posts: data.posts,
          groups: data.groups,
        })
      },
    }
    return api
  }
  return view(ownId)
}
