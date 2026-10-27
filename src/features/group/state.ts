// What this phone knows about its group: which one it is in, under which nickname, and how it shares. Kept in localStorage.
// A phone is in at most one group. Nothing here is a secret: the identity itself (an anonymous sign-in) is kept by the server client.

import { useSyncExternalStore } from 'react'
import { PLACE_MODES, type PlaceMode } from './types'

export const GROUP_KEY = 'birddex:group'

export interface Membership {
  groupId: string
  groupName: string
  /** The invite code, shown to the admin and used to join again. */
  code: string
  nickname: string
  color: string
  /** The id the server gave this phone. When the sign-in is lost the id changes, and the phone must join again. */
  userId: string
  isAdmin: boolean
  joinedAt: number
}

export interface GroupPrefs {
  /** Catches are shared by themselves (each can be hidden on the success screen). */
  autoShare: boolean
  /** How much of the place is shared. */
  place: PlaceMode
  /** The newest post of somebody else that the person has seen, for the red dot (ms since 1970). */
  seenAt: number
}

export interface GroupState {
  membership?: Membership
  prefs: GroupPrefs
}

export const DEFAULT_PREFS: Readonly<GroupPrefs> = Object.freeze({ autoShare: true, place: 'exact', seenAt: 0 })

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null
const text = (value: unknown, max: number): string | undefined => (typeof value === 'string' && value.length > 0 && value.length <= max ? value : undefined)

/** Turns whatever was stored into a valid state: a broken membership is dropped, a broken preference falls back to its default. */
export function sanitizeGroupState(value: unknown): GroupState {
  const source = isObject(value) ? value : {}
  const prefsSource = isObject(source.prefs) ? source.prefs : {}
  const prefs: GroupPrefs = {
    autoShare: typeof prefsSource.autoShare === 'boolean' ? prefsSource.autoShare : DEFAULT_PREFS.autoShare,
    place: PLACE_MODES.includes(prefsSource.place as PlaceMode) ? (prefsSource.place as PlaceMode) : DEFAULT_PREFS.place,
    seenAt: typeof prefsSource.seenAt === 'number' && Number.isFinite(prefsSource.seenAt) ? prefsSource.seenAt : DEFAULT_PREFS.seenAt,
  }
  const m = isObject(source.membership) ? source.membership : undefined
  const membership =
    m &&
    text(m.groupId, 60) &&
    text(m.groupName, 60) &&
    text(m.code, 20) &&
    text(m.nickname, 40) &&
    text(m.color, 9) &&
    text(m.userId, 60) &&
    typeof m.joinedAt === 'number'
      ? ({
          groupId: m.groupId as string,
          groupName: m.groupName as string,
          code: m.code as string,
          nickname: m.nickname as string,
          color: m.color as string,
          userId: m.userId as string,
          isAdmin: m.isAdmin === true,
          joinedAt: m.joinedAt as number,
        } satisfies Membership)
      : undefined
  return membership ? { membership, prefs } : { prefs }
}

function readStored(): GroupState {
  try {
    const raw = localStorage.getItem(GROUP_KEY)
    return sanitizeGroupState(raw ? JSON.parse(raw) : undefined)
  } catch {
    return sanitizeGroupState(undefined)
  }
}

let current: GroupState | undefined
const listeners = new Set<() => void>()
const notify = () => listeners.forEach((listener) => listener())

export function getGroupState(): GroupState {
  current ??= readStored()
  return current
}

function save(next: GroupState): void {
  current = next
  try {
    localStorage.setItem(GROUP_KEY, JSON.stringify(next))
  } catch {
    // Kept in memory only.
  }
  notify()
}

export const getMembership = (): Membership | undefined => getGroupState().membership

export function setMembership(membership: Membership): void {
  save(sanitizeGroupState({ ...getGroupState(), membership }))
}

/** Leaves the group on this phone (the server is told by leaveGroup). The preferences stay. */
export function clearMembership(): void {
  save({ prefs: getGroupState().prefs })
}

export function updateMembership(patch: Partial<Pick<Membership, 'nickname' | 'color' | 'isAdmin'>>): void {
  const { membership } = getGroupState()
  if (membership) setMembership({ ...membership, ...patch })
}

export function updatePrefs(patch: Partial<GroupPrefs>): GroupPrefs {
  const state = getGroupState()
  const next = sanitizeGroupState({ ...state, prefs: { ...state.prefs, ...patch } })
  save(next)
  return next.prefs
}

function onStorage(event: StorageEvent) {
  if (event.key !== null && event.key !== GROUP_KEY) return
  current = readStored()
  notify()
}

export function subscribeGroupState(listener: () => void): () => void {
  if (listeners.size === 0 && typeof window !== 'undefined') window.addEventListener('storage', onStorage)
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0 && typeof window !== 'undefined') window.removeEventListener('storage', onStorage)
  }
}

/** For tests: forget what was loaded, so the next read starts from storage again. */
export function reloadGroupStateForTests(): void {
  current = undefined
  notify()
}

export function useGroupState(): GroupState {
  return useSyncExternalStore(subscribeGroupState, getGroupState)
}

export function useMembership(): Membership | undefined {
  return useGroupState().membership
}

/** The invite link of a group: opening it joins that group. */
export function inviteLink(code: string, origin: string = location.origin, base: string = import.meta.env.BASE_URL): string {
  return `${origin}${base}#/group/join/${encodeURIComponent(code)}`
}
