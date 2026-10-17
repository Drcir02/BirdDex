// What the core end-to-end tests (tests/e2e/core.spec.ts) load into a real browser page as window.BirdDexCore.
// It is bundled for the browser by the test itself, so the database, backup, model store, location and fakes
// run in real Chromium (real IndexedDB, Cache Storage, Blob, geolocation) without needing any screen.

export * from '../../../src/db'
export * from '../../../src/ml/runtime/modelStore'
export { evaluateCandidates } from '../../../src/domain/thresholds'
export { getCachedLocation, getCurrentLocation, resetLocationForTests } from '../../../src/state/location'
export { requestPersistentStorage } from '../../../src/state/storage'
export { createFakeEngines } from '../../../src/ml/fakes'
export { getEngineMode, getEngines, resetEngines } from '../../../src/ml/engines'
export * from '../../../src/state/settings'
export * from '../../../src/state/pending'
export { commonErrorKey } from '../../../src/state/failures'

// So the tests can draw small React screens that use the hooks, in the real page.
export { createElement, StrictMode } from 'react'
export { createRoot } from 'react-dom/client'
