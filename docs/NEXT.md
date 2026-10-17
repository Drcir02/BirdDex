# What remains (updated at the end of the overnight build)

Live: https://drcir02.github.io/BirdDex/ (built by `.github/workflows/pages.yml` at every push to `main`). Phases 1 to 5 are finished:
the app, both engines, all screens, settings, welcome, credits, the update banner, tests, and the owner's `TEST-GUIDE.md`.
`npx tsc --noEmit`, `npx vitest run` and the production build pass on a fresh clone without model files.

## 1. Real-device testing by the owner (blocks everything below)

- iPhone, Safari and home-screen app: follow `TEST-GUIDE.md`; send back failed step numbers, screenshots and the Field check report.
- Later an Android phone (the gift goes to one), Chrome, Install app.

## 2. Expect fixes from the phone test

- Camera in home-screen mode (stall, permission), microphone permission and the AudioContext unlock on iOS.
- Memory and speed of the models on real hardware; WebGPU for WingCLIP is untested (`docs/notes/photo-engine.md`).
- Storage persistence on iOS; the download resume after a lost connection.
- Share sheet for the backup file; update banner when a new version is deployed while the app is open.
- EXIF date and GPS from real phone photos; HEIC pictures are refused with a calm message.

## 3. Tuning from real results

- `src/domain/thresholds.ts` (catch rules per method and sensitivity) from real birds, false alarms in silence and wrong names.
- Czech wording review by a native reader (`src/i18n/cs/`).

## 4. Known open items from the notes

- Accents in the Press Start 2P headings are missing ("Nastavení" reads like "Nastaveni"): needs a design decision.
- A suspended AudioContext watchdog in `src/ml/audio/capture.ts` (see `docs/notes/fix-ui.md`).
- The lock-on blip and error tone exist in `playSound('lock' | 'error')` but are not called from the live camera and error screens.
- No switch in the settings for the place-name lookup (it is disclosed on the welcome and About pages).
- No LICENSE file for the app's own code.

## 5. Optional

- M7: Android APK packaging (Capacitor) if a file is preferred to a link; a final check on a fresh install.
- A short Czech "how to install" page for the recipient.

## Facts

- Repo `Drcir02/BirdDex` (capital B and D); the site address is above.
- A commit message with `[skip ci]` skips the deployment. Only `scripts/checkpoint.sh` commits and pushes.
- The folder `.github/workflows` can be changed only by the main session or the owner.
