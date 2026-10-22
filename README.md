# BirdDex

A Pokédex for the birds of Czechia and Europe. Identify a bird by its sound or by a photo, confirm the catch, and fill your Dex. Everything runs on the phone: no accounts, no servers.

It is an installable web app (PWA), so the same code works on iPhone and Android. See [PLAN.md](PLAN.md) for the plan, the milestones, the licenses and the risks.

**Status:** milestones M0 to M6 are built, tested in desktop Chromium with the real models, and live at https://drcir02.github.io/BirdDex/. Nothing has been tested on a real phone yet. M7 (final check on Android, optional APK) is open. Step-by-step phone testing is in [TEST-GUIDE.md](TEST-GUIDE.md).

| Milestone | What | State |
|---|---|---|
| M0 | Foundations, installable shell, Field check page (`/#/field-check`) | built, waits for the phone test |
| M1 | Species data: 429 European species, 282 for Czechia | done |
| M2 | Dex screens, species pages, database, backup and restore | done |
| M3 | Sound identification (BirdNET V2.4, LiteRT) | done, untested on a phone |
| M4 | Photo identification (WingCLIP int8, ONNX Runtime Web) | done, untested on a phone |
| M5 | Live camera | done, untested on a phone |
| M6 | Settings, welcome, credits, sounds, celebration, update banner | done, untested on a phone |
| M7 | Gift packaging, Android check, optional APK | open |

## Run it

```bash
npm ci
node scripts/fetch-models.mjs   # downloads the bird models into public/models/ (about 90 MB, not in git)
npm run dev                     # http://localhost:5173
npm test                        # unit tests (need no model files)
npx tsc --noEmit                # type check of src and tests
npm run build                   # production build (type check included); BASE_PATH=/BirdDex/ for the Pages layout
CHROMIUM_PATH=/opt/pw-browsers/chromium E2E_PORT=4300 npx playwright test   # end-to-end tests (Chromium, fake microphone and camera)
```

Every `E2E_PORT` builds into its own `dist-e2e-<port>` folder (git-ignored); delete these when done. Some e2e specs need the real model files; the unit tests never do. Add `FAKE_AUDIO_FILE=<wav>` to play a file into the fake microphone. Screens can run on fake engines with `?engines=fake` in the address.

## Test

- `npm test` runs about 1700 unit tests with Vitest (jsdom, fake-indexeddb).
- `tests/e2e/*.spec.ts` run in Chromium; the engine specs use the real models and the fixtures in `tests/fixtures`.
- For the phone, follow [TEST-GUIDE.md](TEST-GUIDE.md).

## Deploy

`.github/workflows/pages.yml` (identical copy: `deploy/pages.yml`) runs at every push to `main`: `npm ci`, `npm test`, download of the models, `npm run build` with `BASE_PATH=/BirdDex/`, then publishes to GitHub Pages (repo settings, Pages, Source: GitHub Actions). It takes about 4 to 5 minutes; progress is under the Actions tab. A failing unit test or type error blocks the deployment. A commit message with `[skip ci]` skips the build. Fallback: `scripts/deploy-gh-pages.sh` builds locally and publishes to a `gh-pages` branch.

## Structure

- `src/app`, `src/ui`, `src/styles`: shell, routing, update banner, shared components, tokens.
- `src/pages`: one file per route (Dex, species, scan, result, settings, about, welcome, field check).
- `src/features`: `dex`, `photos`, `scan`, `settings`, `fun` (screen logic and components).
- `src/ml`: `audio`, `sound` (BirdNET), `vision` (WingCLIP), `runtime` (LiteRT, ONNX, model store), `engines.ts` and `fakes.ts`.
- `src/db`, `src/state`, `src/domain`: Dexie database and backup, in-memory state, shared types and thresholds.
- `src/data`, `public/data/species.json`: the species list (built by `scripts/build-species.py`). `scripts/build-species-info.py` then adds the "when and where to find it" info and the BirdPoints range (`data/bp-ranges.csv`) to every bird (see `docs/notes/species-data.md` and `docs/notes/birdpoints-design.md`).
- `src/i18n/cs`: all Czech texts, one file per area.
- `src/fieldcheck`: the Field check page.
- `scripts`: `fetch-models.mjs`, `copy-vendor.mjs`, `make-icons.mjs`, checkpoint and deploy helpers.
- `tests/unit`, `tests/e2e`, `tests/fixtures`; `docs/notes/*.md` hold the decisions and gotchas of each area.

## Models

The bird models are not stored in git. `node scripts/fetch-models.mjs` downloads them, pinned to exact releases and checked by sha256, into `public/models/` and writes `manifest.json`: BirdNET V2.4 FP16 and its location model from the BirdNET-Analyzer v1.5.1 release, and the WingCLIP files from the WingDex repository. The app itself downloads them again on the phone (about 90 MB) and keeps them in Cache Storage. The build works without them. `scripts/make-test-models.py` builds two tiny models for the automatic tests.

## Licenses

- Code: not yet licensed, so all rights are reserved until the owner picks a license.
- BirdNET models: CC BY-NC-SA 4.0 (non-commercial, attribution, share-alike). Code: MIT. See https://github.com/birdnet-team/BirdNET-Analyzer.
- Photo model (WingCLIP): non-commercial. Bird photos: individual Creative Commons licenses with credits shown in the app.
