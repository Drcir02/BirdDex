# Scan screens and the result flow (task S2)

Everything between "I want to know which bird this is" and "it is in my Dex": the scan hub, the three ways to scan
(listening, photo, live camera), the result screen with its Catch button, and the success screen. The engines
(`src/ml`), the thresholds, the database and the Dex are other tasks' work; these screens only use them.

```
/scan (hub) --> /scan/sound  --Hotovo-->  PendingIdentification  --> /result --Chytit--> success screen --> Dex or /scan
            --> /scan/photo  --Určit--->        (src/state/pending.ts)         |
            --> /scan/live   --Chytit-->                                       +--Zkusit znovu--> the scan screen it came from
                                                                               +--Zahodit--> /scan
```

## Quick reference

| Route | File | What it does |
|---|---|---|
| `/scan` | `src/pages/ScanPage.tsx` | three big keys, the "bird brain" banner (download, progress, retry), privacy line |
| `/scan/sound` | `src/pages/ScanSoundPage.tsx` | record key, level meter, live top 3, "Slyším ptáka!" light, timer, 60 s limit |
| `/scan/photo` | `src/pages/ScanPhotoPage.tsx` | camera and gallery pickers, preview with an optional crop box, "Určit" |
| `/scan/live` | `src/pages/ScanLivePage.tsx` | camera view with a reticle, top guess, lock-on, "Chytit" |
| `/result` | `src/pages/ResultPage.tsx` | up to 3 guess cards, the question, success screen, "Nic jistého" |

Logic lives in `src/features/scan/` (pure modules next to the hooks that drive them, so the pure parts are unit-tested
without a browser); the Czech copy in `src/i18n/cs/scan.ts` and `result.ts`; the styles in `scan.css` and `result.css`
(class prefix `bd-scan-`, `bd-result-`, `bd-crop`, `bd-celebrate`).

### Stable test ids

| Id | Where |
|---|---|
| `tile-sound`, `tile-photo`, `tile-live` | hub keys |
| `model-banner` (`data-tone`), `model-download`, `model-retry`, `model-ready` | the bird brain banner |
| `sound-start`, `sound-stop`, `hearing-bird` (`data-on`), `elapsed`, `guess`, `guess-name`, `guess-percent` | sound screen |
| `photo-take`, `photo-pick`, `photo-other` (the file inputs), `photo-preview` (`data-width/height`), `photo-identify` | photo screen |
| `crop-layer`, `crop-box`, `crop-nw`, `crop-ne`, `crop-sw`, `crop-se` | crop box |
| `live-view` (`data-phase`, `data-locked`), `live-video`, `live-status`, `live-guess`, `reticle`, `live-start`, `live-catch` | live screen |
| `result-card`, `candidate-name`, `catch-button`, `catch-reason`, `result-meta`, `result-when`, `result-where`, `result-audio`, `result-image`, `confirm-text`, `discard`, `nothing-sure`, `retry-scan` | result screen |
| `catch-success`, `catch-message`, `celebration`, `to-dex`, `scan-next` | success screen |

## How it works

### The bird brain (models) and the hub

`useModelReadiness(kind, { autoPrepare })` (`'sound' | 'photo' | 'live' | 'all'`) answers "are the model files on the
phone, and is the engine ready?" and gives `view.phase` (`checking | needed | working | ready | error`) plus `start()`.

- Downloading always goes through the engines' own `prepare(onProgress)`, never through the model store alone: the real
  engines also cache their runtimes (LiteRT, ONNX Runtime) for offline use there. The model store's status
  (`useModelStatus()`) is what tells which files are on the phone and shows the progress of a download another screen started.
- The hub (`'all'`, `autoPrepare: false`) only shows the state. The scan screens start their engine by themselves as soon
  as the files are here (a spinner "Rozjíždím ptačí mozek…", no click needed).
- The first time the banner says "Stáhnout ptačí mozek (asi 90 MB, nejlépe přes Wi-Fi)" (sizes come from the store, rounded to
  5 MB; a screen that needs only the sound or the photo model says its own smaller size). A failed download shows a calm
  message and "Zkusit znovu"; a full phone has its own text.
- After a download that really moved bytes the hook calls `requestPersistentStorage()` (`navigator.storage.persist()`).
- Fake engines (`localStorage birddex:engines=fake`, see core.md) pretend to download, so `modelReadiness.ts` keeps a small
  in-memory "prepared" set for them (`markPrepared`, `resetFakePrepared` for tests). It is not used with the real engines.

### Sound (`useSoundScan`, `soundScan.ts`)

- `engine.start()` is called synchronously inside the tap (iOS only opens the microphone inside a gesture). Nothing awaited comes first.
- The location question is asked after the microphone was allowed (`warmLocation()`), so the two permission dialogs never
  compete; `warmLocationIfAllowed()` on mount fetches the position quietly when the permission is already granted.
- Live: level meter, top 3 with the Czech names (a notch on each bar marks the catch threshold), a light "Slyším ptáka!",
  the elapsed time next to "/ 1:00". The scan stops by itself at 60 s.
- Done: `session.stop()` -> `buildSoundPending()` (the clip as audio media) -> `setPending()` -> `/result`.
- Interruptions: a page that goes to the background (or a microphone that is taken away) stops the session and shows
  "Poslech se zastavil" with "Zobrazit výsledek" (what was heard so far) and "Poslouchat znovu". A page that is hidden only while
  the permission question is open (Android covers the app with it) does not count, unless it still is hidden once the microphone opens.
- Refused microphone: Czech steps for iPhone and Android (`PermissionHelp`); no microphone, an insecure address and engine
  errors have their own calm texts, and the screens that can point to the photo screen do.
- Leaving the screen stops the session and releases the microphone, also when the microphone was still opening.

### Photo (`usePhotoScan`, `imageFile.ts`, `imageSizing.ts`, `cropMath.ts`, `CropBox.tsx`)

- Two inputs, both `<label>` + real `<input type=file accept="image/*">`: "Vyfotit" has `capture="environment"`, "Vybrat z galerie" has not.
- A file is checked first (`checkImageFile`: empty, over 60 MiB, not an image). HEIC (`looksLikeHeic`) gets its own advice when the
  browser cannot open it (Safari can). Nothing is thrown at the person: every problem is a message with the picker still there.
- The photo is opened with `createImageBitmap(..., { imageOrientation: 'from-image' })` (falls back to `<img>`), so EXIF
  orientation is right, and is scaled down with halving steps to a "working picture" of at most 2048 px on the long side (a
  12-megapixel photo is never kept whole). The preview is that picture as a JPEG object URL (revoked when replaced or on leave).
- Crop: optional, a box dragged by its body and resized by its 4 corners (pointer events with capture, arrow keys for the
  keyboard, Shift = bigger steps; 44 px tap areas around 28 px brackets). A box covering the whole picture lets touches
  scroll the screen. The rectangle is kept as fractions (`CropRect`) and turned into pixels of the working picture.
- "Určit": crop -> `photo.identify(canvas)` -> the identified part as a JPEG of at most 1280 px, quality 0.85 (`SAVED_SIDE`,
  `SAVED_JPEG_QUALITY`) -> `buildPhotoPending()` -> `/result`. The "Určit" key is sticky at the bottom of the screen.

### Live camera (`useLiveScan`, `liveScan.ts`)

- `getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false })`
  from the tap, shown in a muted, `playsInline` `<video>`; `live.start(video, ...)` runs the scanner on it.
- A reticle with a lock-on animation, the top guess and its percentage, and the "Chytit" key that only works while
  `lockedSpeciesId` is set. "Chytit" -> `live.snapshot()` -> `buildLivePending()` -> the camera is switched off -> `/result`.
- A stalled camera (no new picture for 6 s, a known iPhone home-screen app bug) is told in Czech with "Zkusit znovu" and a
  button to the photo screen. `StallWatch` counts real frames (`requestVideoFrameCallback`, or the playback time).
  `play()` is not awaited: on some phones it never answers when the camera is stuck.
- The camera is switched off when the person leaves, when the page goes to the background (only once the camera is on) and on
  every failure. Each of these paths calls the same `teardown()`.

### Result (`ResultPage`, `resultModel.ts`, `ResultCard.tsx`)

- Reads the in-memory `PendingIdentification` (`usePending()`). Nothing there (a reload, the back button after a catch):
  redirect to `/scan`. Zahodit and "Zkusit znovu" clear the identification when the screen goes away, not before, so the
  screen is never blank while the next one loads.
- `buildResultView()` normalises the guesses (max 3, strongest first, one per species, nothing below 0,5 % because that would
  show as "0 %": `MIN_SHOWN_CONFIDENCE`, which the live lists use too), runs
  `evaluateCandidates(candidates, method, sensitivity)` from `src/domain/thresholds.ts` and adds the Dex data (names, rarity,
  how many times caught). **The rules are not decided here**: a card's "Chytit" is on exactly when the thresholds say so,
  otherwise the card says why in Czech (`result.reason.*`).
- Each card: reference photo (`useReferencePhoto` from `src/features/photos`, with author and licence), Czech and scientific
  name, rarity, "Nový druh" or "Už v Dexu", a confidence bar with the threshold notch.
- "Co se uloží": date and time, the place (name when known, else the rounded coordinates, else a note that the position
  is off), and the picture or the clip to be saved.
- "Chytit" -> `ConfirmDialog` ("Přidat do Dexu?", names the bird on its own line) -> `addCatch({ id, speciesId, method,
  confidence, caughtAt, location, placeName }, media)`. The id is one per identification (`getPendingCatchId()`), so a second tap
  cannot save a second catch. A full phone (quota) and other failures are shown calmly and the result is kept.
- Success screen (`SuccessView`): "Máš ho! {name} je v Dexu.", the saved photo or the reference photo, rarity, "Nový druh v tvém
  Dexu!" or "Další nález tohoto druhu.", `Zobrazit v Dexu` (`/species/:id`) and `Skenovat dál`. It starts at the top of the
  LCD (the result was probably scrolled down) and flashes the device lights green (`flash('success')`).
- "Nic jistého" (nothing passes): friendly text, tips for the way of scanning (different ones for sound, photo, live, and
  for "not even a guess"), "Zkusit znovu" (back to the scan screen of that method) and a link to the sensitivity setting. The weak
  guesses are still shown below, with their reasons.

### Position and the name of the place (`scanLocation.ts`, `placeName.ts`, `usePlaceName.ts`)

- `src/state/location.ts` does the work (never throws). The scan screens only decide when to ask (see above) and wait at most
  2.5 s for the answer when the scan is over (`locationForCatch`): a catch without a place is better than a screen that waits.
- The name of the place ("Praha") comes from OpenStreetMap's Nominatim, asked in Czech, **only when a bird can be caught**, with
  the position rounded to two decimals (about 1 km), one request, a 4 s timeout, remembered for the session. No network or no
  answer: the coordinates are shown. This is the "optionally look up a place name" of PLAN.md.
  Open items: the About page should credit "(c) OpenStreetMap contributors" and say that a rounded position is sent;
  `usePlaceName(point, enabled)` takes a boolean, so a Settings switch is one extra condition in `ResultPage`.

### Errors (`errors.ts`)

`classifyScanError(error, device?)` turns what went wrong into one of a dozen kinds (`micDenied`, `cameraStalled`, `storageFull`,
`modelDownload`, ...) by the error's `name` and `reason` (the engines load lazily, so their classes are not imported here). Each
kind has a calm Czech sentence (`scanErrorText`, mostly `common.errors.*`) and always a next step.

### Copy

All text is in `src/i18n/cs/scan.ts` and `result.ts`. No bird name sits inside a sentence (Czech declines names): it has its own line.
No gendered past forms. One-letter words that would be left at the end of a line in the biggest, most visible texts (tile titles,
a few hints) are tied to the next word with a non-breaking space (` `).

## The look (checked in screenshots at 390x844 and 360x800)

- The LCD scrolls; the record key (sound) and "Určit" (photo) are `position: sticky` at the bottom (`.bd-scan-controls`, a
  solid bar in the colour of the LCD's bottom edge with a fade above it, 2 px short of the dark rim). While the models are not
  here yet the key is disabled and the bar is not sticky (`is-static`: it just sits at the end of the screen). At 360x800 the sound
  screen's three guesses and the key fit on one screen (checked by the e2e).
- Phones up to 400 px wide get a smaller state label and timer on the sound screen; phones up to 860 px tall a 76 px record key.
- A disabled record key is grey and solid (not translucent), so the screen scrolling under it does not shine through.
- The celebration after a catch is a **placeholder** (`CatchCelebration`: a ring of pixel sparks in the rarity colour). The polish
  task replaces that one component; it gets `rarity` and `isNew`, nothing else has to change.

## Tests and how to run them

Unit (no browser, no model files; 15 files, 258 tests): `npx vitest run tests/unit/scan-*.test.ts`

| File | What |
|---|---|
| `scan-crop-math`, `scan-image-sizing`, `scan-format`, `scan-errors`, `scan-pending-builders`, `scan-result-model`, `scan-place-name` | pure logic |
| `scan-model-readiness`, `scan-sound-state`, `scan-live-state` | the state machines and the stall watch |
| `scan-hub-page`, `scan-sound-page`, `scan-photo-page`, `scan-live-page`, `scan-result-page` | the screens in jsdom with the fake engines (fake timers where a minute passes) |

End to end (real Chromium, fake microphone and camera, `?engines=fake` through `localStorage`, each flow at 390x844):

```
CHROMIUM_PATH=/opt/pw-browsers/chromium E2E_PORT=4187 npx playwright test tests/e2e/scan.spec.ts
CHROMIUM_PATH=... E2E_PORT=4187 npx playwright test tests/e2e/scan.spec.ts --grep-invert real    # without the real models
CHROMIUM_PATH=... E2E_PORT=4187 npx playwright test tests/e2e/scan.spec.ts --output /some/folder   # keeps the screenshots
```

- 33 tests with the fake engines: hub, sound (start, stop, result, catch, clip in the Dex; "Nic jistého"; background; leaving),
  photo (gallery photo, crop by drag and by arrow keys, EXIF, huge photo, HEIC, inputs, a failing identification, strict setting), live (lock, shaky view,
  leaving, background, stalled camera), refused camera and microphone (a second browser without `--use-fake-ui-for-media-stream`),
  the result screen (reload, Zahodit, the same bird twice, photo credit), and the layout at 390x844, 360x800 and landscape
  (no sideways scroll, 44 px targets, no text sticking out of its box, the key and the main button in view).
- 5 tests with the real models (they skip themselves when `public/models` is missing): the hub downloads the real bird brain with
  progress, a real Mallard photo is identified and caught, BirdNET hears the bundled Redpoll recording through the fake microphone,
  the live scanner locks on a Mallard picture used as the camera (`--use-file-for-fake-video-capture`).
- Screenshots are written by `shot()` (`tests/e2e/scan-helpers.ts`) into the test's output folder. Playwright empties the output
  folder at the start of every run, so use `--output` to keep them.
- The web services (Wikipedia, Commons, `upload.wikimedia.org`, Nominatim) are answered by `mockWeb()` in the helpers; this needs
  `serviceWorkers: 'block'` (set at the top of the spec).
- `expect` in `scan-helpers.ts` waits 10 s instead of 5 (the machine has four shared cores and may be busy).
- Helpers other specs may reuse: `openApp`, `downloadBrain`, `readDatabase`, `chooseSyntheticPicture`, `savedImageColour`,
  `horizontalOverflow`, `smallTouchTargets`, `overflowingText`, `setPageHidden`.

## Gotchas

- `React.lazy` pages: pressing "back" while a screen's chunk loads used to leave a blank screen for the result page; it now keeps
  showing the result until the next screen is there (`leaving` ref, clear on unmount).
- The LCD is the scroller, so a message that appears away from the key that was pressed is brought into view with
  `useScrollIntoViewWhen` (`useScroll.ts`; the result screen's save error, the photo screen's failure, which also keeps clear of the
  sticky bar with `scroll-margin`), and the success screen scrolls to the top (`useScrollToTopOnMount`).
- The reticle of the live screen shows while the camera is still opening (`data-phase="starting"`); wait for `data-phase="running"`
  in a test that needs the camera on.
- jsdom has no camera, canvas or object URLs: the component tests stub exactly those (see the top of `scan-live-page.test.ts`).
- Vitest fake timers and dynamic imports: load the screen once with real timers first, then switch (see `scan-sound-page.test.ts`).
- The hub's download prepares the sound and the photo engine in turn, so both models are loaded for a moment (memory on a small phone).

## Not tested here (needs a real phone)

- Landscape works (no sideways scroll, a thin key bar, the photo and live screens fit) but is not designed for: on the sound screen
  the guesses need a scroll while the key bar stays in view.
- Nothing was run on a real iPhone or Android phone: the real microphone and camera permission dialogs, the iOS rule that audio
  starts inside a tap (the code follows it and a unit test checks that the engine is called inside the click), HEIC from the
  iPhone camera, `capture="environment"` opening the camera app, the camera of a home-screen app stalling, touch dragging of the crop box.
- The position and date stored in a gallery photo's EXIF are not read; a gallery photo is saved with the position of the phone now.
- The place lookup was only run against a stand-in (this machine cannot reach Nominatim).
