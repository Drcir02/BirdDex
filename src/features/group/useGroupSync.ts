import { useEffect, useState } from 'react'
import { getGroupApi } from './api'
import { flushShares, scheduleFlush } from './share'
import { getGroupState, getMembership, updatePrefs, useGroupState } from './state'
import { GroupError } from './types'

const POLL_MS = 60_000

/** Keeps the group in step while the app is open: sends what is waiting (also when the connection comes back). Mounted once, in Layout. */
export function useGroupSync(): void {
  const groupId = useGroupState().membership?.groupId
  useEffect(() => {
    if (!groupId) return
    const run = () => {
      if (document.visibilityState === 'hidden') return
      void flushShares().then((result) => {
        if (result.nextDueAt) scheduleFlush(result.nextDueAt - Date.now() + 200)
      })
    }
    scheduleFlush(1_500)
    const interval = setInterval(run, POLL_MS)
    window.addEventListener('online', run)
    document.addEventListener('visibilitychange', run)
    return () => {
      clearInterval(interval)
      window.removeEventListener('online', run)
      document.removeEventListener('visibilitychange', run)
    }
  }, [groupId])
}

/** True when somebody else has posted since the person last looked at the feed: the red dot on the round key. */
export function useGroupBadge(): boolean {
  const { membership, prefs } = useGroupState()
  const [latest, setLatest] = useState<number | undefined>(undefined)
  const groupId = membership?.groupId
  useEffect(() => {
    if (!groupId) {
      setLatest(undefined)
      return
    }
    let alive = true
    const look = async () => {
      if (document.visibilityState === 'hidden') return
      try {
        const api = await getGroupApi()
        const newest = await api.latest(groupId)
        if (alive) setLatest(newest)
      } catch (error) {
        // No connection: the dot stays as it was. A phone that was removed finds out when it sends something.
        if (error instanceof GroupError && error.kind === 'removed') return
      }
    }
    void look()
    const interval = setInterval(() => void look(), POLL_MS)
    document.addEventListener('visibilitychange', look)
    return () => {
      alive = false
      clearInterval(interval)
      document.removeEventListener('visibilitychange', look)
    }
  }, [groupId])
  return Boolean(membership) && latest !== undefined && latest > prefs.seenAt
}

/** The feed was looked at: everything up to `newest` is no longer news. */
export function markSeen(newest: number): void {
  if (getMembership() && newest > getGroupState().prefs.seenAt) updatePrefs({ seenAt: newest })
}
