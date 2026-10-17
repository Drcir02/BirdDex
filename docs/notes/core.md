# Core: database, settings, thresholds, model store, engines and fakes (task F1b)

Everything here is plain TypeScript with no screens. Screens and engines import these modules; the paths below are the
public API. All of it is covered by unit tests (`tests/unit/core-*.test.ts`, `tests/unit/fetch-models.test.ts`) and by
real-browser tests (`tests/e2e/core.spec.ts`, `tests/e2e/field-check.spec.ts`).

## Quick reference

| Need | Import | Call |
|---|---|---|
| Save a catch | `src/db` | `await addCatch({ speciesId, method, confidence, location?, placeName?, note? }, media?)` |
| Dex progress | `src/db` | `const { ready, bySpecies, speciesCount, catchCount } = useCaughtSummary()` |
| Catches of one bird | `src/db` | `useSpeciesCatches(speciesId)` (live) or `await catchesBySpecies(id)` |
| Show a saved photo or play a clip | `src/db` | `const { url, kind, loading, missing } = useMediaUrl(mediaId)` |
| Back up and restore | `src/db` | `exportBackup()` gives a zip `Blob`; `saveBackupFile(blob)` shares or downloads it; `importBackup(file)` gives an `ImportReport` |
| May the user catch it? | `src/domain/thresholds` | `evaluateCandidates(candidates, method, sensitivity)` |
| Settings | `src/state/settings` | `const { settings, update } = useSettings()` |
| Hand over to /result | `src/state/pending` | `setPending(...)`, `usePending()`, `clearPending()`, `getPendingCatchId()` |
| Where am I | `src/state/location` | `await getCurrentLocation({ timeoutMs })` |
| Engines | `src/ml/engines` | `getEngines()` |
| Model files | `src/ml/runtime/modelStore` | `getModelBytes(id, onProgress)`, `ensureModels(ids, { modelId, onProgress })` |
| What is downloaded | `src/state/modelStatus` | `useModelStatus()` |

## Thresholds (`src/domain/thresholds.ts`)

`evaluateCandidates(candidates, method, sensitivity)` returns one verdict per candidate, in the input order:
`{ speciesId, confidence, margin, allowed, reason? }`. `reason` is `'low-confidence'` or `'unclear-margin'` and is set
exactly when `allowed` is false. If both rules fail, `low-confidence` wins.

| Method | strict | normal | easy |
|---|---|---|---|
| sound | 0.85, no margin | 0.70, no margin | 0.55, no margin |
| photo and live | 0.75, lead 0.25 | 0.60, lead 0.15 | 0.45, lead 0.10 |

- "Lead" (`margin`) is the candidate's confidence minus the strongest of the *other* candidates. With no other candidate
  the missing rival counts as 0. Equal scores are a tie (margin 0), so photos are blocked and sound is not.
- Sound has no lead rule on purpose: BirdNET scores each species alone, so two birds singing together can both be
  caught. A non-leading photo candidate is blocked as `unclear-margin` when it is confident enough but trails the leader.
- Comparisons have 1e-9 of slack, so a score exactly on a threshold is allowed (`0.7 - 0.55` is `0.1499999999999999`).
- The table is `CATCH_RULES`; engine owners who measure better numbers change it there (and the tests that name numbers).
- The live camera uses the photo rules for the current frame.

## Database (`src/db`)

Dexie database `birddex`, three tables: `catches`, `media`, `photoCache`. The schema is a list (`SCHEMA_VERSIONS` in
`database.ts`): to change it, append a version with the changed tables and an `upgrade` function, never edit version 1.
A test upgrades a real old database and checks the migration runs.

- `addCatch(input, media?)` writes the media row and the catch row in **one transaction**: if anything fails nothing is
  kept (tested with a failing write and with a pretend full disk). Returns the saved `CatchRecord` including `mediaId`.
  Throws `StorageFullError` when the phone has no room; any other error passes through unchanged.
  **Double taps:** pass `id: getPendingCatchId()` (from `src/state/pending.ts`, one id per identification). If a catch with
  that id already exists, nothing is written and the existing catch is returned, so tapping Catch twice saves one catch.
  After the first save it asks the browser for persistent storage (`navigator.storage.persist()`), fire and forget,
  so iOS and Chrome are less likely to clear the data. It never delays or fails the catch.
- `listCatches({ limit?, offset? })` newest first. `catchesBySpecies(id)` newest first (uses a compound index).
  `countCatches()`, `getCatch(id)`, `getMedia(id)`.
- `deleteCatch(id)` also deletes the catch's media unless another catch still uses it. `deleteAllCatches()` clears
  catches and media (not the photo cache). `updateCatchNote(id, note)`.
- `useCaughtSummary()` is built on Dexie `liveQuery` and `useSyncExternalStore`. It returns the *same object* until
  the data changes. `bySpecies.get(speciesId)` gives `{ count, firstCaughtAt, lastCaughtAt, mediaId?, mediaKind? }`.
  The representative media is the newest *photo* (photo or live catch) if the species has one, otherwise the newest
  clip. `mediaKind` says which, so the Dex knows whether it can draw `mediaId` as a picture. `ready` is false until the
  first answer arrives (avoid flashing "0 caught"); `error` is set if the database cannot be read.
  Also live: `useSpeciesCatches(id)`, `useRecentCatches(limit)`, and the generic `useLiveQuery(query, deps, initial)`.
- `useMediaUrl(mediaId)` creates an object URL for `<img src>` or `<audio src>` and revokes it on unmount or id change.
- Reference photos: `getCachedPhoto(speciesId)`, `putCachedPhoto(record)`, `clearPhotoCache()`. A `PhotoCacheRecord` is
  `{ speciesId, thumbnailUrl, author, licence, link, fetchedAt, thumbnail?: Blob }`. An empty `thumbnailUrl` is the
  agreed way to remember "looked it up, there is no photo". Save the `thumbnail` blob too if the photo should show offline
  (the service worker does not cache images from Wikimedia).
- Errors: `StorageFullError` (also thrown by `putCachedPhoto`). Map it to "the phone is full, free some space".

### Backup file

`saveBackupFile(blob, fileName?)` gives the file to the user: the share sheet where the browser can share files (iPhone,
Android; it has "Save to Files"), otherwise a download. It returns `'shared'`, `'downloaded'` or `'cancelled'`. **Call it straight
from a tap**: browsers refuse the share sheet for a tap that is a few seconds old, so if building the backup takes a while, show
a "ready" button and call it from that. (If sharing is refused it falls back to a download.) To restore, use
`<input type="file" accept=".zip,application/zip">` and pass the `File` to `importBackup`.

`exportBackup()` returns a zip `Blob` (fflate): `manifest.json` (format `birddex-backup`, `formatVersion` 1, app
version, ISO date, counts, the list of photos and clips), `catches.json` (list of `CatchRecord`) and
`media/<id>.<ext>`. Photos and clips are read and packed one at a time, JPEG, PNG, WebP and the like are stored without
compressing, WAV is deflated. `backupFileName()` gives `birddex-backup-2026-10-17.zip`.

`importBackup(file, { onProgress? })` **checks everything before it writes anything**, then merges by id (a catch that
already exists is left alone, the others are added, each with its media in one transaction). It returns
`{ total, added, skipped, mediaAdded, mediaMissing }`. Running it again changes nothing; if it stops half way (full
phone) running it again continues. It throws `BackupError` with `code`:

| code | meaning | reaction (the settings screen owns the texts) |
|---|---|---|
| `not-a-zip` | not a zip, damaged, or unreadable | "this is not a BirdDex backup" |
| `not-a-backup` | a zip, but not made by BirdDex | same |
| `too-new` | made by a newer BirdDex | "update the app first" |
| `malformed` | a BirdDex backup with broken content (`message` says where) | "the backup is damaged" |
| `storage-full` | no room while restoring; `error.report` says what was restored | `commonErrorKey` gives `storageFull` |

A catch whose photo or clip is missing from the file is still restored, without it (counted in `mediaMissing`).
Unknown fields are dropped; sizes, paths and numbers are validated.

## State (`src/state`)

- `settings.ts`: `Settings = { sensitivity: 'strict'|'normal'|'easy' (default normal), soundEffects: boolean (default true) }`,
  stored in localStorage under `birddex:settings`. `useSettings()` returns `{ settings, update }`; `update({ sensitivity: 'easy' })`
  saves and re-renders every user of the setting, also across tabs. `getSettings()` and `updateSettings()` work outside React.
  Damaged or invalid stored data falls back to defaults field by field; if localStorage is blocked the settings still
  work until the app closes. (The welcome flag is **not** here: the shell keeps its own in `src/app/welcome.ts`.)
- `pending.ts`: in-memory only. `setPending(p)`, `getPending()`, `clearPending()`, `usePending()`, and `getPendingCatchId()` (one id per identification, for `addCatch`).
- `location.ts`: `getCurrentLocation({ timeoutMs = 8000 })` returns a `GeoPoint` or `undefined` and **never throws**.
  The first call is what makes the browser ask for permission, so call it when you want that prompt. A fix is reused
  for 5 minutes. A refusal is remembered for 5 minutes (no prompt storm). Callers who arrive while the browser is still
  asking share one request. If the caller gives up (timeout) a fix that arrives later is still remembered. The browser
  keeps trying in the background for up to 20 s. `getCachedLocation()` returns the fresh fix without asking.
  It asks for a coarse position (`enableHighAccuracy: false`): quick and enough to name a place.
  **Tap handlers that must start audio must not wait for the position** (iOS only starts audio inside the tap): call
  `getCurrentLocation()` when the screen opens to warm the cache, and in the tap use the synchronous `getCachedLocation()`.
  Note that an iPhone home-screen app asks for location permission again on every launch.
- `storage.ts`: `isQuotaExceededError(error)` (looks inside Dexie's wrapped errors), `requestPersistentStorage()`, `getStorageUsage()` (`{ usedBytes, quotaBytes, persistent }` for the settings screen, or undefined).
- `failures.ts`: `commonErrorKey(error)`, see "Failure handling" below.
- `modelStatus.ts`: `useModelStatus()` returns the model store's status (below), or `undefined` until looked up.

## Model store (`src/ml/runtime/modelStore.ts`)

Reads `models/manifest.json` (version 2), downloads files as a stream with progress, checks the SHA-256, and keeps
them in Cache Storage under **`birddex-models-v1`**, so the app works offline afterwards. Engines never fetch model
files themselves.

File ids (from the manifest, also exported as `MODEL_FILE_IDS`):

| id | file | what |
|---|---|---|
| `birdnet-fp16` | `birdnet-v2.4-fp16.tflite` | BirdNET V2.4: `[1,144000]` audio in, `[1,6522]` logits out |
| `birdnet-geo-fp16` | `birdnet-v2.4-geo-fp16.tflite` | location filter: `[[lat, lon, week]]` in, `[1,6522]` out |
| `wingclip-onnx` | `wingclip_visual_int8.onnx` | WingCLIP graph, needs the `.data` file next to it |
| `wingclip-data` | `wingclip_visual_int8.data` | its weights (pass as ORT `externalData` with path `wingclip_visual_int8.data`) |
| `wingclip-text` | `text_classifier_int8.bin` | species classifier (int8 rows plus per-row scales; last row is the bird probe) |

The FP32 BirdNET file is **not** in the manifest on purpose: it is only for tests and comparison and is read from disk
(`public/models/birdnet-v2.4-fp32.tflite`).

API:

- `getModelBytes(fileId, onProgress?)` gives a `Uint8Array`. `onProgress(loadedBytes, totalBytes)`; from the cache it is
  called once with `(total, total)`. The bytes may be shared: treat them as read-only. Concurrent calls for the same
  file share one download.
- `ensureModels(fileIds, { modelId, onProgress })` makes sure several files are on the phone, **one file at a time**, with
  one combined progress as `ModelProgress` (`stage: 'downloading'`, bytes counted over the whole set, files already
  there count as done). It does not keep the bytes in memory. **Recommended use in an engine's `prepare()`:**
  `await ensureModels([ids], { modelId: 'birdnet', onProgress })`, then report `preparing`, then load each file with
  `getModelBytes`, then report `ready`.
- `planDownload(ids)` gives `{ totalBytes, missingBytes, missing }` (ask before downloading, to warn about mobile
  data); `areModelsCached(ids)`.
- `getModelStatus()` and `subscribeModelStatus(listener)`: per file `state` (`missing`, `downloading`, `ready`,
  `failed` with its error), overall `state` (`ready`, `partial`, `missing`, `downloading`, `failed`, `unavailable`),
  `totalBytes`, `readyBytes`, `persistent` (false where Cache Storage does not work). Use the hook `useModelStatus()`.
- `deleteCached()` removes the downloaded models (and the service worker's copy, see gotcha 1) to free space.
- `getModelManifest()`; `parseManifest(json)` (strict for `files`, lenient for `benchmarks`).

Failure handling (all extend `ModelStoreError`, which has `fileId?`). **The Czech texts already exist** in
`src/i18n/cs/common.ts` (`errors.*`); `commonErrorKey(error)` from `src/state/failures.ts` picks the right key for any
failure of the database, the backup or the model store:
`t(`common.errors.${commonErrorKey(error)}` as const)`, next to a "Zkusit znovu" button.

| class | when | `commonErrorKey` |
|---|---|---|
| `ModelDownloadError` | `reason`: `offline`, `network`, `http` (see `status`), `incomplete`, `manifest`, `unknown-file` | `offline` gives `network` ("Chybí připojení k internetu..."), all others `modelDownload` |
| `ModelChecksumError` | the file is not the right one (damaged, or an old copy on the server); `expected` and `actual` | `modelDownload` |
| `ModelStorageFullError`, `StorageFullError`, `BackupError('storage-full')` | no room (`neededBytes`, `availableBytes` when known) | `storageFull` |
| anything else | | `generic` |

A model that downloaded fine but fails to *start* (`errors.modelLoad`) is the engine's own failure, not the store's.

Details that matter:

- Retries: 3 attempts per file with 0.8 s and 2.5 s pauses. 503, 429, 408, dropped connections, a stall of 30 s without
  data all retry. A 404 does not. The phone saying it is offline stops retrying at once.
- A broken download is **resumed** with an HTTP Range request when the server allows it (GitHub Pages should); the progress
  then carries on from where it stopped. If the server ignores Range the file starts again and the progress restarts at 0.
- A wrong checksum is downloaded once more, then `ModelChecksumError`. More bytes than the manifest says stops at once.
- The request address is `models/<file>?v=<first 16 hex of the sha256>`: it changes with the file, so neither the HTTP cache
  nor the service worker can serve an old version. Cache Storage entries carry the checksum in a header; an entry with
  another checksum is thrown away and downloaded again.
- Before downloading it asks `navigator.storage.estimate()` and fails early with `ModelStorageFullError` if the files
  clearly do not fit. Estimates it cannot make sense of are ignored.
- Without Cache Storage (an http address, some private modes) the bytes are still returned; they just do not persist
  (`status.persistent` is false).
- The model list itself is also kept in Cache Storage, so the store works offline even when the service worker has no copy.
- `crypto.subtle` exists only on https and localhost; over plain http (a phone on the home network) a JavaScript SHA-256
  (`sha256.ts`, tested against Node for every block boundary) takes over.

## Engines (`src/ml/engines.ts`) and fakes (`src/ml/fakes.ts`)

`getEngines()` returns `{ sound, photo, live }` (the `Engines` type) **synchronously**. The real engine modules are loaded
lazily on first use, so call `prepare()` before the tap that calls `start()`: once loaded, `start()` runs in the same
tick as the tap, which iOS needs for audio. (Calling `start()` first still works; it waits for the module.)

**Contract for tasks E1 and E2.** I created stubs because the files did not exist. Each stub says `STUB: replaced by task E1/E2`:

| File | Must export | Returns |
|---|---|---|
| `src/ml/sound/engine.ts` (E1) | `createSoundEngine()` | `SoundEngine` |
| `src/ml/vision/engine.ts` (E2) | `createPhotoEngine()` | `PhotoEngine` |
| `src/ml/vision/live.ts` (E2) | `createLiveScanner()` | `LiveScanner` |

`getEngines()` also accepts a ready-made object (`soundEngine`, `photoEngine`, `liveScanner`) or a default export (factory or
object), so a different export style still works. The factory is called once.

Fakes: `?engines=fake` in the address (also behind the `#`, e.g. `/#/scan/sound?engines=fake`) or
`localStorage['birddex:engines'] = 'fake'`; the address wins. `?engines=real` forces the real ones. Choose the story with
`?fake=<scenario>` (or `birddex:fake`) and the speed with `?fakeDelay=<ms>` (or `birddex:fakeDelay`, `0` for fast tests;
default 150).

| scenario | sound | photo and live | Catch button |
|---|---|---|---|
| `clear` (default) | great tit 0.91, blackbird 0.22, robin 0.09 | great tit 0.88, robin 0.07, blackbird 0.03 | works, even strict |
| `low` | robin 0.41, great tit 0.23, blackbird 0.12 | same numbers; live never locks on | off, `low-confidence` (also easy) |
| `unclear` | blackbird 0.74, great tit 0.71 | blackbird 0.62, great tit 0.58 | photo and live: off, `unclear-margin`; sound: both allowed |
| `empty` | nothing heard, no clip | no candidates, `pBird` 0.03 | nothing to catch |
| `download-error` | `prepare()` fails once with `ModelDownloadError(network)`, then works | same | tests "try again" |
| `storage-full` | `prepare()` always fails with `ModelStorageFullError` | same | tests the full-phone message |

Species ids used: `parus-major`, `erithacus-rubecula`, `turdus-merula`. A unit test checks they exist in
`public/data/species.json` once that file is built (it is skipped while the file is missing).
The fake sound session takes 3 steps before it names a bird, then the scores grow to their final values; `stop()` returns a
2 second chirp WAV (16-bit mono 48 kHz) as the clip. The fake live scanner locks on after 3 frames and `snapshot()` is a
JPEG of the real video frame (or a small stand-in picture when the video has no frame). The fakes report progress with the
real model sizes. The fakes are a separate chunk: the normal app never downloads them.

## scripts/fetch-models.mjs

`node scripts/fetch-models.mjs` checks every file in `public/models/` against the pinned size and SHA-256 from BRIEF section 2,
downloads only what is missing or wrong (to a `.part` file, replaced only after the checks pass; 3 tries, a 404 is not
retried), and writes `public/models/manifest.json` (version 2) listing only files that are present and right, and only
the benchmarks whose files are all present. It needs no network when the files are already there. Flags: `--force`,
`--with-fp32` (also fetch the 49 MB FP32 BirdNET for tests; never listed in the manifest), `--strict` (exit 1 if
anything is missing; default is to exit 1 only when nothing is available, so CI still builds the app), `--config` and `--out`
(used by the tests). Sources are pinned to the BirdNET-Analyzer tag `v1.5.1` and the WingDex commit `b0dda4b7...` (see the script).
I verified every pinned hash against those upstream commits in the local git clones, and ran the script here: all five files
report "already there ... checksum is right" and the manifest was written.

Benchmarks in the manifest: `birdnet-fp16` (LiteRT, input `[1,144000]`) and `wingclip-onnx` (ORT, input `[1,3,224,224]`,
`externalData: ['wingclip_visual_int8.data']`). The Field check (`src/fieldcheck/checks/models.ts`) reads them through
`parseManifest`, downloads the `externalData` files too and passes them to ONNX Runtime as `externalData`.

## Tests and how to run them

- Unit (no model files needed, about 7 s for the whole project): `npx vitest run`. Mine are `tests/unit/core-*.test.ts` and `fetch-models.test.ts`.
  `core-flow.test.ts` is the scan-to-catch flow written like a screen would write it; read it as an example.
- Real browser: `CHROMIUM_PATH=/opt/pw-browsers/chromium E2E_PORT=4182 npx playwright test tests/e2e/core.spec.ts tests/e2e/field-check.spec.ts`
  (about 45 s plus the build). `core.spec.ts` has no screen to drive yet, so it bundles `tests/e2e/helpers/core-entry.ts` for the
  browser with Vite's library mode and loads it into a page as `window.BirdDexCore`. That runs the database, backup, model store,
  location, settings and fakes in real Chromium, including small React screens that use the hooks (in StrictMode), with
  the real model files downloaded from the preview server, a reload while offline, and a download that is cut off and resumed.
  The tests that need the real models skip themselves when `public/models/manifest.json` is missing.
- To change what the core exports to the browser tests, edit `core-entry.ts`.

## Measurements on this machine (headless Chromium, 4 shared cores; a phone will be 3 to 6 times slower)

- BirdNET FP16 through LiteRT.js on wasm: model ready in about 250 ms, first run 360 to 400 ms, then **70 to 80 ms per 3 second window**.
- WingCLIP int8 through ONNX Runtime Web on wasm (with the `.data` file as `externalData`): ready in 1.3 s, first run about 1 s,
  then **about 440 ms per picture**. WebGPU is not available in headless Chromium, so it was not timed.
- All five model files (89 MB) from the local preview server: 4.3 s including the SHA-256 checks and writing Cache Storage.
- 300 catches (200 photos of 250 KB, 100 clips of 288 KB; 79 MB): backup 2.4 s, restore 1.9 s, longest main-thread task 68 ms.
  The Dex summary over 300 catches: 8 ms.

## Files I added outside the exact list in BRIEF section 3

All inside my own folders: `src/ml/runtime/modelErrors.ts`, `modelManifest.ts`, `sha256.ts` (pieces of the model store, re-exported by
`modelStore.ts`), `src/db/*` (several files), `src/state/*` (settings, pending, location, storage, failures, modelStatus),
`tests/unit/helpers/fake-model-server.ts`, `tests/e2e/helpers/core-entry.ts`, `tests/e2e/core.spec.ts`. Small edits outside my list, as the task asked:
`src/fieldcheck/FieldCheck.tsx` (three lines: `loadBenchmarks` instead of `loadModelList`) and `tests/e2e/field-check.spec.ts`
(model tests only). Stubs: `src/ml/sound/engine.ts`, `src/ml/vision/engine.ts`, `src/ml/vision/live.ts`.

## Gotchas

1. **The service worker also caches the models.** `vite.config.ts` has CacheFirst for everything under `/models/`, so a
   downloaded model exists twice (`birddex-heavy-v1` and `birddex-models-v1`), about 89 MB each. `deleteCached()` empties both,
   so "free space" really frees it. If the integrator wants to save the duplicate, drop the `/models/` part of that rule in
   `vite.config.ts` (keep the NetworkFirst rule for `manifest.json`): the model store persists the files itself and works offline
   without the worker. I did not touch `vite.config.ts`.
2. **Tests with blobs run in the node environment.** In jsdom, fake-indexeddb copies jsdom's `Blob` as an empty object. DB tests that
   store blobs use the default node environment; hook tests use jsdom and, where they need a blob, swap in Node's `Blob`
   (`core-db-live.test.ts` shows how).
3. **Vitest runs without globals**, so React Testing Library does not clean up by itself. Call `cleanup()` in `afterEach`.
4. **`spawnSync` deadlocks with an in-process test server.** The old `fetch-models` test did that and hung forever. The new
   test uses `spawn` and waits for the exit event.
5. **Do not run `useLiveQuery` with deps that change every render**; pass the values the query depends on.
6. `getEngines()` decides real or fake the first time it is called. `resetEngines()` is for tests.
7. The Field check's own "no models" test now answers the manifest itself (404). Before, it relied on the manifest not existing, which
   is no longer true on a machine that has the models.

## Not tested here (be careful on the phone)

- Real iPhone and Android: Cache Storage eviction by iOS, the real quota (`estimate()` can be rough on Safari), whether
  `navigator.storage.persist()` is granted, IndexedDB blob behaviour on old iOS versions.
- A real GitHub Pages download: Range/resume support, redirects from `github.com/.../raw/...` (the script) are untested because this
  machine cannot reach GitHub. The script's download path is tested against a local server.
- Location: the permission prompt text and timing on real phones (only the pretend position of Playwright is tested).
- The 5-minute location cache and 20 s background wait are guesses; tune them if the first catch of a trip has no place name.
- Thresholds are the starting values from the brief; nobody has measured them on real recordings or photos yet.
