import { useCallback, useEffect, useRef, useState, type DependencyList } from 'react'
import { getGroupApi } from './api'
import type { GroupApi } from './types'

export interface Remote<T> {
  data: T | undefined
  loading: boolean
  /** The last try failed (the data of an earlier try, if any, is still in `data`). */
  failed: boolean
  reload: () => void
}

/** Asks the group server for something, again when `deps` change, and every `pollMs` while the app is visible. */
export function useRemote<T>(ask: (api: GroupApi) => Promise<T>, deps: DependencyList, pollMs?: number): Remote<T> {
  const [state, setState] = useState<{ data: T | undefined; loading: boolean; failed: boolean }>({ data: undefined, loading: true, failed: false })
  const askRef = useRef(ask)
  askRef.current = ask
  const [tick, setTick] = useState(0)
  const reload = useCallback(() => setTick((value) => value + 1), [])

  useEffect(() => {
    let alive = true
    const run = async () => {
      try {
        const api = await getGroupApi()
        const data = await askRef.current(api)
        if (alive) setState({ data, loading: false, failed: false })
      } catch {
        if (alive) setState((previous) => ({ data: previous.data, loading: false, failed: true }))
      }
    }
    setState((previous) => ({ ...previous, loading: true }))
    void run()
    if (!pollMs) return () => void (alive = false)
    const interval = setInterval(() => {
      if (document.visibilityState !== 'hidden') void run()
    }, pollMs)
    return () => {
      alive = false
      clearInterval(interval)
    }
  }, [...deps, tick, pollMs])

  return { ...state, reload }
}
