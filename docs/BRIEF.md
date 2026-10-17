# BirdDex build brief

Read this first. It is the shared source of truth for everyone building BirdDex tonight. Your own task prompt says what *you* build; this file says how the whole thing fits together.

The owner is asleep and cannot answer questions. Make sensible decisions, write them down in `docs/notes/<your-area>.md`, and keep going. The owner will test everything on an iPhone in the morning, and the finished app is a gift for someone with an Android phone.

## 1. Product (fixed decisions)

A Pokédex for the birds of Czechia and Europe. The user identifies a bird by **sound** (live microphone), by **photo**, or by **live camera**. The app shows the top 3 guesses with confidence. A **Catch** button works only above a confidence threshold and only after the user confirms. Confirmed catches fill the **Dex**: all species, caught or not yet, and for caught ones the date, place, and the saved photo or audio clip.

- **Installable web app (PWA)**: React 19, TypeScript (strict), Vite 8, offline-first, everything on the device. No accounts, no server, no analytics.
- **UI language: Czech only.** All user-visible text lives in `src/i18n` and is written in natural, friendly Czech (informal "ty", playful Pokédex tone, never stiff or machine-translated). Code identifiers and comments are English. No English text may appear in the UI except the app name "BirdDex" and licence names.
- **Birds**: European birds (the Dex), with a flag for the Czechia subset. A bird is shown by Czech name plus scientific name. If BirdNET has no Czech name, show the scientific name alone. English names are for search and photo lookups only.
- **Sound**: BirdNET V2.4 (TFLite) through LiteRT.js. **Photo and live camera**: WingCLIP (int8 ONNX) through ONNX Runtime Web. Both run on the phone.
- **Storage**: IndexedDB through Dexie. Backup and restore as a file.
- **Look**: original Pokédex-inspired design: red handheld shell, glossy blue lens, LED lights, green LCD screens, pixel-style headings (fonts from `@fontsource/press-start-2p`, `@fontsource/vt323`, `@fontsource/silkscreen`, all installed, SIL OFL), silhouettes for birds not yet caught. **Original art and wording only: no Nintendo or Pokémon names, logos or artwork.** The app name is the placeholder "BirdDex"; keep it in one constant.
- Everything must be **free and open source**. Licences: BirdNET models CC BY-NC-SA 4.0 (non-commercial), WingCLIP weights CC BY-NC 4.0, Wikimedia photos carry individual Creative Commons licences and need credits shown in the app.

## 2. Environment facts

- Project root: `/home/user/birddex`. Node 22. **All npm dependencies are already installed. Do not add dependencies.** If you think one is essential, write it in your report instead.
- Python tools: `.venv/bin/python` (numpy, pillow, onnx, onnxruntime, ai-edge-litert, flatbuffers, tflite).
- Chromium for tests: `/opt/pw-browsers/chromium`.
- **Network from this machine is locked down.** npm, PyPI and `git` to public GitHub repos work. Hugging Face, Zenodo, Wikimedia, Wikipedia, GBIF, iNaturalist and most other sites are blocked. Never rely on them in code that runs here, and never in tests. The user's phone has normal internet, so the app may use them at run time (for example Wikipedia photos), but tests must use mocks and fixtures.
- **Reference material on disk (read-only, do not modify):**
  - `/home/user/birdnet-team/reference/birdnet-v1.5.1-python/` BirdNET Analyzer's Python code (exact preprocessing, sigmoid, geo model use). `model.py`, `audio.py`, `config.py`, `utils.py`, `analyze.py`.
  - `/home/user/birdnet-team/reference/birdnet-tfjs-demo/` the official BirdNET browser demo (`static/main.js`).
  - `/home/user/birdnet-team/wingdex/` the open-source WingDex app that runs WingCLIP in a browser: `src/lib/bird-id-local.ts`, `bird-id-local-adapter.ts`, `clip-preprocess.ts`, `model-cache.ts`, `crop-math.ts`, `wikimedia.ts`, `taxonomy.json`; model card `ml/distill/MODEL_CARD.md`; golden vectors in `ml/parity/`. It is MIT-licensed code; if you reuse logic, say so in a comment.
  - `/home/user/birdnet-team/birdnet-analyzer/` a clone of BirdNET Analyzer (HEAD plus the v1.5.1 tag).
- **Models on disk** (git-ignored; CI downloads them for the deployed site), in `public/models/`:

| File | Bytes | sha256 |
|---|---|---|
| `birdnet-v2.4-fp16.tflite` (the one the app ships) | 25932528 | `5c64ba3ffab264ccbfafe784896392051a86be63b0cc507e7683db7df114546b` |
| `birdnet-v2.4-fp32.tflite` (tests and comparison only) | 51726412 | `55f3e4055b1a13bfa9a2452731d0d34f6a02d6b775a334362665892794165e4c` |
| `birdnet-v2.4-geo-fp16.tflite` (location filter) | 14770468 | `1226f23fc20362617deb09178f366111b70cf085c2c82893f2814e5acedce6c2` |
| `wingclip_visual_int8.onnx` | 14386564 | `4d9ddfad519b6e80f0c5820d7d89051a55cdf9cb4b59ab8bbfe0a9fcc9dc4d59` |
| `wingclip_visual_int8.data` (external weights of the onnx) | 25165824 | `6bfc8c38271437a04351edbbea9478b29431bc155929da0bebcce68b14090d31` |
| `text_classifier_int8.bin` | 8488140 | `5904dc6f5e53fa1aa354749682edd4c4fda4209210882e681b304ca7c4ee6739` |

  Their public homes, pinned, for the CI download (`scripts/fetch-models.mjs`): BirdNET files at `https://github.com/birdnet-team/BirdNET-Analyzer/raw/v1.5.1/birdnet_analyzer/checkpoints/V2.4/` (`BirdNET_GLOBAL_6K_V2.4_Model_FP16.tflite`, `BirdNET_GLOBAL_6K_V2.4_MData_Model_V2_FP16.tflite`); WingCLIP files at `https://github.com/jlian/wingdex/raw/b0dda4b7cb77d86f918c1a75ad662b0f462bb0b2/public/models/`.
- **Test fixtures**: `tests/fixtures/audio/` (`birdnet-demo-sample.wav` is 3 s of a Lesser Redpoll, BirdNET FP16 gives 0.94; `soundscape-24s.wav` is a North American soundscape, first window Black-capped Chickadee 0.81), `tests/fixtures/photos/` with `truth.json` (English species names), `tests/fixtures/models/tiny.*`.
- **Facts already verified here with the real models (Python, ai-edge-litert):**
  - BirdNET V2.4 takes a float32 tensor `[1, 144000]` (3 s of raw 48 kHz mono audio, range about -1..1) and returns `[1, 6522]` logits. Apply a sigmoid to get scores. Labels are `Scientific name_Common name`, one per line (`data/birdnet-v2.4/labels_en.txt`, `labels_cs.txt`; the Czech file has 2636 translated names, the rest fall back to English). The last labels are non-bird sounds (Dog, Engine, Human, Siren, Noise and so on): never show them as birds.
  - The geo model takes `[[lat, lon, week]]` (week 1 to 48) and returns `[1, 6522]` occurrence scores. Prague in week 20 has 140 species at or above 0.03.
  - WingCLIP: input `[1, 3, 224, 224]`, output a 768-d embedding, L2-normalised. Species scores are cosine similarity against the rows of `text_classifier_int8.bin` (int8 matrix followed by per-row float32 scales; the final row is a bird/not-bird probe). Preprocessing: resize the shorter side to 248, centre-crop 224, CLIP normalisation. Read `clip-preprocess.ts` and `bird-id-local.ts` for the exact numbers.

## 3. Who owns which files

Edit only the files your task owns. If you must touch something else, make the smallest possible change and list it in your report. Never revert someone else's work.

| Area | Paths |
|---|---|
| **F1a shell** | `src/app/**`, `src/styles/**`, `src/ui/**`, `src/pages/*` (stub for every route), `src/i18n/index.ts`, `src/i18n/cs/*` (creates all files), `src/App.tsx`, `src/main.tsx`, `index.html`, `public/icons/**` |
| **F1b core** | `src/db/**`, `src/state/**`, `src/domain/thresholds.ts`, `src/ml/runtime/modelStore.ts`, `src/ml/engines.ts`, `src/ml/fakes.ts`, `scripts/fetch-models.mjs`, `tests/unit/fetch-models.test.ts`, `src/fieldcheck/checks/models.ts` |
| **F2 data** | `scripts/build-species.py`, `public/data/**`, `src/data/**`, `docs/notes/species-data.md` |
| **E1 sound** | `src/ml/audio/**`, `src/ml/runtime/litert.ts`, `src/ml/sound/**` |
| **E2 photo** | `src/ml/vision/**`, `src/ml/runtime/ort.ts` |
| **S1 dex screens** | `src/pages/DexPage.tsx`, `src/pages/SpeciesPage.tsx`, `src/features/dex/**`, `src/features/photos/**`, `src/i18n/cs/dex.ts` |
| **S2 scan screens** | `src/pages/Scan*.tsx`, `src/pages/ResultPage.tsx`, `src/features/scan/**`, `src/i18n/cs/scan.ts`, `src/i18n/cs/result.ts` |
| **I2 polish** | `src/pages/SettingsPage.tsx`, `src/pages/AboutPage.tsx`, `src/pages/OnboardingPage.tsx`, `src/features/settings/**`, `src/features/fun/**`, `src/i18n/cs/settings.ts`, `about.ts`, `fun.ts`, `onboarding.ts` |
| **Everyone** | tests for your own code under `tests/unit/` and `tests/e2e/` (name files after your area) and notes in `docs/notes/` |
| **Not to touch** unless your task says so | `package.json`, `package-lock.json`, `vite.config.ts`, `tsconfig.json`, `playwright.config.ts`, `PLAN.md`, `README.md`, `.github/**` |

## 4. Contracts

- **Types**: `src/domain/types.ts` and `src/domain/engines.ts` already exist. Read them. They are the agreement between data, database, engines and screens.
- **Routes** (HashRouter, so refresh works on static hosting): `/` Dex, `/species/:id`, `/scan`, `/scan/sound`, `/scan/photo`, `/scan/live`, `/result`, `/settings`, `/about`, `/welcome` (onboarding), `/field-check` (existing M0 page, keep it).
- **i18n**: `import { t, plural } from '../i18n'`; `t('dex.title')`; placeholders like `{count}`: `t('dex.caughtCount', { count: 12 })`; `plural(n, ['pták', 'ptáci', 'ptáků'])` for Czech plural forms (1, 2 to 4, 5 and more). Keys are typed. One file per feature in `src/i18n/cs/`, merged in `src/i18n/cs/index.ts` with the file name as the key prefix.
- **Engines**: screens get engines from `getEngines()` in `src/ml/engines.ts`. With `?engines=fake` in the URL (or `localStorage['birddex:engines'] = 'fake'`) they get the fakes from `src/ml/fakes.ts`, which return fixed, believable results instantly. Screen tests and e2e flow tests use fakes. Engine tests use the real models.
- **Result hand-over**: scan screens put a `PendingIdentification` into the in-memory store in `src/state/pending.ts` and navigate to `/result`.
- **Database** (`src/db`): `addCatch`, `listCatches`, `catchesBySpecies`, `deleteCatch`, `getMedia`, a hook for the caught summary per species, `exportBackup()` and `importBackup()` (zip with JSON and media, using `fflate`). F1b defines exact signatures; read the code.
- **Species data**: `src/data/species.ts` loads `public/data/species.json` and offers lookup, search and filter helpers. Built by `scripts/build-species.py`.
- **Models**: `scripts/fetch-models.mjs` writes `public/models/manifest.json` (version 2): `{ version: 2, files: [{ id, file, bytes, sha256, label }], benchmarks: [{ id, label, runtime: 'litert'|'ort', file, input: { shape, dtype } }] }`. The app reads it through `src/ml/runtime/modelStore.ts`, which downloads with progress, checks the checksum, and keeps files in Cache Storage so the app works offline afterwards. Engines ask the model store for bytes; they never fetch model files themselves.
- **Thresholds**: `src/domain/thresholds.ts` holds the catch rules per method and `Sensitivity`. Starting values: sound normal 0.70, strict 0.85, easy 0.55; photo normal 0.60 with a margin over the second guess, strict 0.75, easy 0.45. Engine owners may recommend better numbers from measurements in their notes.

## 5. Quality bar and conventions

- TypeScript strict, no `any`, small modules. Put logic in pure functions and unit-test it (Vitest; `fake-indexeddb` and `jsdom` are installed). React function components and hooks, plain CSS (tokens in `src/styles`), no UI framework.
- Match the style of the existing code: 2 spaces, no semicolons, single quotes. Comments only where the reason is not obvious. No emoji in code or UI text; use drawn SVG icons.
- **Every task ends with all of these green**: `npx tsc --noEmit`, `npx vitest run`, your e2e tests, and `npm run build`. Do not report success if any is red; report exactly what fails.
- **Run e2e with your own port** so parallel runs do not collide: `CHROMIUM_PATH=/opt/pw-browsers/chromium E2E_PORT=<your port> npx playwright test tests/e2e/<file>`. Each port builds into its own `dist-e2e-<port>` folder. Fake microphone from a file: add `FAKE_AUDIO_FILE=/home/user/birddex/tests/fixtures/audio/birdnet-demo-sample.wav`.
- **Never run `pkill -f` or `killall`** (it kills your own shell). Stop servers you start by PID. Leave nothing running in the background.
- Do not commit and do not push. The integrator commits after each phase.
- Mobile first: design for 360 to 430 px wide, check with Playwright screenshots at 390x844 and 360x800 (look at them with the Read tool), touch targets at least 44 px, respect safe-area insets, no horizontal scroll.
- iOS Safari rules: create the `AudioContext` inside the tap handler; no `SharedArrayBuffer` (GitHub Pages cannot send COOP/COEP headers, so WebAssembly is single-threaded); keep memory low (one big model at a time where possible); no vibration API; camera and microphone permissions can be re-asked; a camera stream can stall in home-screen mode.
- **Offline**: after the first visit and the model download, everything works with no network. The service worker rules in `vite.config.ts` (CacheFirst for `/models/` and `/vendor/`) must keep working.
- **Privacy**: nothing leaves the phone except first-time downloads and optional Wikipedia photo and place-name lookups.
- **Failure messages in Czech**: microphone or camera denied, camera stalled, no network for the model download, storage full, model failed to load. Every failure needs a calm message and a next step (retry, open settings), never a blank screen.
- Write `docs/notes/<area>.md` when you finish: decisions, public API, gotchas, what you could not test here.

## 6. What "done" looks like (the owner's morning test)

1. Open the app, see the welcome screen, then the Dex with hundreds of European birds, silhouettes for the ones not caught, filters for Czechia and Europe, search, progress.
2. Scan by sound: tap, allow the microphone, see a level meter and live top 3, stop, see the result screen. Catch is possible only above the threshold, with a confirmation. The saved catch has date, place and the audio clip.
3. Scan by photo: take or pick a photo, see the top 3, catch with confirmation, photo saved.
4. Live camera: point at a bird, see it lock on, catch.
5. The Dex shows caught birds with date, place and the saved photo or clip; settings (sensitivity, backup and restore); credits and licences page; works offline.

## 7. GitHub and deploy facts (these supersede anything said elsewhere, including task prompts)

- The owner created the public repo https://github.com/Drcir02/BirdDex (the name is spelled `BirdDex`; an earlier lower-case link redirects to it). It is attached to this session, and `origin` is set in `/home/user/birddex`. The owner has installed the Claude GitHub App on it, so pushes work. If a push is ever refused with HTTP 403, the app was removed (https://github.com/apps/claude/installations/select_target); do not try to work around it, and never force-push.
- **Do not create or edit files under `.github/workflows/` (only the main session does).** Until the owner widened the app's access, GitHub refused any push that touched that folder. The Pages workflow is now installed at `.github/workflows/pages.yml` (it was pushed by the main session on 2026-10-17, and it builds and deploys at every push to `main`). `deploy/pages.yml` is an identical copy; the main session keeps the two the same. `scripts/checkpoint.sh` still has a safety net: if a commit does touch that folder, it publishes one snapshot commit instead, with the folder left exactly as GitHub has it.
- Publishing works through `scripts/checkpoint.sh` (run only by the checkpoint helper): it commits locally, puts the commits on top of anything new on GitHub (for example the workflow file the owner adds in the web editor), writes a zip, and pushes the normal history to `main` (a plain fast-forward). Local `main` tracks `origin/main`, so there should never be unpushed commits after a checkpoint. Other agents never commit or push.
- `MORNING.md` must therefore say: (1) the workflow is already installed, so nothing to copy; (2) the owner switches Pages on once: Settings, Pages, Source: GitHub Actions (the API for that is blocked for this session, so only the owner can do it; if the site address answers, it is already done); (3) the site lives at https://drcir02.github.io/BirdDex/ (the repo name is `BirdDex`, and the workflow takes the address from the repo name) and updates by itself after every push to `main` (about 3 to 5 minutes; progress is under the repo's Actions tab). Describe the fallback too: `scripts/deploy-gh-pages.sh`, and the zip snapshots sent in the chat.

## 8. Things that cannot be tested here (be defensive instead)

Real iPhone or Android microphone, camera and location behaviour; real speed on a phone; real bird sounds and photos from Czech gardens; Wikipedia photo lookups (blocked here, so test them with mocked responses). Write the defensive code and the Czech error messages, and say in your notes what remains unverified.
