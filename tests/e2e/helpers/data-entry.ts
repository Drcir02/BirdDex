// What the species data end-to-end tests (tests/e2e/data.spec.ts) load into a real browser page as window.BirdDexData.
// The tests bundle it for the browser themselves, so the loader, the offline copy in Cache Storage and the Czech
// sorting run in real Chromium without needing a screen.

export * from '../../../src/data/species'
export { familyNameCs } from '../../../src/data/families'
