// The user's settings, kept in localStorage so they survive a restart. Anything that reads them goes through here.

import { useSyncExternalStore } from 'react'
import type { Sensitivity } from '../domain/types'

export const SETTINGS_KEY = 'birddex:settings'

export interface Settings {
  /** How sure BirdDex must be before the Catch button works. See src/domain/thresholds.ts. */
  sensitivity: Sensitivity
  /** Sounds made by the app itself, such as the catch jingle. */
  soundEffects: boolean
}

export const DEFAULT_SETTINGS: Readonly<Settings> = Object.freeze({
  sensitivity: 'normal',
  soundEffects: true,
})

const SENSITIVITIES: readonly Sensitivity[] = ['strict', 'normal', 'easy']

/** Turns whatever was stored into valid settings: every field that is missing or wrong falls back to its default. */
export function sanitizeSettings(value: unknown): Settings {
  const source = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
  return {
    sensitivity: SENSITIVITIES.includes(source.sensitivity as Sensitivity) ? (source.sensitivity as Sensitivity) : DEFAULT_SETTINGS.sensitivity,
    soundEffects: typeof source.soundEffects === 'boolean' ? source.soundEffects : DEFAULT_SETTINGS.soundEffects,
  }
}

const sameSettings = (a: Settings, b: Settings) => a.sensitivity === b.sensitivity && a.soundEffects === b.soundEffects

function readStored(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    return raw ? sanitizeSettings(JSON.parse(raw)) : { ...DEFAULT_SETTINGS }
  } catch {
    // Storage blocked or the text is damaged: start from the defaults.
    return { ...DEFAULT_SETTINGS }
  }
}

let current: Settings | undefined
const listeners = new Set<() => void>()

const notify = () => listeners.forEach((listener) => listener())

/** The current settings. The same object is returned until something changes. */
export function getSettings(): Settings {
  current ??= readStored()
  return current
}

/** Changes some settings and saves them. If saving fails (private window, full storage) they still apply until the app closes. */
export function updateSettings(patch: Partial<Settings>): Settings {
  const before = getSettings()
  const next = sanitizeSettings({ ...before, ...patch })
  if (sameSettings(before, next)) return before
  current = next
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(next))
  } catch {
    // Kept in memory only.
  }
  notify()
  return next
}

export function resetSettings(): Settings {
  return updateSettings({ ...DEFAULT_SETTINGS })
}

// Another tab or window changed the settings.
function onStorage(event: StorageEvent) {
  if (event.key !== null && event.key !== SETTINGS_KEY) return
  const next = readStored()
  if (current && sameSettings(current, next)) return
  current = next
  notify()
}

export function subscribeSettings(listener: () => void): () => void {
  if (listeners.size === 0 && typeof window !== 'undefined') window.addEventListener('storage', onStorage)
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0 && typeof window !== 'undefined') window.removeEventListener('storage', onStorage)
  }
}

/** For tests: forget what was loaded, so the next read starts from storage again. */
export function reloadSettingsForTests(): void {
  current = undefined
  notify()
}

/** The settings, and a function that changes some of them. The screen updates whenever they change anywhere. */
export function useSettings(): { settings: Settings; update: (patch: Partial<Settings>) => void } {
  const settings = useSyncExternalStore(subscribeSettings, getSettings)
  return { settings, update: updateSettings }
}
