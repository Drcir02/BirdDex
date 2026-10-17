// Small helpers about the phone's storage, shared by the database and the model store.

/**
 * True for the errors browsers throw when the phone has no room left (IndexedDB, Cache Storage, localStorage).
 * Dexie wraps the original error, so this also looks inside `inner` and `cause`.
 */
export function isQuotaExceededError(error: unknown): boolean {
  const seen = new Set<unknown>()
  let current: unknown = error
  while (current !== null && typeof current === 'object' && !seen.has(current)) {
    seen.add(current)
    const { name, code, inner, cause } = current as { name?: unknown; code?: unknown; inner?: unknown; cause?: unknown }
    if (name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED' || code === 22 || code === 1014) return true
    current = inner ?? cause
  }
  return false
}

let granted = false
let asking: Promise<boolean> | undefined

async function ask(): Promise<boolean> {
  try {
    const storage = typeof navigator === 'undefined' ? undefined : navigator.storage
    if (!storage?.persist) return false
    granted = (await storage.persisted?.()) === true || (await storage.persist()) === true
    return granted
  } catch {
    return false
  }
}

/**
 * Asks the browser not to clear BirdDex's data when the phone runs low on space. Best effort: it never throws,
 * and a "no" is not remembered, because browsers say yes more readily after the app has been used or installed.
 */
export function requestPersistentStorage(): Promise<boolean> {
  if (granted) return Promise.resolve(true)
  if (!asking) {
    const request: Promise<boolean> = ask().finally(() => {
      if (asking === request) asking = undefined
    })
    asking = request
  }
  return asking
}

export interface StorageUsage {
  usedBytes: number
  quotaBytes: number
  /** True when the browser promised not to clear BirdDex's data by itself. */
  persistent: boolean
}

/** How much room BirdDex uses on the phone and how much it may use, for the settings screen. Undefined where the browser cannot say. */
export async function getStorageUsage(): Promise<StorageUsage | undefined> {
  try {
    const storage = typeof navigator === 'undefined' ? undefined : navigator.storage
    const estimate = await storage?.estimate?.()
    if (!estimate || typeof estimate.usage !== 'number' || typeof estimate.quota !== 'number') return undefined
    return { usedBytes: estimate.usage, quotaBytes: estimate.quota, persistent: (await storage?.persisted?.()) === true }
  } catch {
    return undefined
  }
}

/** For tests. */
export function resetPersistentStorageRequest(): void {
  granted = false
  asking = undefined
}
