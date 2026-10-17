import type { Status } from '../types'

const KEY = 'birddex:fieldcheck:offline-load'

/** Called on every app start. If there was no network, the offline cache is working. */
export function recordOfflineLoad(): void {
  try {
    if (!navigator.onLine) localStorage.setItem(KEY, new Date().toISOString())
  } catch {
    // Storage can be unavailable in private windows. The check then simply shows "never".
  }
}

export async function runOfflineCheck(log: (line: string) => void): Promise<Status> {
  const online = navigator.onLine
  log(`Network right now: ${online ? 'online' : 'offline'}`)

  let hasWorker = false
  const hasWorkerApi = 'serviceWorker' in navigator
  if (hasWorkerApi) {
    // On the very first visit the worker is still installing. Give it a few seconds before judging.
    await Promise.race([navigator.serviceWorker.ready, new Promise((resolve) => setTimeout(resolve, 5000))])
    const registration = await navigator.serviceWorker.getRegistration()
    hasWorker = !!registration?.active
    log(`Service worker: ${registration?.active ? 'active' : 'not active yet'}; controlling this page: ${navigator.serviceWorker.controller ? 'yes' : 'no'}`)
  } else {
    log('Service workers are not supported here, so the app cannot work offline.')
  }
  if ('caches' in self) {
    const names = await caches.keys()
    const parts: string[] = []
    for (const name of names) parts.push(`${name} (${(await (await caches.open(name)).keys()).length})`)
    log(`Cached: ${parts.join(', ') || 'nothing yet'}`)
  }

  let last: string | null = null
  try {
    last = localStorage.getItem(KEY)
  } catch {
    // ignore
  }
  log(`Last time the app started with no network: ${last ?? 'never'}`)

  if (!online) {
    log('The app is running with no network. Offline start works.')
    return 'pass'
  }
  if (last) return 'pass'
  log('To test: open the app once online, switch on airplane mode, close the app completely, open it again, then come back to this card.')
  if (!hasWorkerApi) return 'fail'
  if (!hasWorker) log('The offline cache is not active yet. Reload the page once.')
  return 'warn'
}
