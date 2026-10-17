# Integration of the real engines (task I1)

The screens, the engines and the data were built by different tasks. This task made them one app: real engines by default, the
reference photos, the first-run download, offline use, the thresholds, memory, pictures from real phones, and end-to-end tests
with the real models. An earlier attempt was interrupted; its work was kept (the flow tests, the location prior) and finished.

## What is verified, and how

| What | How | Result |
|---|---|---|
| `npx tsc --noEmit` (src and tests) | | clean |
| `npx vitest run` | no model files needed | 81 files, 1655 tests pass |
| `tests/e2e/flows.spec.ts` | real engines, real models, Chromium, port 4220 | 13 tests (sound, photo, live, offline, backup, first-run download) |
| `tests/e2e/integration.spec.ts` | start-up weight and the pictures of a real phone | 6 tests (5 need no models) |
| the whole Playwright suite (203 tests, 14 minutes) | after the thresholds and the photo decoding changed | 202 passed, 1 failed (`core.spec.ts` still expected the old fake numbers); fixed, then `core`, `flows`, `integration` and `scan` run again after the memory change: 72 passed |
| `npm run build` (includes `tsc --noEmit` over src and tests) | | green |

Run them one spec at a time, with generous time (the machine has four shared cores; `flows.spec.ts` needs about 3 minutes,
`sound-engine.spec.ts` about 4):

```
CHROMIUM_PATH=/opt/pw-browsers/chromium E2E_PORT=4220 npx playwright test tests/e2e/flows.spec.ts
CHROMIUM_PATH=/opt/pw-browsers/chromium E2E_PORT=4220 npx playwright test tests/e2e/integration.spec.ts
```

`flows.spec.ts` starts its own Chromium with `--use-file-for-fake-audio-capture=tests/fixtures/audio/birdnet-demo-sample.wav`, so
`FAKE_AUDIO_FILE` is not needed (setting it does no harm). Both specs skip the model tests when `public/models` is missing.

## 1. Real engines are the default; the reference photos

- `getEngineMode()` returns `'real'` unless `?engines=fake` (in the address or behind the `#`) or `localStorage['birddex:engines'] =
  'fake'`. Nothing in the app sets the fake flag; a unit test (`core-engines.test.ts`) and every real-model flow test rely on it.
- The Wikipedia reference-photo service (`src/features/photos`) was already used wherever a photo is expected: the guess cards of
  the result screen and the success screen (`src/features/scan/ReferencePhotoBox.tsx`, `ResultCard.tsx`, `SuccessView.tsx`), the species
  cards and the species page of the Dex (`ReferenceImage.tsx`, `SpeciesPhoto.tsx`). Nothing was left unwired. The credit (author,
  licence, link) is shown next to every picture; offline the silhouette stays. The only way to see the real answers of Wikipedia is
  on a phone (this machine cannot reach it); the e2e tests use `mockWeb()`.

### The location prior (BirdNET's location model for photos): kept, with a cap

`src/ml/vision/geoPrior.ts` gives the photo engine and the live scanner an `OccurrencePrior` made from BirdNET's location model
(`birdnet-v2.4-geo-fp16.tflite`, 15 MB, run in a short-lived worker `src/ml/sound/geo.worker.ts` so the page keeps no extra memory).
It never downloads anything (it uses the model only when the hub's "bird brain" download already put it on the phone), it needs a
position (no position, no prior), and any failure means "no prior" (`prior.ts` catches it and warns).

**Measured** on the ten fixture photos, the position of Prague, with the ONNX model in the browser (the numbers are the top
confidence of the top guess; "none" is the engine without the prior, from photo-engine.md):

| Photo | none | raw scores, floor 0.01 (October / May) | raw scores, floor 0.1 | **capped at 0.2 (October / May), shipped** |
|---|---|---|---|---|
| Common Goldeneye (right) | 0.63, Barrow's 0.32 second | 0.84 / 0.61 | 0.61 (Barrow's 0.31) | **0.88 / 0.74** (Barrow's 0.01 / 0.07) |
| Great Cormorant (right) | 0.75 | 0.64 / **0.47** | 0.64 | **0.77 / 0.77** |
| Common Kingfisher (right) | 0.985 | 0.988 / 0.954 | 0.985 | 0.992 / 0.978 |
| Mallard, Rock Pigeon (right) | 0.996, 0.986 | same | same | same |
| Geese from Fujian (not in the Dex, read as Pink-footed Goose) | 0.67 | 0.09 / 0.23 | 0.44 | **0.15** (Graylag) |
| Gulls from Seattle | 0.39 | 0.08 / 0.16 | 0.28 | **0.28 / 0.11** |
| Hairy Woodpecker (American; read as Three-toed) | 0.48 | 0.20 | 0.18 | **0.25** (Great Spotted) |
| House Sparrow in a mosaic (a known miss: Mandarin Duck) | 0.78 | 0.59 | 0.72 | 0.69 / 0.52 |
| Unknown bird (no position, so no prior) | 0.54 | unchanged | unchanged | unchanged |

What the table says:

- Used as they come (floor 0.01), the location scores help foreign birds and the Goldeneye in autumn, but they also **lower a bird
  that is right and merely not especially common in Prague**: the Cormorant fell from 0.75 to 0.47 in May, below every catch
  threshold. The reason is the softmax also holds the birds that are not in the Dex ("rivals"); they have no opinion from the prior
  and are never held back, so every Dex bird with a low occurrence score loses against them.
- Capping the scores (`PRESENT_SCORE = 0.2`: a bird at or above 0.2 counts as fully expected, only the ones below are held back in
  proportion) keeps the effect on birds that are really unexpected and removes the cost on the right ones. It "measurably helps"
  (Goldeneye 0.63 to 0.88, Barrow's Goldeneye out of the picture, the foreign look-alikes under 0.3) and "costs little" (no right bird
  lost anything; a fraction of a second once per place and week, in a worker that gives its memory back).
- A cap of 0.5 was also measured (Goldeneye 0.86 / 0.66, Cormorant 0.77 / 0.64, geese 0.12, gulls 0.14 / 0.07): worse in May. 0.2 is
  one measurement on ten photos, of which four are European birds with a place; the cap is `PRESENT_SCORE` and the floor
  `SCORING.priorFloor` (0.01, changed from 0.001 so that "never seen here" holds a bird back by a factor of 100, less than the factor
  400 of a bird outside the Dex). Re-fit both when there are labelled photos from Czech gardens.
- The measuring spec that produced these numbers (`zz-measure-i1.spec.ts`) was deleted as asked. The first set (floors, October and
  May) was made by the interrupted attempt; the second set (caps) in this task, with the same harness (`window.birddexPhotoDev
  .setPriorWeights` on `/#/dev/photo`).
- The prior is installed by `src/ml/engines.ts` (`installGeoPriorLater`) when the photo engine or the live scanner is first loaded.
  A provider that somebody else registered is left alone (the developer page tries other priors).
- Unit tests: `tests/unit/vision-geo-prior.test.ts` (the cap, "no position", "model not downloaded", the cache, a model that will not
  compile). E2E: the flows spec runs the photo tests with Prague and a fixed day (17 October, week 39), where the Goldeneye is 84 %.

## 2. First-run download, offline

The hub (`/scan`) and the scan screens download through the engines' own `prepare()`; the model store checks every file's SHA-256
and keeps it in Cache Storage (`birddex-models-v1`). Tested end to end in `flows.spec.ts` ("first-run download of the models",
every case on the real files):

| Case | Result |
|---|---|
| first visit | the size is offered ("asi 90 MB"), a progress bar grows, "ready"; five files and the list are in `birddex-models-v1`; they are still there after a reload |
| no network when the button is pressed (service worker serving the app) | the banner says "Chybí připojení k internetu", "Zkusit znovu" downloads once the network is back |
| a damaged file (wrong checksum, served for `text_classifier_int8.bin`) | tried twice, refused, **not kept** in the cache, a calm message; the retry fetches a good copy |
| a connection that drops twice | retried by itself, nobody is bothered |
| a file that is gone (404) | a calm message and a retry key, the record key stays off, no endless spinner |
| a phone that is full (the estimate says so, then the write is refused) | the "V telefonu došlo místo" message both times; after "making room" the same screen downloads normally |
| no model list on the server | the hub says so instead of hanging |
| offline reload | with the service worker and the models cached, the app reloads with no network, the Dex opens, a photo is identified from the cached files, a sound scan works (BirdNET and the location model from the phone), a catch made offline is in the Dex; coming back online changes nothing |

`caches` after the first download: `workbox-precache` (102 entries: the app and its screens), `birddex-models-v1` (6), `birddex-model-list` (1),
`birddex-data-v1` (1, the species list), `birddex-heavy-v1` (5: the ONNX Runtime and LiteRT files from `vendor/`).

### Memory: one big model at a time (changed in `src/ml/engines.ts`)

BirdNET needs about 350 MB of WebAssembly memory, WingCLIP 230 to 260 MB. Each lets go of itself after an idle time (a minute and three
minutes), but a person goes from the photo screen to the sound screen in seconds, and the hub prepares both in a row. On a small iPhone
a tab with 600 MB can be killed. Now `sound.prepare()` first disposes the photo model (if one was ever loaded) and `photo.prepare()`
first disposes the sound model; `start()` and `identify()` are passed through untouched, so a scan is never interrupted and `start()`
still runs inside the tap. Tested in `tests/unit/core-engine-memory.test.ts` (with stand-ins for the engines). Not measured on a phone.

## 3. End-to-end flows with the real models (`tests/e2e/flows.spec.ts`)

| Flow | What it checks | Numbers seen here |
|---|---|---|
| (a) sound | the microphone plays the Lesser Redpoll recording; `/scan/sound` shows "Čečetka tmavá" first, "Slyším ptáka!", stop, the result lists it first and **Chytit works at normal**, confirmation, the Dex shows the species as caught, the catch has the place ("Praha") and a WAV clip that plays | 73 % in Prague in week 39 (94 % without a place: the location filter holds the redpoll back in October); longest page task 131 ms |
| (b) photo | the ten fixture photos through the file input: Kingfisher, Mallard, Pigeons first and catchable; Goldeneye first at 84 %; Cormorant in the top three at 64 %; **the Geese, Gulls, unknown tit and American woodpecker cannot be caught** and the screen says "nothing sure"; the Mallard is caught and the Dex shows the saved photo; the House Sparrow is a known miss (Mandarin Duck) and only reported | longest page tasks 113 ms (twice); about 0.9 s from "Určit" to the result |
| (c) live | Chromium's fake camera (a moving pattern) runs 8 s: no lock, no crash, no long task; the developer page reads the frame rate; a mocked `getUserMedia` stream painted from a fixture photo (`canvas.captureStream`): the gulls never lock, the Mallard locks and Chytit works, pointing back at the gulls lets go, the Kingfisher locks and is caught, the Dex shows it with a `live` catch | 1.41 to 1.45 frames per second; lock after about 3 updates |
| (d) offline | see section 2 | |
| (e) backup | a sound catch and a photo catch are exported from Settings (a browser download), the zip holds the manifest, both catches and both media; a fresh browser profile imports it, the Dex shows both, the clip plays and the photo shows; importing again changes nothing; a file that is not a backup gets a calm message | 459 KB for the two catches |

The date is fixed with `context.clock.setFixedTime` (the location filter depends on the week), the position is Prague, and the web
services (Wikipedia, Commons, Nominatim) are mocked with `mockWeb()`.

## 4. Thresholds (`src/domain/thresholds.ts`)

| | strict | normal | easy |
|---|---|---|---|
| sound (before) | 0.85 | 0.70 | 0.55 |
| sound (now) | 0.85 | 0.70 | **0.60** |
| photo and live (before) | 0.75, lead 0.25 | 0.60, lead 0.15 | 0.45, lead 0.10 |
| photo and live (now) | **0.85, lead 0.30** | **0.70, lead 0.20** | **0.55**, lead 0.10 |

Why, from the measurements in `sound-engine.md` section 7 and `photo-engine.md` ("Catch thresholds"):

- **Sound.** The one false alarm found is perfectly flat synthetic noise (0.55). A clear bird is 0.85 and up; faint real birds in a
  busy recording come out at 0.5 to 0.6. Easy at 0.60 stays just above the false alarm (the sound engine's recommendation); normal and
  strict are unchanged. The demo Lesser Redpoll is 0.73 at the position of Prague in October, so it passes normal (0.70) with only
  a little room: the location filter holds this bird back out of season. Without a position it is 0.94.
- **Photo and live.** What the model is sure about is 0.98 and up (Kingfisher, Mallard, Pigeons). The ambiguous Goldeneye is 0.63
  without the location filter (0.88 with it), the Cormorant 0.75 (0.77). The foreign birds that look European reach 0.67 (geese from
  Fujian read as Pink-footed Goose), 0.54 (an unknown tit) and 0.48 (an American woodpecker); gulls 0.39. A confident wrong one is
  possible (the House Sparrow in a mosaic is 0.78 Mandarin Duck: no threshold separates it from the right ones, so the
  confirmation step stays the safeguard). The old normal (0.60) let the foreign geese through when there is no position; 0.70 does not.
  Easy at 0.55 lets the geese through (that is what easy means) but not the unknown tit (0.541), the woodpecker or the gulls.
  Strict at 0.85 keeps even the Cormorant out.
- The fixture cases behave as asked: the clear Lesser Redpoll passes at normal; the Gulls, the Geese, the unknown bird (and the woodpecker)
  cannot be caught at normal, with or without the location prior (the flows spec asserts it with the prior; the numbers above are
  without).
- Tests updated for the new numbers: `core-thresholds`, `scan-result-model`, `scan-result-page`; the fake "unclear" photo story now
  has 0.78 against 0.74 (it must stay above the normal threshold to be blocked for its lead and not for its confidence).
  The settings screen shows the numbers from `catchRule()`, so it follows by itself.
- Possible later guard (n = 1 in the data, not built): the only confident wrong answer had `pBird` 0.86, all right ones 0.987 or more.

## 5. Pictures from a real phone (task item 7)

Fixtures (`tests/fixtures/phone`, made by `make-phone-fixtures.py` with Pillow): a 12.2 megapixel portrait shot stored sideways with EXIF
orientation 6 (4032x3024 stored, 3024x4032 upright, 560 KB), orientation 3 and 8 pictures, a PNG, a 12x9 JPEG, and a JPEG cut off after
a third.

What was wrong: the photo screen opened a file with `createImageBitmap(file, { imageOrientation: 'from-image' })`, which decodes the
**whole** picture first (48 MB for 12 MP, 190 MB for 48 MP) and only then scales it down. The orientation was already right.

What changed (`src/features/scan/imageHeader.ts`, `imageFile.ts`):

- The first 256 KB of the file are read (no decoding) to get the size and the EXIF orientation of a JPEG or the size of a PNG
  (`parseImageHeader`, tested on the real fixtures and on damaged input). The upright size follows from it (orientations 5 to 8 swap).
- A photo bigger than the working size (2048 px on the long side) is decoded by the browser **straight to that size**
  (`createImageBitmap` with `resizeWidth`/`resizeHeight`, `from-image`), so no 12 MP bitmap ever exists. If the browser ignores the
  request or applies it to the wrong shape (the result is checked against the expected aspect ratio), the old plain decode is used.
  Measured in Chromium: the resize arguments are the upright size, 3024x4032 asked as 1536x2048 gives 1536x2048, upright.
- A JPEG or PNG with an intact header that still cannot be decoded is damaged (a download that stopped): it now gives the Czech
  "Fotku se nepodařilo otevřít. Zkus jinou, nejlépe JPEG nebo PNG." The `<img>` fallback used to show the part that had arrived with a
  grey bottom, and the person could catch that half picture. Unknown formats (HEIC, WebP, no `createImageBitmap`) still go through
  `<img>` and keep their own HEIC message.
- A text file called `IMG_0001.jpg` and a PDF get their messages ("Fotku se nepodařilo otevřít", "Tohle není obrázek"); the two pickers
  stay on screen; a good photo afterwards works.

Tests (`tests/e2e/integration.spec.ts`, no models needed except the last): the 12 MP EXIF-6 photo opens in about 350 ms to a 1536x2048
preview that matches the upright picture (mean brightness difference 3.7 on a grid, against 35 for a turned one), the biggest bitmap the
page ever decoded is at most 2048 px and every bitmap was closed, no long page task; orientations 3 and 8 and the PNG come out upright;
the tiny picture opens and goes to the engine; the cut-off and non-picture files are explained; with the real model the 12 MP portrait
is the Mallard at normal sensitivity in 885 ms from "Určit" to the result with no long task, and the 12x9 picture gives a result
screen with nothing catchable. Unit: `scan-image-header.test.ts`.

Not done: a 48 MP picture still needs the browser to decode at the reduced size (it does, where `resizeWidth` is honoured; Safari has
ignored it in the past, then the old route costs 190 MB for a moment). Nothing here could run in Safari.

## 6. Performance

- Every screen is its own chunk (`React.lazy` in `App.tsx`), the engines load on first use, the fakes are a separate chunk, the ML
  runtimes are in `vendor/` and fetched by the engines. Entry chunk 315 kB (104 kB gzipped), the database chunk 121 kB (42 kB gzipped).
  Nothing to change.
- `integration.spec.ts` "startup": the Dex opens with 16 script files, 473 KB of JavaScript decoded, first contentful paint at 144 to 188 ms
  on a local server, no long task above 76 ms, and **no request** for a model, the ONNX Runtime, LiteRT, or any scan, result, settings or
  about screen. The test fails if one of those is ever pulled into the first screen.
- Long tasks (observer in Playwright, tasks of 50 ms and more): sound scan 131 ms at worst, photo identification 113 ms, the live camera
  none in 8 s, opening a 12 MP photo none. The model work runs in workers (photo-engine.md and sound-engine.md measured the
  alternative at 400 to 600 ms blocked). The tests fail above 300 ms (400 for start-up and opening a photo).

## 7. Files changed outside the integration area

- `src/ml/engines.ts` (F1b): the one-model-at-a-time rule above.
- `src/domain/thresholds.ts` (F1b): the numbers.
- `src/ml/fakes.ts` (F1b): the fake "unclear" photo numbers.
- `src/ml/vision/geoPrior.ts` (E2 area, written by the interrupted attempt): the cap `PRESENT_SCORE`; `src/ml/vision/constants.ts`: `priorFloor` 0.01
  (by the interrupted attempt).
- `src/features/scan/imageFile.ts` (S2) and new `imageHeader.ts`: the photo decoding.
- `src/features/scan/errors.ts`, `SuccessView.tsx`, `src/main.tsx`: by the interrupted attempt (chunk load failures get their own message,
  the success screen uses the polished celebration, the install prompt is captured early).
- Tests: `core-thresholds`, `scan-result-model`, `scan-result-page`, `fun-sounds` (a type error that broke `npm run build`: the fake
  `AudioContext`; the interrupted attempt's work in progress).
- Left to I2: the settings, about, onboarding and fun files. Two open items from the scan notes are theirs: the About page should credit
  "(c) OpenStreetMap contributors" for the place name and say that a position rounded to two decimals is sent to Nominatim.
