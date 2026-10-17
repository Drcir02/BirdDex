// Registers the service worker and wires its updates to appUpdate.ts. Kept apart from main.tsx so the page can start
// without it (tests, browsers without service workers).

import { registerSW } from 'virtual:pwa-register'
import { getModelStatus } from '../ml/runtime/modelStore'
import { applyIfIdle, setUpdateWaiting, shouldCheckForUpdate } from './appUpdate'

export function registerUpdates(): void {
  let lastCheck = Date.now()
  let registration: ServiceWorkerRegistration | undefined

  const update = registerSW({
    immediate: true,
    onNeedRefresh() {
      setUpdateWaiting(() => {
        // The plugin reloads by itself only for an update it considers "its own" (found within a minute of registering). An app
        // that stays open for hours gets "external" updates, for which it does nothing, so the reload is done here.
        navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload(), { once: true })
        void update(true)
      })
    },
    onRegisteredSW(_url, registered) {
      registration = registered
    },
  })

  const check = () => {
    if (!registration || !shouldCheckForUpdate(lastCheck, Date.now())) return
    lastCheck = Date.now()
    registration.update().catch(() => undefined)
  }

  // An iPhone home-screen app is rarely started cold, so ask for news every time it comes back to the front, and
  // take a waiting version into use while the app is out of sight (and idle).
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      check()
      return
    }
    void getModelStatus()
      .then((status) => applyIfIdle({ downloading: status.state === 'downloading' }))
      .catch(() => undefined)
  })
}
