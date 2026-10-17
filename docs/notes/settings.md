# Settings, welcome, credits, fun and stats (task I2)

Finished from the interrupted first attempt (nothing restarted). Pages: `src/pages/SettingsPage.tsx`, `AboutPage.tsx`,
`OnboardingPage.tsx`. Logic and sections: `src/features/settings/` (stats, format, backupFlow, backupReminder, install,
permissions, models, sensitivity, sections as components, `dedication.ts` with the optional dedication line, empty by default).
Fun: `src/features/fun/` (Web Audio synthesised sounds, `CatchCelebration`, `NewBadge`, `planCelebration`, reduced-motion hook).
Czech texts: `src/i18n/cs/settings.ts`, `about.ts`, `onboarding.ts`, `fun.ts`.

## Decisions
- Welcome has 4 steps (idea, what is downloaded and stays on the phone, permission primers, install hint). Primers only
  explain and offer an "allow now" button per permission; the browser prompt appears only when tapped. Finish and skip both call `markWelcomed()`.
- Install: iOS shows Share, then Přidat na plochu; Android uses a captured `beforeinstallprompt` (captured in `installCapture.ts`, imported by main.tsx).
- Backup: Web Share with files when `canShare` allows it, else a download. When packing took long and the share sheet would be
  refused, a second "Uložit" tap appears. Reminder banner after 10 catches with no backup.
- Erase everything has two confirm dialogs. The model delete button is disabled while no model is downloaded.
- `installAudioUnlock()` runs when `fun/sounds.ts` is imported; audio is unlocked on the first tap. Sounds respect the setting.
- Icons checked: PNG sizes match the manifest (192, 512, maskable 512, apple-touch 180), colours match the SVG, theme and
  background colour `#b3202a` equal `--shell-bar` and the index.html meta. No change needed.

## Fixes in this pass
- `tests/unit/fun-sounds.test.ts` type error (FakeContext) fixed.
- `about.ts` contained a copyright sign, which the "no emoji" i18n test flags as pictographic; reworded.

## Edits outside my files
- `SuccessView.tsx` (scan task) already mounts `<CatchCelebration rarity isNew />` (committed in the earlier attempt); no further edit in ResultPage.

## Not done / not verifiable here
- The lock-on blip and error tone exist in `playSound('lock' | 'error')` but are not called from the live camera or error screens
  (those files belong to the scan task and I1 is editing them). One-line calls are enough to add them.
- Real iPhone audio unlock, share sheet and install prompt behaviour are untested; the cached-model deletion with real downloaded files is only unit tested.

## Tests
Unit: `tests/unit/settings-*.test.ts`, `fun-*.test.ts`. E2E (`E2E_PORT=4221`): `tests/e2e/settings.spec.ts`
(sensitivity persistence, model listing, backup export, erase, import round trip with demo data, broken file, about page, screenshots)
and `onboarding.spec.ts` (first-run redirect, stepping, skip, iOS hint, screenshots to `test-shots/`).
