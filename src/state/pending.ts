// The identification waiting for the user's decision on the result screen. The scan screens put it here and
// navigate to /result; the result screen reads it, and clears it when the user catches the bird or drops it.
// It lives in memory only: reloading the page forgets it, on purpose.

import { useSyncExternalStore } from 'react'
import { newId } from '../db/ids'
import type { PendingIdentification } from '../domain/types'

let pending: PendingIdentification | undefined
let catchId: string | undefined
const listeners = new Set<() => void>()

const notify = () => listeners.forEach((listener) => listener())

export function setPending(identification: PendingIdentification): void {
  pending = identification
  catchId = newId()
  notify()
}

export function getPending(): PendingIdentification | undefined {
  return pending
}

/**
 * An id for the catch that this identification may become. It stays the same until the identification is replaced
 * or cleared. Pass it as `id` to addCatch: then a double tap on the Catch button saves one catch, not two.
 */
export function getPendingCatchId(): string | undefined {
  return catchId
}

export function clearPending(): void {
  if (pending === undefined) return
  pending = undefined
  catchId = undefined
  notify()
}

export function subscribePending(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** The waiting identification, or undefined when there is none. The screen updates when it is set or cleared. */
export function usePending(): PendingIdentification | undefined {
  return useSyncExternalStore(subscribePending, getPending)
}
