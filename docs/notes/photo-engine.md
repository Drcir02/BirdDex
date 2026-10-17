# Photo and live camera identification (task E2)

WingCLIP (int8 ONNX) through ONNX Runtime Web, on the phone. `PhotoEngine` and `LiveScanner` from `src/domain/engines.ts` are
implemented in `src/ml/vision/engine.ts` and `src/ml/vision/live.ts`; both are found by `getEngines()` without changes. Everything
below was run here with the real models in headless Chromium (4 shared cores); the last section lists what could not be tested.

**Found on the way, now fixed by someone else:** the service worker never cached `vendor/` or `models/`, so no engine could start with
no network. `vite.config.ts` now has the fix (regular expressions, `vendor/` only) and my offline test passes against it. See "Offline".

## Quick reference for the screens

```ts
import { getEngines } from '../ml/engines'
import { decodeImageFile } from '../ml/vision/frame'

const { photo, live } = getEngines()
await photo.prepare(onProgress)                  // downloads the 48 MB once (progress), starts the worker, loads the model
const image = await decodeImageFile(file)        // File or Blob from the picker; applies the EXIF rotation
const { candidates, pBird } = await photo.identify(image, { location, date })
if ('close' in image) image.close()             // an ImageBitmap holds a lot of memory; an <img> has no close()
```

- `candidates`: the 3 strongest species of the Dex as `{ speciesId, confidence }`, strongest first, confidence = P(bird) x P(species)
  (0 to 1). **Empty when the picture shows no bird** (`pBird` below 0.3736); `pBird` is always set. Pass the candidates to
  `evaluateCandidates(candidates, 'photo', sensitivity)` for the Catch button.
- `identify` also takes a `HTMLCanvasElement`, `HTMLImageElement` or `HTMLVideoElement` (the current frame). It scales the picture
  itself (a 12 MP photo is fine: 90 ms on the main thread, the rest in the worker), so pass the picture as it is.
- `prepare()` is safe to call from many places and many times (the work is done once; a late caller gets `ready` at once; a failure
  is forgotten so the next call retries). If you skip it, `identify` and `live.start` prepare by themselves, without progress.
- **Failures.** `prepare()` rejects with `ModelDownloadError` / `ModelStorageFullError` from the model store (use `commonErrorKey`)
  or with `ModelLoadError` (`src/ml/runtime/ort.ts`; same name and meaning as the one in `litert.ts`: the model downloaded but would
  not start, show `common.errors.modelLoad`). A broken picture makes `identify` reject with the browser's error.
- `identify` returns, besides `candidates` and `pBird`, an extra `diagnostics` object at run time (timings, `outsideDexMass`: how much of
  the probability went to birds outside the Dex, `blank`, ...). Screens do not need it. It is only a hint for a message like "this looks
  like a bird that is not in your Dex": the Hairy Woodpecker has 0.31, but the Great Cormorant, a clear European bird, has 0.22.
- Live: `await live.start(videoElement, { location, date, onUpdate, onError })` gives `{ stop(), snapshot() }`.
  `onUpdate({ candidates, pBird, lockedSpeciesId?, framesPerSecond })` comes after every analysed frame (about every 0.7 to 1 s).
  `snapshot()` is a JPEG (at most 1600 px on the long side, quality 0.88) of the current camera picture, and still works after
  `stop()` (it uses the last picture, kept at the moment of the stop), so `await session.snapshot(); session.stop()` and the other
  order both work. `onError` is **new in the contract** (optional, in `src/domain/engines.ts`): called once when analysis failed three
  times in a row; the session has stopped by then. Call `photo.prepare(onProgress)` before `live.start` for a progress bar: the
  live scanner shares the one model of the photo engine.
- Memory: the model is 230 to 260 MB while loaded. It is released by itself after 3 minutes without use (never while a live session
  runs). If a screen wants it gone sooner (leaving the photo and live screens), call `getVisionRuntime().dispose()` from
  `src/ml/vision/runtime.ts`; the next `prepare()` loads it again in about 1 s (a few seconds on a phone).
- On the phone: open `/#/dev/photo` (not in the navigation) to try the engines without the real screens: pick a photo (the camera or the
  library) or switch the live camera on; it shows the three guesses, pBird and the timings, and the same page is what the e2e spec drives.
- The first `onUpdate` can come about 1 s after `start` (frame, model run); a lock needs 3 frames, so the earliest is about 3 s
  with a model that takes 450 ms.

## Files

| File | What |
|---|---|
| `src/ml/runtime/ort.ts` | Loads ONNX Runtime Web from `vendor/ort/` with a plain `import()` (like the Field check), wasm provider, one thread. `createImageEncoder(graph, externalData)`. |
| `src/ml/vision/preprocess.ts` | Pillow-exact resize (shorter side 248, bicubic), centre crop 224, CLIP mean and std. Pure. |
| `src/ml/vision/classifier.ts` | Decodes `text_classifier_int8.bin` (int8 rows, per-row scales, last row = probe), cosine similarities, probe. Pure. |
| `src/ml/vision/scoring.ts` | Softmax with the temperature, out-of-Dex rivals, optional prior, P(bird), top 3, abstain rule. Pure. |
| `src/ml/vision/prior.ts` | `OccurrencePrior`, `setOccurrencePriorProvider`, `createRegionPrior`. |
| `src/ml/vision/core.ts` | `VisionCore`: model + classifier + scoring, no DOM. Runs in the worker or (fallback) on the main thread. |
| `src/ml/vision/worker.ts`, `protocol.ts`, `backend.ts` | The Web Worker, its messages, and the worker / main thread backends. |
| `src/ml/vision/runtime.ts` | The one shared model: `prepare`, `analyse`, idle release, `hold`. |
| `src/ml/vision/frame.ts` | Canvas work: picture or video frame to pixels, JPEG snapshot, `decodeImageFile`. |
| `src/ml/vision/engine.ts`, `live.ts`, `liveLogic.ts` | `createPhotoEngine`, `createLiveScanner`, and the pure smoothing and lock logic. |
| `src/ml/vision/constants.ts` | Every number, with its source. |
| `src/ml/vision/DevPhotoPage.tsx` (+ `.css`) | The developer page `/#/dev/photo`. |
| `tests/unit/vision-*.test.ts` (10 files, 165 tests) | Need no model files. |
| `tests/e2e/photo-engine.spec.ts` (15 tests, port 4185) | Real model, real Chromium. |
| `tests/fixtures/vision/` | Pillow reference vectors, reference embeddings of the fixture photos, an EXIF-rotated photo, and the three small Python scripts that make them. |

Code from WingDex (MIT) is credited in comments: the recipe and the calibration numbers (`preprocess.ts`, `constants.ts`, `scoring.ts`).

### Changes outside my area (all small)

- `src/App.tsx`: one lazy import and one route, `/dev/photo`, next to the sound task's `/dev/sound`.
- `scripts/copy-vendor.mjs`: also copies `ort.wasm.min.mjs`, `ort-wasm-simd-threaded.mjs` and `.wasm` (the plain WebAssembly build,
  14 MB). The WebGPU build the Field check uses stays. `ort.ts` falls back to the WebGPU build's files if the plain ones are missing.
- `src/domain/engines.ts`: optional `onError` in the options of `LiveScanner.start` (the sound task added one to `SoundEngine.start` the
  same way).
- Nothing else. I did not touch `vite.config.ts` (the service worker rule is described under "Offline").

## Offline

While writing the offline test I found that the two `urlPattern` functions of the runtime caching in `vite.config.ts` used `${base}`.
Vite-plugin-pwa copies a function's source into `sw.js`, where the variable `base` does not exist (checked: `typeof base` is
`undefined` inside the service worker and `sw.js` contained the text `${base}models/`). Every request evaluated by those routes threw a
ReferenceError, so nothing from `/models/`, `/vendor/` or `models/manifest.json` was ever cached by the service worker and
`birddex-heavy-v1` never appeared. ONNX Runtime and LiteRT (`vendor/`) were then only fetched from the network: **no engine could start
offline**. During the night someone else (by the comment in the file, probably the sound task) changed both rules to regular expressions and
made the second rule cover only `vendor/`, which is also what I would have proposed: with `/models/` in it every model would exist twice
on the phone (`birddex-models-v1` from the model store plus the service worker's copy, +48 MB for WingCLIP, +41 MB for BirdNET).

What I checked against the fixed config: after the first `prepare()` the service worker's cache holds `vendor/ort/ort.wasm.min.mjs`,
`ort-wasm-simd-threaded.mjs` and `.wasm` (14.3 MB, the plain build; the WebGPU build is only fetched by the fallback or the Field check);
the model files come from the model store's cache; `prepare()` after `dispose()` and with the network switched off loads the model again and
identifies a picture (about 1 s). The e2e test for that (`failures and offline`) first looks whether `birddex-heavy-v1` holds `vendor/ort`,
and skips itself with a reason if not, so it will say so if the rule is ever broken again.

## Decisions

### Where the model runs: a Web Worker (measured)

ONNX Runtime Web's wasm run blocks the thread it runs on for the whole picture. Measured on the main thread: 400 to 600 ms per picture
(laptop class CPU), `longtask` entries of 436 to 631 ms, longest gap between two animation frames 589 to 635 ms; a 10 ms timer did
not fire once during six runs in a row. In the worker: longest frame gap 22 ms, no long tasks. The brief's limit is 150 ms, so the
model lives in a worker (`worker.ts`); on a phone it would have been 1 to 3 s of frozen screen per picture. The main thread only
draws the picture into a canvas (5 to 25 ms for a 960x640 photo, 93 ms for a 12 MP photo) and receives numbers.

- The main thread version stays as a fallback: if no module worker can be started (`WorkerStartError`), `runtime.ts` uses it and logs a
  warning. The model files are only handed to the worker after it has answered a ping, so a worker that fails to start loses nothing.
- The model bytes are **transferred**, not copied (no extra 48 MB), and the pixel buffers too.
- The e2e spec asserts both numbers: worker `maxFrameGapMs < 250` (typical 22) and main thread at least 0.7 of the model time.

### ONNX Runtime: plain wasm build, one thread, no WebGPU

- Plain WebAssembly build (`ort.wasm.min.mjs`) rather than the WebGPU build in `vendor/` that the Field check loads: the same speed per
  picture (median of 11 runs: 413 ms against 420 ms in a worker, 392 against 391 on the main thread) but the session starts in 0.7 s
  instead of 1.3 s, the first run takes 0.5 s instead of 1.1 s, and the wasm file is 14 MB instead of 27 MB. Hence the three files
  added to `copy-vendor.mjs`.
- One thread (`numThreads = 1`): GitHub Pages cannot send the headers that `SharedArrayBuffer` needs.
- No WebGPU. It could not be timed here (headless Chromium has no GPU). WingDex measured 516 ms against 318 ms per picture and
  1753 ms against 192 ms to start for this model on its hardware (the int8 operators fall back to the CPU). The Field check on a real
  phone can say if that holds there; if WebGPU is clearly faster, put `'webgpu'` in front of `'wasm'` in `executionProviders` in `ort.ts`
  and load the WebGPU build (`ORT_BUILDS`).
- Session options (`enableCpuMemArena`, `graphOptimizationLevel` basic or none) change neither speed nor memory (tried): left at the default.

### Preprocessing is bit for bit Pillow

WingDex's TypeScript resamples in floating point; its own golden vectors (`ml/parity`) show that this differs from Pillow by one grey
level in 13 to 14 percent of the values (up to 0.03 in the tensor), although the model was fitted on Pillow's output. `preprocess.ts` ports
Pillow's 8-bit resampler (fixed point coefficients with 22 bits, an 8-bit intermediate image, `precompute_coeffs`, torchvision's floor for
the resized size and Python's half-to-even for the crop), and the normalisation repeats torch's float32 arithmetic through a lookup table.
It also computes only the output pixels that survive the crop. Results:

- Against the two WingDex golden tensors: **0 of 150528 values differ** (WingDex's own JS: worst 0.015 and 0.030). 8 to 25 ms per picture.
- Against Pillow 13 on 7 synthetic pictures (landscape, portrait, a margin of exactly 52.5 pixels, upscaling, square, a 4:1 panorama,
  17x23): SHA-256 of the cropped bytes and of the float32 tensor are identical (`tests/unit/vision-preprocess.test.ts`, no picture is
  stored: a small integer formula in `tests/unit/helpers/vision-synth.ts` and in the Python script makes the same pixels).
- Chromium's JPEG decoder gives exactly the pixels PIL gives (checked on a fixture: 0 of 1.8 million values differ), so without the
  scaling step below the whole pipeline up to the model input is identical to Python.

### How the picture gets small first

A 12 MP photo through the exact resampler would take seconds. The browser first scales it with a canvas to a shorter side of 512 pixels
(photos) or 320 (live), in halving steps so Safari's plain bilinear scaling does not alias; then the exact resize to 248 follows
(`frame.ts`, constants in `FRAME`). The shorter side never goes below 248, a panorama is held to 1536 on the long side. WingDex does the
same (cap of 500 on the long side) and measured no loss. Here, cosine of the embedding with the Python (full size) embedding over the 10 photos:
no scaling 0.9941 to 0.9992, 512 px 0.9887 to 0.9993, 320 px 0.9907 to 0.9991; no direction, so no systematic loss (the next section says
why it is not 1.0 even without scaling). A 48 MP photo needs 400 ms on the main thread for the canvas step and a 190 MB bitmap: see the gaps below.

### The model is not the same in every runtime

Feeding the very same tensor to the int8 model in ONNX Runtime Web (wasm) and in ONNX Runtime for Python gives embeddings with cosine
0.9987 (largest similarity difference 0.010 to 0.012); Python alone with another graph optimisation level differs by the same 0.9988
from itself. This is the nature of the quantised graph (dynamic quantisation of the activations), not a bug of ours, and it is enough
to flip close calls (Common against Barrow's Goldeneye are 0.002 apart). So: tests compare embeddings with cosine thresholds
(0.995 for the same tensor, 0.98 for the whole pipeline), ask for the top 3 where two species are neck and neck, and every accuracy
number below is from the browser pipeline that ships, not from Python.

### Candidates and the calibrated probability

WingDex: score = cosine / T + beta x log(occurrence prior), softmax over the best 25 of 10994 species, confidence = P(bird) x probability,
with T = 0.007435 (fitted together with its prior). We have no prior for photos. What we do (`scoring.ts`, `constants.ts`):

1. All 10994 species rows are scored (an int8 sweep, 16 ms). Only the 421 species of the Dex that WingCLIP knows are candidates
   (`species.json`, `wingclipIndex`; the two redpolls have no row). Their order never depends on the rest.
2. The species outside the Dex stay in the softmax as **rivals with a penalty of 6** (score units: cosine / T), so a bird outside the Dex
   (an American woodpecker, a chicken, a zoo flamingo) takes most of the probability instead of being forced into the nearest Dex bird.
   exp(6) is about 400: "outside the Dex" is 400 times less likely beforehand. WingDex's own floor for a species absent from the region works
   out at 4 to 9.5 of these units, so 6 is in its range. Penalty 0 would be the plain 10994-way softmax, infinity the plain sub-matrix.
3. T is WingDex's. The vision-only temperatures it fitted before the prior existed (0.0072 to 0.0078, `calibration_01_a090.json` and
   `calibration_bayes_01.json`) are close to it, so the probabilities keep roughly the calibration WingDex measured (its displayed
   confidence: mean 0.963 against 94.3 percent accuracy, ECE 0.021 on 3322 photos, with the prior).
4. confidence = P(bird) x P(species), top 3 always (not "only the likely ones"), so the screens can rely on 3 entries; the weak ones are
   simply small numbers. The three are different species, strongest first.

**Effect of restricting to the Dex on the fixtures** (browser pipeline, 512 px; rank of the true species):

| Photo | In all 10994 | In the Dex (421) | In Czechia (275) | Top confidence: Dex only / penalty 6 (shipped) / no restriction |
|---|---|---|---|---|
| Common Goldeneye | 1 | 1 | 1 | 0.63 / 0.63 / 0.59 |
| Common Kingfisher | 1 | 1 | 1 | 0.98 / 0.98 / 0.97 |
| Great Cormorant | **8** | 1 | 1 | 0.96 / 0.75 / 0.01 |
| House Sparrow | 382 | 101 | 87 | Mandarin Duck 0.78 / 0.78 / 0.66 |
| Mallard | 1 | 1 | 1 | 1.00 / 1.00 / 0.99 |
| Rock Pigeon | 1 | 1 | 1 | 0.99 / 0.99 / 0.92 |
| Hairy Woodpecker (American, not in the Dex) | - | - | - | Eurasian Three-toed 0.69 / **0.48** / 0.00 |
| Geese, Fujian | - | - | - | Pink-footed Goose 0.71 / 0.67 / 0.03 |
| Gulls, Seattle | - | - | - | Herring Gull 0.40 / 0.38 / 0.02 |
| "Unknown bird" (a chickadee type) | - | - | - | Marsh Tit 0.56 / 0.54 / 0.03 |

Top 1 and top 3 for the six birds that are in the Dex: **all 10994 rows 4 of 6, the Dex 5 of 6** (the Cormorant is only 8th among all
species because of its American relatives), the Czech subset 5 of 6. Without restriction the Cormorant would be 1 percent sure; with
the Dex only, 96 percent; with the penalty, 75 percent (honest: its non-Dex lookalikes still count). The House Sparrow in a colourful
mosaic fountain is a real miss (rank 382, Mandarin Duck): the model does not see a sparrow there, the same miss that the species data task
found. The penalty value is a judgement, tried at 0, 2, 3, 4, 5, 6, 8 (Python, full size): the Cormorant is 0.98 / 0.85 at infinity and 6,
0.70 at 5, 0.47 at 4; the Hairy Woodpecker 0.77 / 0.59 / 0.43 / 0.24. Six keeps the clearly recognised European birds at 0.85 or more
(Python, full size) and the foreign birds under 0.6 (in the browser pipeline the Fujian geese reach 0.67). With more labelled photos it should be fitted; the constant is `SCORING.outOfDexPenalty`.

### Abstain (no bird in the picture)

The bird / not-bird probe is WingDex's (last row of the classifier plus bias 1.7005 and a Platt map; the constants are in `constants.ts`
and a unit test reproduces WingDex's own documented pair: raw 0.1032229138 gives 0.3736373465). Below 0.3736 (calibrated) the engine
returns **no candidates**, with `pBird` set. WingDex measured this on its validation set: 0.45 percent of birds wrongly flagged, 74 percent
of hard non-birds and 85 percent of Imagenette rejected, and warns that novel kinds of non-bird pass far more often. Our measurements:

| Picture | pBird | Result |
|---|---|---|
| the 10 fixture photos (all birds) | 0.86 to 1.00 (lowest: the sparrow in the mosaic) | candidates |
| RGB noise (Python / browser) | 0.26 / 0.33 | none |
| Gaussian noise | 0.43 | weak guesses only (top 0.05) |
| a screenshot of the app / the BirdNET GUI | 0.12 / 0.25 | none |
| people photo, LibreOffice splash, frog drawing, water crop | 0.01, 0.32, 0.29, 0.02 | none |
| a gradient | 0.76 | weak guesses (top 0.10) |
| flat grey, white, black, green, blue | 0.54 to 0.94 (the probe does **not** see them) | see the next paragraph |
| sky and table crops cut from bird photos | 0.89, 0.94 | weak guesses (top 0.05, 0.22) |

The probe does not recognise flat colours (a covered lens, a wall) as non-birds. So there is one more rule, **blank pictures**: when the
brightness of the 224x224 crop varies by less than 3 (of 255), the model is not even run, `pBird` is 0 and there are no candidates
(`SCORING.blankSpread`; real photos are above 10). For everything the probe lets through, the softmax is spread so thin over the species
that the top confidence stays far below any catch threshold: **the largest top confidence of any non-bird picture I tried is 0.22**
(a crop of sky, Python) and 0.10 in the browser tests (the spec asserts below 0.25).

### Catch thresholds (as shipped in `src/domain/thresholds.ts`)

The first version of this note recommended the starting values (strict 0.75 / lead 0.25, normal 0.60 / 0.15, easy 0.45 / 0.10).
Integration (task I1) raised them after the measurements, and these are the values now in `PICTURE_RULES` (photo and live camera;
each rule also needs a bird probability and a limit for "probably a bird outside the Dex", see `thresholds.ts`):

| Sensitivity | confidence at least | lead over the second guess at least |
|---|---|---|
| strict | 0.85 | 0.30 |
| normal | 0.70 | 0.20 |
| easy | 0.55 | 0.10 |

What each does with the fixture photos (CATCH = the button works). The table follows the confidence and the bird probability that
were measured; the lead over the second guess was not recorded for every photo, so a CATCH in a row with a close second guess
may still be blocked by the lead rule. "No prior" is the engine alone; "Prague prior" is with
BirdNET's location model for a position in Prague (the shipped cap, `integration.md`):

| Photo (top guess, confidence without prior) | strict | normal | easy |
|---|---|---|---|
| Kingfisher 0.985, Mallard 0.996, Rock Pigeon 0.986 (all right) | CATCH | CATCH | CATCH |
| Great Cormorant 0.750 (right; 0.77 with the prior) | - (lead too small for 0.85) | CATCH | CATCH |
| Common Goldeneye 0.631 (right, Barrow's 0.319 second) | - | - | CATCH |
| Common Goldeneye with the Prague prior (0.88 October, 0.74 May; Barrow's 0.01 to 0.07) | October only | CATCH | CATCH |
| House Sparrow, read as Mandarin Duck 0.782 (**wrong**; pBird 0.86, under the 0.95 that strict and normal ask for) | - | - | CATCH |
| Geese from Fujian, read as Pink-footed Goose 0.672 | - | - | CATCH (if the lead is 0.10) |
| Hairy Woodpecker, Eurasian Three-toed 0.479 (wrong, not in the Dex) | - | - | - |
| Unknown tit, Marsh Tit 0.541 | - | - | - |
| Gulls from Seattle, Herring Gull 0.385 | - | - | - |

**The Common Goldeneye without a position (0.63) cannot be caught on `normal`** (it needs 0.70): the old table said it could. That
photo is only caught when the phone knows where it is, because the location prior lifts it to 0.74 or more. This is deliberate: with
no position the engine cannot tell Common from Barrow's Goldeneye, and the screen shows both guesses with the reason. The sound
rules are strict 0.85, normal 0.70 and easy 0.60 (the sound note's 0.60 for easy is applied, not just recommended).

**Later (docs/notes/fix-ml.md section 1): the Catch rules now also use pBird and `outsideDexTop`; the Palm Warbler / Water Pipit case is a known gap.**
Right answers lie between 0.63 and 1.00, confident wrong ones at 0.67 and 0.78: **no threshold separates them on this set**, so the
confirmation step stays the real guard. For the live camera, the lock rule (below) needs a smoothed confidence above 0.4 for three
frames, then the photo rules apply to the current frame as the brief says.

### The occurrence prior

`OccurrencePrior` (`prior.ts`) is `{ get(speciesId): number | undefined }`, a weight from 0 to 1 per species; a `Map<string, number>`
fits. It enters the score as `strength x ln(weight / best weight)`, with weights floored at 0.001 and strength 1 (a neutral first guess, not
fitted: WingDex uses beta 1.16 on its own scale). Only ratios count, so BirdNET's location scores can be used as they are. No opinion
(`undefined`) counts as the best weight. **The default works without a prior** and calls no provider.

```ts
setOccurrencePriorProvider(async ({ location, date }) => {          // src/ml/vision/prior.ts, once, in the integrator's code
  const scores = location ? await geoScores(location, date) : undefined   // E1's createGeoPrior in src/ml/sound/geo.ts
  return scores && { get: (speciesId) => scores[birdnetIndexOf(speciesId)] }
})
```

`identify(image, { location, date })` and `live.start(video, { location, date })` hand both to the provider (the live scanner asks
once at the start). A provider that throws means "no prior" (a warning, never a failed identification). `createRegionPrior(species,
'czechia')` is a ready-made prior from the Dex flags (Czech birds 1, others 0.05): in the e2e spec it takes the Common Goldeneye from
0.63 to above 0.85 and Barrow's Goldeneye from 0.32 to below 0.1. It is not on by default; whoever knows the user's region can plug it in.

### The live scanner

- A frame from the `<video>` at most every **700 ms**, taken only when the previous analysis is finished (never two at once). The pause
  also grows so the model works at most 80 percent of the time: a model needing 1000 ms gets a frame every 1250 ms. Frames are skipped
  while the page is hidden, the video is paused or has no picture, or `currentTime` has not moved. `framesPerSecond` is the measured rate
  between results (about 1.4 here, never above the 1.43 that 700 ms allows for the first reading).
- Smoothing: exponential average of the confidence of every species (and of pBird) with alpha = 2 / (5 + 1) = 1/3, about the last 5 frames.
- Lock: `lockedSpeciesId` is set when the same species is first for 3 frames in a row with a smoothed confidence above 0.4. It is held
  with some hysteresis (dropped after 2 frames in a row without the lead, or at once below 0.25), moves to another species that leads for
  3 frames, and is cleared while the smoothed pBird is below the probe threshold. With the fake camera playing the Mallard photo it locks
  at the 3rd update, about 1.8 s after the start.
- `stop()` ends the loop, ignores an analysis that is still running, gives the model back to the idle release, keeps the last picture for
  `snapshot()`, and may be called twice or from inside `onUpdate`. A frame is never queued behind another.
- The scanner holds the shared model while it runs; `runtime.ts` releases the model after 3 minutes without use (never during a session),
  because it is 230 to 260 MB of memory (below). The next `prepare()` takes about 1 s once the files are on the phone.
- Pure logic (smoothing, lock, pacing) is in `liveLogic.ts` with synthetic sequences in `tests/unit/vision-live-logic.test.ts` (21 tests);
  the loop (intervals, no overlap, adaptive pause, failures, stop, snapshot) runs against a fake clock in `vision-live.test.ts` (21).

## Measurements

Headless Chromium on 4 shared cores (a phone will be 3 to 6 times slower). All from `/#/dev/photo` and the e2e spec.

| What | Time |
|---|---|
| Model ready, first time (download 48 MB from the local server, SHA-256, keep in Cache Storage, start worker, load model) | 3.0 to 3.5 s (2.4 s of it the download) |
| Model ready, files already there | 0.9 s (0.1 s reading Cache Storage, 0.75 s creating the session) |
| One picture (960x640 JPEG), total as seen by the caller | 420 to 560 ms, median 452 |
| of which: canvas on the main thread | 5 to 25 ms |
| of which: Pillow-exact preprocessing (in the worker) | 8 to 25 ms |
| of which: the model | median 413 ms (393 to 473) |
| of which: similarities, probe, softmax over 10994 species | 16 ms |
| 12 MP photo (4032x3024) | 640 ms; canvas 93 ms (main thread, longest frame gap 97 ms) |
| 48 MP photo (8064x6048) | 825 ms; canvas 397 ms and a 190 MB bitmap: the main thread is stuck for 405 ms |
| Panorama 6000x1200, tall 1200x4800 | 479 ms, 503 ms |
| Longest gap between animation frames while identifying: worker / main thread | 22 ms / 589 to 635 ms |
| Live camera (fake camera, 960x640) | 1.4 frames per second (700 ms pace, model about 430 ms) |
| Memory of the renderer (RSS), page open / model loaded / released | 148 / 410 (375 after a few pictures) / 223 MB |

**A phone, estimated.** Chromium's CPU throttling (DevTools `Emulation.setCPUThrottlingRate`) slows the main thread but not workers, so I ran
the model on the throttled main thread (`?vision=main`) to see what a phone-class CPU does to it:

| CPU | model ready (first time, local files) | model per picture | per picture in total | live camera (worker): pace |
|---|---|---|---|---|
| this machine | 3.5 s | 467 ms | 496 ms | a frame every 0.7 s, lock after the 3rd update |
| 3 times slower | 5.6 s | 1534 ms | 1623 ms | a frame every 1.9 s (the model may use 80 percent of the time), lock after about 6 s |
| 6 times slower | 8.8 s | 2864 ms | 3097 ms | a frame every 3.6 s, lock after about 11 s |

A recent iPhone should be close to the first or second row, a cheap Android phone to the third: the photo path is fine everywhere, the live
camera feels live only from the second row up. For the main thread alone (canvas, results) the throttled page kept its longest frame gap at
35 ms (4 times slower) and 73 ms (6 times slower) while the worker identified pictures, so the worker answer holds on slow phones too.

Recommended: the worker (decided by the stall numbers above), the plain wasm build, 512 px for photos and 320 px for live (the six birds
keep their rank at 320; the "Unknown bird" becomes a tie between Marsh Tit 0.33 and Long-tailed Tit 0.32). A 48 MP picture is the one case
that stalls the page and needs a lot of memory: `createImageBitmap(file, { resizeWidth, resizeHeight })` decodes at a reduced size
(WingDex uses it, with the JPEG header read first because Safari ignores the options); I did not build that. 12 MP, which is what phones
produce by default, is fine.

## Tests

- `npx vitest run tests/unit/vision-*.test.ts`: 165 tests, no model files needed. Preprocessing against Pillow vectors (SHA-256) and
  against WingDex's golden vectors (skipped where `/home/user/birdnet-team/wingdex/ml/parity` is missing; set `WINGDEX_PARITY_DIR`);
  classifier decode and similarities against a float reference, and (only if the model file is there) the real file: 10994 rows, unit
  length rows, every `wingclipIndex` fits; scoring and WingDex's calibration pair; prior; `VisionCore` with a fake image tower;
  the worker backend with a fake worker (ping first, transfer, ids, errors, crash, timeout); the runtime (progress, one start for many
  callers, retry, fallback, idle release, hold); the engine; the live scanner; the frame plans.
- `CHROMIUM_PATH=/opt/pw-browsers/chromium E2E_PORT=4185 npx playwright test tests/e2e/photo-engine.spec.ts` (about 1 minute plus the
  build): 15 tests on the real model. The report lines (accuracy, timing, the non-bird numbers, embedding cosines) are printed and added
  to the test annotations. It skips itself when the model files are missing; the offline test skips itself with a reason if the service worker does not
  keep `vendor/ort` (see "Offline").
- Fixture data in `tests/fixtures/vision/`, each made by a small Python script next to it: `make-preprocess-vectors.py` (Pillow results
  for synthetic pictures), `make-reference-embeddings.py` (the int8 model in Python on the 10 fixture photos, for the cosine checks) and
  `make-exif-fixture.py` (the Mallard stored turned by 90 degrees with EXIF orientation 6, as a phone held upright stores it). Run them
  again only if the recipe, the photos or the models change.

## Not tested here

- A real iPhone or Android phone: speed (the throttling estimate above says 0.5 to 3 s per picture), memory (the model is 230 to 260 MB in desktop
  Chromium, and iOS Safari has less room), module workers and WebAssembly in a worker in Safari and in a home-screen app, and WebGPU.
  Open `/#/dev/photo` on the phone: pick a photo and read the timings; `?vision=main` runs the model on the main thread, `?short=320`
  changes the scaling step.
- Real photos from Czech gardens. The accuracy numbers come from 10 fixture photos (6 birds of the Dex); they say the pipeline is wired
  correctly and give an idea of the calibration, not an accuracy. The penalty, the prior strength and the thresholds should be fitted when
  there are labelled photos with locations.
- The live camera on a real phone: front or back camera, the picture turning with the phone, a camera that stalls.
- Offline on a real phone: iOS may evict Cache Storage (the model store asks for persistent storage when a catch is saved).
- The effect of a real location prior (BirdNET's location filter) on photos.
- 48 MP photos on a phone.
