// Live queries for React: a component shows the current answer of a database query and is updated whenever the
// data behind it changes (also when another tab writes). Built on Dexie's liveQuery and useSyncExternalStore.

import { liveQuery, type Subscription } from 'dexie'
import { useMemo, useSyncExternalStore, type DependencyList } from 'react'

export interface LiveSnapshot<T> {
  /** False until the first answer has arrived, so a screen can avoid flashing "nothing here yet". */
  ready: boolean
  value: T
  /** Set when the query failed, for example because storage is blocked. */
  error?: Error
}

export interface LiveStore<T> {
  subscribe(listener: () => void): () => void
  /** Returns the same object until the data changes, as useSyncExternalStore requires. */
  getSnapshot(): LiveSnapshot<T>
}

/**
 * A store holding the latest result of `query`. The query only runs while somebody is subscribed.
 * When the last subscriber leaves, the query stops, but the last answer is kept for the next one.
 */
export function createLiveStore<T>(query: () => T | Promise<T>, initial: T): LiveStore<T> {
  let snapshot: LiveSnapshot<T> = { ready: false, value: initial }
  const listeners = new Set<() => void>()
  let subscription: Subscription | undefined

  const publish = (next: LiveSnapshot<T>) => {
    snapshot = next
    listeners.forEach((listener) => listener())
  }

  const start = () => {
    subscription = liveQuery(query).subscribe({
      next: (value) => publish({ ready: true, value }),
      error: (error: unknown) =>
        publish({ ready: true, value: snapshot.value, error: error instanceof Error ? error : new Error(String(error)) }),
    })
  }

  return {
    subscribe(listener) {
      listeners.add(listener)
      if (!subscription) start()
      return () => {
        listeners.delete(listener)
        if (listeners.size === 0) {
          subscription?.unsubscribe()
          subscription = undefined
        }
      }
    },
    getSnapshot: () => snapshot,
  }
}

/**
 * The current answer of a database query, kept up to date. Pass the values the query depends on as `deps`
 * (like useEffect): when they change, the query starts over.
 */
export function useLiveQuery<T>(query: () => T | Promise<T>, deps: DependencyList, initial: T): LiveSnapshot<T> {
  // `deps` is the caller's promise that `query` and `initial` only depend on those values.
  const store = useMemo(() => createLiveStore(query, initial), deps)
  return useSyncExternalStore(store.subscribe, store.getSnapshot)
}
