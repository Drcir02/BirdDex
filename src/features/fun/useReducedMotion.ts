import { useSyncExternalStore } from 'react'

const QUERY = '(prefers-reduced-motion: reduce)'

function subscribe(listener: () => void): () => void {
  let list: MediaQueryList | undefined
  try {
    list = window.matchMedia(QUERY)
  } catch {
    return () => undefined
  }
  list.addEventListener?.('change', listener)
  return () => list?.removeEventListener?.('change', listener)
}

function getSnapshot(): boolean {
  try {
    return window.matchMedia(QUERY).matches
  } catch {
    return false
  }
}

/** True when the person asked their phone for less motion. */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false)
}
