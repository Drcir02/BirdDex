import { WELCOMED_KEY } from './constants'

// The welcome screen is shown once. The flag lives in localStorage; if the browser refuses storage (a private window,
// blocked site data) it also lives in memory, so the app never traps someone on the welcome screen.

let welcomedInMemory = false

export function isWelcomed(): boolean {
  if (welcomedInMemory) return true
  try {
    return window.localStorage.getItem(WELCOMED_KEY) !== null
  } catch {
    return false
  }
}

/** Call when the welcome screen is done (or skipped). */
export function markWelcomed(): void {
  welcomedInMemory = true
  try {
    window.localStorage.setItem(WELCOMED_KEY, '1')
  } catch {
    // Storage is blocked: the in-memory flag keeps this visit working.
  }
}

/** Shows the welcome screen again on the next start, for the settings screen and for tests. */
export function resetWelcomed(): void {
  welcomedInMemory = false
  try {
    window.localStorage.removeItem(WELCOMED_KEY)
  } catch {
    // Nothing to remove.
  }
}
