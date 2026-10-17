// "Add to home screen": which hint fits this phone, and the real install button on Android (the beforeinstallprompt event).

import { useEffect, useSyncExternalStore } from 'react'

export type InstallPlatform =
  /** Already running as an installed app. */
  | 'installed'
  /** iPhone or iPad: only the Share menu of Safari can add the app. */
  | 'ios'
  /** Android: a real install button when the browser offers one, otherwise the browser menu. */
  | 'android'
  | 'desktop'

export interface PlatformInfo {
  userAgent: string
  /** navigator.maxTouchPoints, to tell an iPad that pretends to be a Mac. */
  maxTouchPoints?: number
  /** Running from the home screen (display-mode: standalone, or navigator.standalone on iOS). */
  standalone: boolean
}

/** Pure: picks the install hint for a phone. */
export function detectPlatform({ userAgent, maxTouchPoints = 0, standalone }: PlatformInfo): InstallPlatform {
  if (standalone) return 'installed'
  if (/iPhone|iPad|iPod/i.test(userAgent)) return 'ios'
  // iPadOS 13+ says it is a Mac, but has a touch screen.
  if (/Macintosh/i.test(userAgent) && maxTouchPoints > 1) return 'ios'
  if (/Android/i.test(userAgent)) return 'android'
  return 'desktop'
}

export function currentPlatform(): InstallPlatform {
  if (typeof navigator === 'undefined') return 'desktop'
  let standalone = false
  try {
    standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true
  } catch {
    // Old browsers: treat as not installed.
  }
  return detectPlatform({ userAgent: navigator.userAgent, maxTouchPoints: navigator.maxTouchPoints, standalone })
}

// ---------- The install prompt ----------

export interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform?: string }>
}

let deferred: BeforeInstallPromptEvent | undefined
const listeners = new Set<() => void>()
let installed = false
const notify = () => listeners.forEach((listener) => listener())

/** Starts listening. Called when this module loads; main.tsx may import it early so an event that fires before a screen opens is not lost. */
function listen(): void {
  if (typeof window === 'undefined') return
  window.addEventListener('beforeinstallprompt', (event) => {
    // Keep the event for our own button instead of the browser's mini bar.
    event.preventDefault()
    deferred = event as BeforeInstallPromptEvent
    notify()
  })
  window.addEventListener('appinstalled', () => {
    deferred = undefined
    installed = true
    notify()
  })
}
listen()

export type InstallOutcome = 'accepted' | 'dismissed' | 'unavailable'

/** Shows the browser's install question. Call it from a tap. */
export async function promptInstall(): Promise<InstallOutcome> {
  const event = deferred
  if (!event) return 'unavailable'
  // The event can be used only once.
  deferred = undefined
  notify()
  try {
    await event.prompt()
    const choice = await event.userChoice
    if (choice.outcome === 'accepted') installed = true
    notify()
    return choice.outcome
  } catch {
    return 'unavailable'
  }
}

export interface InstallState {
  platform: InstallPlatform
  /** The browser offered a real install button (Android Chrome and similar). */
  canPrompt: boolean
}

let snapshot: InstallState | undefined

function getSnapshot(): InstallState {
  const platform = installed ? 'installed' : currentPlatform()
  const canPrompt = deferred !== undefined
  if (!snapshot || snapshot.platform !== platform || snapshot.canPrompt !== canPrompt) snapshot = { platform, canPrompt }
  return snapshot
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Which install hint to show, and whether a real install button is available. Updates when the browser offers one. */
export function useInstallState(): InstallState {
  const state = useSyncExternalStore(subscribe, getSnapshot, () => ({ platform: 'desktop', canPrompt: false }) as InstallState)
  // The display mode can change (the app was just installed and opened): look again when it does.
  useEffect(() => {
    let query: MediaQueryList | undefined
    try {
      query = window.matchMedia('(display-mode: standalone)')
    } catch {
      return undefined
    }
    const onChange = () => notify()
    query.addEventListener?.('change', onChange)
    return () => query?.removeEventListener?.('change', onChange)
  }, [])
  return state
}

/** For tests: pretend the browser offered the install prompt. */
export function setDeferredPromptForTests(event: BeforeInstallPromptEvent | undefined): void {
  deferred = event
  installed = false
  snapshot = undefined
  notify()
}
