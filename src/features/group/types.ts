// The group feature talks to a server through this one interface (GroupApi). The real one (supabaseApi.ts) speaks to Supabase;
// the fake one (fakeApi.ts) lives in memory, for tests and for trying the screens without a server. See docs/notes/group-feed-design.md.

export type PlaceMode = 'exact' | 'name' | 'none'
export const PLACE_MODES: readonly PlaceMode[] = ['exact', 'name', 'none']

/** The leaderboards: different species, the strongest bird (highest BP), how many catches, the longest run of days. */
export type Board = 'species' | 'strongest' | 'catches' | 'streak'
export const BOARDS: readonly Board[] = ['species', 'strongest', 'catches', 'streak']

export type Period = 'all' | 'month' | 'week'
export const PERIODS: readonly Period[] = ['all', 'month', 'week']

/** What a phone sends about one catch. Times are milliseconds since 1970. */
export interface PostInput {
  catchId: string
  speciesId: string
  method: 'sound' | 'photo' | 'live'
  confidence: number
  bp?: number
  bpBase?: number
  bpRange?: [number, number]
  bpFactors?: number[]
  caughtAt: number
  placeName?: string
  lat?: number
  lon?: number
}

/** The picture (a small JPEG) or the clip (a WAV) of a post. */
export interface PostMedia {
  blob: Blob
  contentType: 'image/jpeg' | 'audio/wav'
  ext: 'jpg' | 'wav'
}

/** A post as the feed shows it. */
export interface FeedPost extends PostInput {
  id: string
  userId: string
  nickname: string
  color: string
  mediaPath?: string
  mediaKind?: 'image' | 'audio'
  createdAt: number
  reactions: number
  iReacted: boolean
  /** The first post of this species by this member. */
  newForUser: boolean
  /** The first post of this species in the whole group. */
  firstInGroup: boolean
}

export interface FeedQuery {
  /** Only posts made before this moment (the `createdAt` of the last post of the page before). */
  before?: number
  limit?: number
  /** Only the posts of this member. */
  userId?: string
  /** Only the posts that are the first of their species for their member. */
  newOnly?: boolean
}

export interface BoardRow {
  userId: string
  nickname: string
  color: string
  value: number
  /** The species of the strongest bird (board "strongest"). */
  speciesId?: string
}

export interface MemberRow {
  userId: string
  nickname: string
  color: string
  isAdmin: boolean
  joinedAt: number
}

export type GroupErrorKind = 'network' | 'auth' | 'wrong-founder-code' | 'no-group' | 'name-taken' | 'full' | 'rejected' | 'server'

/** Something the server refused or could not do. `network` means: try again later. */
export class GroupError extends Error {
  readonly kind: GroupErrorKind
  constructor(kind: GroupErrorKind, message?: string, options?: { cause?: unknown }) {
    super(message ?? kind, options)
    this.name = 'GroupError'
    this.kind = kind
  }
}

export interface GroupApi {
  readonly kind: 'supabase' | 'fake'
  /** Signs in (anonymously, once) and returns the id of this phone. */
  session(): Promise<string>
  createGroup(input: { founderCode: string; name: string; nickname: string; color: string }): Promise<{ groupId: string; groupName: string; code: string }>
  joinGroup(input: { code: string; nickname: string; color: string }): Promise<{ groupId: string; groupName: string }>
  /** Leaves the group; the member's posts and pictures go with them. */
  leaveGroup(groupId: string): Promise<void>
  updateProfile(groupId: string, profile: { nickname: string; color: string }): Promise<void>
  removeMember(groupId: string, userId: string): Promise<void>
  publish(groupId: string, post: PostInput, media?: PostMedia): Promise<{ postId: string }>
  deletePost(groupId: string, postId: string): Promise<void>
  feed(groupId: string, query?: FeedQuery): Promise<FeedPost[]>
  /** The newest post of somebody else: for the red dot. */
  latest(groupId: string): Promise<number | undefined>
  /** Short-lived addresses of pictures and clips by their paths. */
  mediaUrls(paths: readonly string[]): Promise<Record<string, string>>
  react(postId: string, on: boolean): Promise<void>
  leaderboard(groupId: string, board: Board, sinceMs?: number): Promise<BoardRow[]>
  members(groupId: string): Promise<MemberRow[]>
}
