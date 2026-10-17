# FIX-UI: fixes from the independent reviews (app, screens, texts)

Scope: `src/app`, `src/pages`, `src/features`, `src/ui`, `src/i18n`, `src/state`, `src/db`, `src/styles`, `docs`, tests for them.
The other fixer owns the engines (`src/ml`), so two findings that live there are listed under "Not done".

## What was changed, finding by finding

| Finding | Decision | What was done |
|---|---|---|
| New deploy reloads the page in a scan or download (two reports) | confirmed (reproduced by a test), fixed | `vite.config.ts`: `registerType: 'prompt'` plus `clientsClaim: true` (the generated `sw.js` now calls `skipWaiting` only on a message). `src/app/appUpdate.ts` holds the rules (`isSafeToReload`: not on `/scan/sound`, `/scan/photo`, `/scan/live`, `/result`, no pending result, no model download). `src/app/registerUpdates.ts` registers the worker, asks for news when the app returns to the front (at most every 10 minutes) and applies a waiting version while the app is hidden and idle. `src/app/UpdateBanner.tsx` ("Je tu nová verze BirdDexu." and "Načíst znovu") sits in the LCD and shows only when a reload loses nothing. The reload is done by us on `controllerchange`: workbox-window only reloads for updates found within a minute of registering, so a long-open app would otherwise get a button that does nothing (found by the e2e test). |
| Privacy copy says the position never leaves the phone, and the lookup fires before the catch | confirmed, fixed | The lookup moved from a hook on the result screen to the confirm handler: `resolvePlaceName()` in `placeName.ts` is called in `ResultPage.confirm()`, so a discarded result sends nothing. Before the catch the screen shows the coordinates. `usePlaceName.ts` was deleted. Texts: `onboarding.permissions.locationWhy`, `onboarding.device.local`, `noTracking`, and `about.intro` now say it. `about.privacy` and `about.places` already did. No settings switch for the lookup (not cheap: it would need a setting, a migration and a path through the success view); the catch is saved without a name when offline. |
| Photo location prior needs the 15 MB location model; the phone's place and date are used for any photo | confirmed, fixed | `prepareKind` fetches the location model quietly in the background after the WingCLIP files (photo and live screens, real engines only; failure ignored; `PHOTO_EXTRA_FILES`). The readiness of the screen does not wait for it, so the main download bar and the "ready" state are unchanged. New `src/features/scan/exifMeta.ts` reads the EXIF date and GPS of a picked JPEG; `photoContext()` decides: a photo with its own place uses it; a photo without a place that is older than 6 hours is identified and saved without the phone's place and with its own date; a fresh photo (or one with no EXIF) uses the phone's place and the present. HEIC/PNG have no readable EXIF here, so they count as fresh. The result hint (`result.meta.noLocation`) no longer blames the permission only. |
| Czech plurals ("1 nálezů") and mixed terms | confirmed, fixed | One term, "úlovek". `catchesText(n)` (úlovek, úlovky, úlovků) is used for the trainer card, the backup reminder, the erase question and the restore messages; sentences were rephrased so the verb does not depend on the number ("Bez fotky nebo nahrávky se obnovilo: 2 úlovky."). |
| `/field-check` and `/dev/sound` are English and reachable | fixed by hiding | The settings link to the field check shows only after the version line is tapped 7 times (remembered in `localStorage['birddex:tester']`). The route itself stays (the brief says keep it). Developer routes (`/dev/sound`, `/dev/photo`, `/dev/demo`, `/ui-kit`) and the Dex ring easter egg exist only when `import.meta.env.DEV` or `__DEV_ROUTES__` is true; `vite.config.ts` sets that when `E2E_PORT` or `BIRDDEX_DEV_ROUTES` is in the environment. The production build has none of their chunks (checked: no DevPhotoPage, DevSoundPage, DemoDataPage or UiKitPage in `dist/assets`). A plain `npm run build` and the CI build therefore have no developer pages; every e2e run needs `E2E_PORT` (the brief already says so). |
| "pokédex" in manifest and meta description | fixed | `index.html` and `vite.config.ts`: "Ptačí atlas a sbírka ptáků České republiky a Evropy." |
| Credits incomplete | fixed except the app's own licence | Added the eBird/Clements taxonomy credit, Workbox, TinyCLIP and the corrected WingCLIP lineage ("zmenšený model TinyCLIP ... učil se od WingCLIP-0.1 a BioCLIP 2"). No licence line for the app's own code: the repository has no LICENSE file and choosing one is the owner's decision. |
| Docs: threshold table | fixed | `photo-engine.md` now shows the shipped values (strict 0.85/0.30, normal 0.70/0.20, easy 0.55/0.10) with what each does to the fixtures, the Goldeneye 0.63 case, and the sound easy value 0.60. `BRIEF.md` points to the file. |
| Stop ignored while the BirdNET model reloads (screen side) | confirmed, fixed in the hook | `useSoundScan`: a Done tap before the session exists is remembered (`stopWanted`) and the scan stops the moment the session arrives; the screen shows "stopping" meanwhile. Leaving the screen already stopped a late session. The engine-side part is not mine, see below. |
| Dead code | fixed | Deleted `src/app/StubPage.tsx/.css`, `src/features/scan/CatchCelebration.tsx` (placeholder) and the unused `.bd-celebrate` CSS. |
| Small contrast problems | fixed for tokens | `--ok` #17692f (5.2:1 on its background), `--warn` #7d5a00 (5.2:1), `--btn-red` #d6303b (4.8:1 with white text). |
| Landscape polish | done, checked by screenshot only on the desktop | Sound screen in landscape (height up to 520 px): meter and key on the left, the list on the right, the key bar no longer floats over the list. Species photo in landscape fills the panel width at a fixed height. |

## Public API added

- `src/app/appUpdate.ts`: `isSafeToReload`, `hashPath`, `setUpdateWaiting`, `applyWaitingUpdate`, `applyIfIdle`, `useUpdateWaiting`, `shouldCheckForUpdate`.
- `src/features/scan/exifMeta.ts`: `parseExifMeta`, `readExifMeta`, `photoContext`, `FRESH_PHOTO_MS`.
- `src/features/scan/placeName.ts`: `resolvePlaceName`.
- `src/features/scan/modelReadiness.ts`: `PHOTO_EXTRA_FILES`, and `prepareKind` takes an optional fifth argument `fetchInBackground`.
- `src/features/settings/tester.ts`: tester mode (7 taps on the version line).
- Build flag: `__DEV_ROUTES__` (see above).

## Tests added or changed

- `tests/unit/shell-update.test.ts` (safe moments, banner), `scan-exif.test.ts` with `helpers/exif-jpeg.ts` (EXIF parse, photo context),
  `scan-place-name.test.ts` (resolvePlaceName), `scan-model-readiness.test.ts` (background fetch), `scan-sound-page.test.ts` (Done
  before the session exists, leaving before the session exists), `scan-result-page.test.ts` (nothing sent before confirm),
  `settings-pages.test.ts` and `settings-logic.test.ts` (plurals, tester mode, credits).
- `tests/e2e/update.spec.ts`: a changed `sw.js` produces the banner, no automatic reload, no banner during a scan, and the button
  reloads. `tests/e2e/scan.spec.ts`: no place lookup before the catch; an old EXIF photo is saved with its date and no place.

## Not done (and why)

- **Suspended AudioContext watchdog** (`src/ml/audio/capture.ts`) and the engine side of "Stop while the model reloads"
  (`src/ml/sound/engine.ts`): engine scope, left to the other fixer.
- **Accents in the Press Start 2P headings** ("Nastavení" reads as "Nastaveni"): needs a design decision and a look on a phone.
  The rarity colours (about 3.1:1) are used as swatches and borders, not as text, and were left alone.
- **Switch for the place-name lookup in the settings**: the lookup is now only at the catch and is disclosed on the welcome
  screen and the About page; a switch was judged not cheap.
- **The app's own licence line** (no LICENSE file in the repository).
- The EXIF reading covers JPEG only (what phones and `capture` produce); a PNG or HEIC from the library counts as fresh.

## Could not be tested here

The real update flow on GitHub Pages (a new deploy while the app is open on a phone), the iOS behaviour of a reload while the page
is hidden, and EXIF GPS from real phone files (the parser is tested on hand-made EXIF blocks and on the e2e photo with a date only).
