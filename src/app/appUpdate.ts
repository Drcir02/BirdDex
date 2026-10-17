// A new version of the app is installed in the background, but the page is only reloaded at a safe moment.
// Reloading in the middle of a scan, a model download or on the result screen would lose the work in progress
// (the waiting identification lives in memory only). vite.config.ts uses registerType 'prompt', so the new service
// worker waits until this module tells it to take over.

import { useSyncExternalStore } from 'react'
import { getPending } from '../state/pending'

export interface SafetyInput {
  /** The route path, for example '/scan/sound' or '/result'. */
  path: string
  hasPending: boolean
  downloading: boolean
}

/** True when a reload would not throw anything away. */
export function isSafeToReload({ path, hasPending, downloading }: SafetyInput): boolean {
  if (downloading || hasPending) return false
  return !(path === '/scan/sound' || path === '/scan/photo' || path === '/scan/live' || path === '/result')
}

/** The route path of a HashRouter address ('#/scan/sound?x=1' gives '/scan/sound'). */
export function hashPath(hash: string): string {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash
  const path = raw.split('?')[0] ?? ''
  return path === '' ? '/' : path
}

let waiting = false
let applyUpdate: (() => void) | undefined
const listeners = new Set<() => void>()
const notify = () => listeners.forEach((listener) => listener())

/** Called when a new version is installed and waits. `apply` activates it and reloads the page. */
export function setUpdateWaiting(apply: () => void): void {
  applyUpdate = apply
  if (!waiting) {
    waiting = true
    notify()
  }
}

export function isUpdateWaiting(): boolean {
  return waiting
}

/** Activates the waiting version now (the page reloads). Does nothing when there is none. */
export function applyWaitingUpdate(): void {
  applyUpdate?.()
}

export function subscribeUpdate(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** For tests. */
export function resetUpdateState(): void {
  waiting = false
  applyUpdate = undefined
  notify()
}

/** True while a new version waits for the user. The banner on the device uses it. */
export function useUpdateWaiting(): boolean {
  return useSyncExternalStore(subscribeUpdate, isUpdateWaiting)
}

/**
 * Applies the waiting version when the app is out of sight and nothing is in progress.
 * Returns true when it did.
 */
export function applyIfIdle(input: Omit<SafetyInput, 'path' | 'hasPending'> & { path?: string; hasPending?: boolean }): boolean {
  if (!waiting) return false
  const safe = isSafeToReload({
    path: input.path ?? hashPath(window.location.hash),
    hasPending: input.hasPending ?? getPending() !== undefined,
    downloading: input.downloading,
  })
  if (!safe) return false
  applyWaitingUpdate()
  return true
}

/** How long the app may stay in front before it asks the server about a new version again. */
export const UPDATE_CHECK_EVERY_MS = 10 * 60 * 1000

/** Decides whether the app should look for a new version now. */
export function shouldCheckForUpdate(lastCheck: number, now: number): boolean {
  return now - lastCheck >= UPDATE_CHECK_EVERY_MS
}
