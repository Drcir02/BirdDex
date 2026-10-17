// What is on the phone: which model files are downloaded, and the progress of a download that is running.
// For the settings and welcome screens ("models: 89 MB downloaded", a progress bar, a delete button).

import { useSyncExternalStore } from 'react'
import { getModelStatus, subscribeModelStatus, type ModelStoreStatus } from '../ml/runtime/modelStore'

export interface ModelStatusSource {
  getStatus(): Promise<ModelStoreStatus>
  subscribe(listener: (status: ModelStoreStatus) => void): () => void
}

export interface ModelStatusStore {
  subscribe(listener: () => void): () => void
  getSnapshot(): ModelStoreStatus | undefined
  /** Looks at the phone again (for example after the app came back to the front). */
  refresh(): Promise<void>
}

/** A store that keeps the latest status. It only listens to the model store while somebody is subscribed. */
export function createModelStatusStore(source: ModelStatusSource): ModelStatusStore {
  let snapshot: ModelStoreStatus | undefined
  const listeners = new Set<() => void>()
  let stopListening: (() => void) | undefined

  const publish = (status: ModelStoreStatus) => {
    snapshot = status
    listeners.forEach((listener) => listener())
  }
  const refresh = () => source.getStatus().then(publish)

  return {
    subscribe(listener) {
      listeners.add(listener)
      if (listeners.size === 1) {
        stopListening = source.subscribe(publish)
        void refresh()
      }
      return () => {
        listeners.delete(listener)
        if (listeners.size === 0) {
          stopListening?.()
          stopListening = undefined
        }
      }
    },
    getSnapshot: () => snapshot,
    refresh,
  }
}

/** The status held by a store, kept up to date in the screen. */
export function useModelStatusFrom(store: ModelStatusStore): ModelStoreStatus | undefined {
  return useSyncExternalStore(store.subscribe, store.getSnapshot)
}

const appStore = createModelStatusStore({ getStatus: getModelStatus, subscribe: subscribeModelStatus })

export const refreshModelStatus = (): Promise<void> => appStore.refresh()

/** The status of the downloaded models, or undefined until it has been looked up. Updates while a download runs. */
export function useModelStatus(): ModelStoreStatus | undefined {
  return useModelStatusFrom(appStore)
}
