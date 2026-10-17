# Final pass (task FINAL)

## CI dry run
Fresh `git clone` into the scratchpad, then `npm ci`, `npm test` (84 files, 1731 passed, 4 skipped) and `BASE_PATH=/BirdDex/ npm run build`
all passed without any model file; no change was needed. `dist/` has no `models/` folder in that case, as intended. The clone was deleted.

## fetch-models.mjs against the app
The five files of the manifest (`birdnet-fp16`, `birdnet-geo-fp16`, `wingclip-onnx`, `wingclip-data`, `wingclip-text`) are exactly the ids
used in `src/ml/runtime/modelStore.ts` and the settings list; the FP32 file is an extra for tests and is never in the manifest. Sizes and
sha256 values in the script match the files in `public/models` (checked with sha256sum).

## Checks run on the final tree
`npx tsc --noEmit` clean; `npx vitest run` 84 files, 1735 tests passed; `npm run build` and `BASE_PATH=/BirdDex/ npm run build` green;
Playwright (E2E_PORT=4300, FAKE_AUDIO_FILE set): 207 tests, 199 passed in the full run; `flows.spec.ts` "backup and restore ... fresh browser
profile" hit its 300 s timeout in the full run (machine shared, 19 minutes in) and, with it, the 7 tests after it in that file did not run.
Re-running that group (`-g "backup and restore|first-run download"`) passed 8 of 8 in 1.3 minutes, so it looks like load, not a bug. Not run
again as one single full suite.

## Written
README (status, run, test, deploy, structure), PLAN.md (appended "Status after the overnight build"), `docs/NEXT.md` (real list), `TEST-GUIDE.md`.
No code was changed. Removed `dist-e2e-*`, `test-results`; e2e rewrote some tracked `test-shots/*.png`, which were restored with git checkout.
