// "Make a backup" reminder: shown on the settings screen once there are 10 catches and no backup has ever been made.
// The time of the last backup lives in localStorage (it is a convenience, not data worth losing).

export const LAST_BACKUP_KEY = 'birddex:lastBackup'

/** The reminder appears from this many catches on. */
export const REMINDER_AFTER_CATCHES = 10

/** Pure: whether to remind. */
export function shouldRemindBackup(catchCount: number, lastBackupAt: number | undefined): boolean {
  return lastBackupAt === undefined && catchCount >= REMINDER_AFTER_CATCHES
}

export function readLastBackup(): number | undefined {
  try {
    const value = Number(window.localStorage.getItem(LAST_BACKUP_KEY))
    return Number.isFinite(value) && value > 0 ? value : undefined
  } catch {
    return undefined
  }
}

let rememberedInMemory: number | undefined

/** Remembers that a backup was made (the file was shared or downloaded). */
export function markBackupMade(at: number = Date.now()): void {
  rememberedInMemory = at
  try {
    window.localStorage.setItem(LAST_BACKUP_KEY, String(at))
  } catch {
    // Storage blocked: the reminder is only silenced until the app closes.
  }
}

export function forgetBackup(): void {
  rememberedInMemory = undefined
  try {
    window.localStorage.removeItem(LAST_BACKUP_KEY)
  } catch {
    // Nothing to forget.
  }
}

/** The time of the last backup, or undefined when there never was one. */
export function lastBackupAt(): number | undefined {
  return readLastBackup() ?? rememberedInMemory
}
