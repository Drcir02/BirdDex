# Where the build was paused (2026-10-17, about 09:20 UTC)

The owner asked to pause after the first deploy to look at the cost. Nothing is running. This file says what is done, what is
half done, and what is left, so the work can be picked up by anyone (a new session, or the owner).

## Live

- Site: https://drcir02.github.io/BirdDex/ (GitHub Pages, source "GitHub Actions"). Deployed commit: `181852e`.
- `.github/workflows/pages.yml` builds and deploys at every push to `main` (about 4 to 5 minutes). A commit message with
  `[skip ci]` skips the build; unfinished work is pushed that way so it does not replace the tested version on the site.
- The Actions API is reachable from the cloud session (runs, jobs, annotations, re-run); the Pages settings API is not.

## Done and verified in desktop Chromium (not on a phone yet)

- App shell, device-style UI, Czech texts, routing, offline app shell (service worker), installable PWA.
- Local database (Dexie), settings store, model store with checksum and download progress, backup/restore code.
- Dex data: 423 species (276 for Czechia) with Czech names, rarity, regions.
- Sound identification with the real BirdNET V2.4 model, and photo identification with the real WingCLIP model, both
  measured on fixtures (see `docs/notes/sound-engine.md`, `docs/notes/photo-engine.md`).
- Dex screens, species pages, scan screens (sound, photo, live camera) and the result/catch screen, with end-to-end tests.
- 1515 unit tests and the Playwright specs under `tests/e2e` pass. The GitHub build (tests, model download, build) is green.

## Half done (committed as work in progress, not verified)

- Settings page, About/credits page, onboarding pages and their Czech texts (`src/pages`, `src/features/settings`, `src/i18n/cs`).
- Sound effects and catch celebration (`src/features/fun`), trainer card and stats.
- Location prior for photo identification from BirdNET's location model (`src/ml/vision/geoPrior.ts`, `src/ml/sound/geo.worker.ts`).
- First end-to-end flow tests with the real models (`tests/e2e/flows.spec.ts`, `tests/e2e/flows-helpers.ts`) and a measuring
  spec (`tests/e2e/zz-measure-i1.spec.ts`, temporary: delete when finished).

## Left to do

1. Finish and verify the half-done items above (run tsc, vitest, the e2e suite, the production build).
2. Tune `src/domain/thresholds.ts` from the measurements; first-run model download UX (retry, offline, storage full).
3. Independent review of correctness (ML and data), product and Czech copy, and robustness; fix what it finds.
4. Final pass: README and PLAN status, a short testing guide for the owner (`MORNING.md`), cleanup of `dist-e2e-*` folders.
5. Real-device testing by the owner: iPhone (Safari and home-screen app), later an Android phone. Expect fixes from this.
6. Optional: Android APK packaging (milestone M7).

## Facts that changed since the task prompts in the workflow scripts were written

- The repo is `Drcir02/BirdDex` (capital B and D); the site address is the one above, not `/birddex/`.
- The Pages workflow is already installed; nothing has to be pasted into GitHub any more.
- `scripts/checkpoint.sh` now pushes normal history (fast-forward) after putting the commits on top of anything new on GitHub.
