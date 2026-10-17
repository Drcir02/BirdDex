# Fixes after the independent review: ML and data (task FIX-ML)

Eight findings came back for the sound, photo and data side. This note says what was changed, what was measured, and what was
left alone and why. All numbers are from the real models (Python onnxruntime / ai-edge-litert and the browser pipeline), on the 24
WingDex photos plus the project fixtures.

## 1. Photo: confident wrong answers for foreign or look-alike birds (major)

Re-checked: true. With the shipped recipe (penalty 6) the browser pipeline gives, for photos of birds the Dex does not have or
cannot tell apart, confident answers: Palm Warbler read as Water Pipit 0.97, Great Blue Heron (Drayton Harbor) as Purple Heron
0.90, House Sparrow in a mosaic as Mandarin Duck 0.78, cormorants on a marker as European Starling 0.76. Right answers sit at 0.63
to 0.99, so no confidence threshold separates them. I also tried the other levers of the finding:

- **Refitting `outOfDexPenalty`** (tried 2, 3, 4, 5, 6 on all 26 photos, at 512 px and full size): no value separates. A smaller penalty
  lowers the wrong Palm Warbler (0.97, 0.96, 0.93, 0.87, 0.73) but drops the right Great Cormorant faster (0.80, 0.62, 0.38, 0.19,
  0.08). Left at 6. The table is in `thresholds.ts` and the unit tests.
- **pBird >= 0.95** (finding fix 1): works. Every right answer has pBird 0.98 to 1.00; the sparrow is 0.84 to 0.91, the cormorants
  on the marker 0.91 to 0.96. Built in (below).
- **The plain model's own foreign top-1** (finding fix 2): works for clear cases, not for the Palm Warbler. I added
  `outsideDexTop`, the probability of the strongest species outside the Dex in the plain softmax (no penalty, no prior). Measured in
  the browser: Hairy Woodpecker 0.89 (American, not in the Dex), gulls from Seattle 0.9, Great Blue Heron 0.24 (512 px) to 0.38
  (full size), but also the **right** Great Cormorant 0.265 (its American cousins) and the Palm Warbler only 0.278. So the limit is set
  by the Cormorant: **normal 0.35, strict 0.30, easy 0.60**. The Palm Warbler read as a Water Pipit therefore **still gets through**
  (known gap, written into the unit test table), and so does a Great Blue Heron photographed small. No number in the model separates
  them from a European Cormorant; a taxon table (is the foreign top-1 in the same genus as the Dex answer? Cormorant yes, Palm
  Warbler no) would, but it needs genus names for all 10994 rows in the app (about 40 KB more data and plumbing), which I did not build.
- **Second confirmation with the species photo for epic and legendary photo catches** (finding fix 4): not built, it is a screen
  change (`src/features/scan`), outside this task's files.

### What changed

| Where | What |
|---|---|
| `src/ml/vision/scoring.ts` | `outsideDexTop(sims, dexMask)`. |
| `src/ml/vision/core.ts` | `VisionScores.outsideTop` (0 for a blank picture). |
| `src/ml/vision/engine.ts` | `PhotoResult.outsideDexTop`; also in `diagnostics`. |
| `src/ml/vision/liveLogic.ts`, `live.ts` | the live scanner smooths it like pBird; `LiveUpdate.outsideDexTop`. |
| `src/domain/engines.ts`, `types.ts` | `outsideDexTop?` on `PhotoResult` and `LiveUpdate`; `pBird?` and `outsideDexTop?` on `PendingIdentification`. Optional, so fakes and old results work. |
| `src/domain/thresholds.ts` | `CatchRule.minBird` and `maxOutsideDex`; `evaluateCandidates(..., evidence?)`; two new `BlockReason`s: `not-a-clear-bird`, `maybe-outside-dex`. Order of reasons: confidence, lead, picture, foreign bird. |

| Rule (photo and live) | strict | normal | easy |
|---|---|---|---|
| min confidence / lead (unchanged) | 0.85 / 0.30 | 0.70 / 0.20 | 0.55 / 0.10 |
| min pBird | 0.97 | 0.95 | 0.85 |
| max outsideDexTop | 0.30 | 0.35 | 0.60 |

Sound has both checks off (`minBird` 0, `maxOutsideDex` 1). A missing number skips its check (fakes).

**Small edits in the screen side, needed so the numbers reach the rule** (the other fixer owns these files; each edit is a few
lines and was made against the file as it stood): `src/features/scan/pendingBuilders.ts` (copies `pBird` and `outsideDexTop` of a
photo result or live update onto the pending identification), `src/features/scan/resultModel.ts` (passes them to
`evaluateCandidates`, maps the two new reasons in `reasonKey`), `src/i18n/cs/result.ts` (`result.reason.notBird` and
`result.reason.outsideDex`). Tests: `tests/unit/scan-pending-builders.test.ts`, `tests/unit/scan-result-model.test.ts`.

Tests that would have caught it: `tests/unit/core-thresholds.test.ts` (rules, order of reasons, a table of 11 measured photos),
`tests/unit/vision-scoring.test.ts` (`outsideDexTop`), `vision-core`, `vision-engine`, `vision-live`, `vision-live-logic`, and
`tests/e2e/photo-engine.spec.ts` ("the Catch rules keep the confident wrong answers away...": real model; the sparrow is blocked as
`not-a-clear-bird`, an American woodpecker as `maybe-outside-dex`, the right birds stay catchable, the Cormorant's 0.265 stays
under the limit).

## 2. Sound: flat hiss gives a woodpecker 0.51 to 0.58 (minor, done)

Re-checked with the real model: white noise 0.52, rounding noise only 0.55, slope -1 dB per octave 0.53, -1.5 dB 0.37, -2 dB 0.07.
Digital silence gives nothing (0.0), so it is not a problem.

Fix: `src/ml/audio/flatness.ts`, spectral flatness of the 3 s window (Welch average of 2048-point Hann FFTs, 2 to 20 kHz,
geometric mean over arithmetic mean). White noise 0.996, -1 dB 0.976, -1.5 dB 0.951, -2 dB 0.916, -3 dB 0.82; **every window of
the two real recordings (the soundscape, the redpoll clip) 0.02 to 0.73**. A window at 0.95 or above is "only hiss": the engine
returns an empty window without running BirdNET (`FLAT_LIMIT`, `flatLimit` option of `createSoundEngine`, `Infinity` switches it
off). So no woodpecker, `hearingBird` false, nothing to catch, and a little CPU saved. Digital silence counts as "not judged".
The easy sound threshold was already 0.60 (the finding asked for at least that); I only corrected the comment in `thresholds.ts`.

Risk: a real faint bird in an almost perfectly flat noise floor is dropped for that window (flatness above 0.95 needs a nearly
flat spectrum, which real outdoor noise does not have). The margin to the real recordings is large (0.73 against 0.95) but there
is no European field recording here to prove it. **For the owner's phone test:** hold the phone in a quiet room, start a sound
scan, and check that it says nothing (no woodpecker).

Tests: `tests/unit/sound-flatness.test.ts` (12: white, rounding, slopes, loudness independence, tone, silence, real fixtures, FFT
against a plain DFT), `tests/unit/sound-engine.test.ts` (two: the model is not asked about hiss, and is when the check is off),
`tests/e2e/sound-engine.spec.ts` ("live scan with flat noise as the microphone": a hiss file as the fake mic, the real model
loaded, nothing reported).

## 3. Redpoll pair (minor) - not changed

The finding is right (Lesser Redpoll 0.945 above Common Redpoll 0.798 for the one clip; the Dex calls Lesser epic and Common rare in
Czechia), but both stay in the top three, so the person can pick either, and a rank factor for `acanthis-cabaret` (needs about 0.7 to
flip the clip) would stop a real Lesser Redpoll from reaching the 0.70 normal threshold. One recording is too thin to justify
that. Left as it is. If more redpoll recordings show the same order, add a per-species weight in `dexLookup` (`scores.ts`).

## 4. Czech names (minor, partly done)

Four names are corrected in `CZECH_NAME_OVERRIDES` (`scripts/build-species.py`), written from memory and in agreement with the
reviewer's memory, **to be confirmed by a Czech speaker**: Calidris minuta `jespáček malý` (was jespák malý), Calidris temminckii
`jespáček Temminckův` (was jespák šedý), Larus fuscus `racek tmavohřbetý` (was racek žlutonohý), Cecropis daurica `vlaštovka
červenořitá` (was vlaštovka skalní). `Larus hyperboreus` ("racek šedý") and `Larus glaucoides` ("racek polární") are **not** changed:
neither the reviewer nor I know the current names for sure. `check_tables()` now also checks the name overrides (must name a bird,
must change the name). `species.json` was rebuilt: the only differences to the old file are these four names and the rarity changes
below (16 entries). The test mirror is in `tests/unit/data-species-data.test.ts`.

## 5. Rarity tiers (minor, done)

`RARITY_OVERRIDES` in `scripts/build-species.py`: Common Merganser, Caspian Gull, Western Marsh Harrier, Great Egret, Hawfinch, Great
Reed Warbler, Marsh Warbler and Golden Oriole move from common to uncommon; Dunnock, Eurasian Treecreeper, Short-toed Treecreeper and
Mistle Thrush from uncommon to common. Czech common birds: 81 became 77, uncommon 54 became 58. `check_tables()` keeps the table
honest (an entry must be a Czech bird whose measured tier it really changes; I checked that it complains about a redundant entry, a
Europe-only bird and an unknown name). Test: `data-species-data.test.ts` ("puts the birds of ponds, reed beds and the canopy...").

## 6. Download size shown before the model download (minor) - not changed

Right: the hub says about 90 MB, the real download is about 113 MB (the two runtimes, about 24 MB, come on top and go into the
service worker cache). The number shown comes from `summarizeStatus` in `src/features/scan/modelReadiness.ts` and from two more
places that sum the model store's `bytes` (settings storage, onboarding). All of those files are being edited by the UI fixer and
the sum cannot be changed at the model store without breaking the progress bar (loaded against total). The fix belongs there: add
the vendor runtime sizes (litert 9.37 MB + js, ort 14.24 MB + mjs; `public/vendor`) as a constant to the displayed total.

## 7. Backup import has no size check (minor, done)

`importBackup` rejects a file over `MAX_BACKUP_FILE_BYTES` (300 MB) with `BackupError('not-a-zip')` before reading it (the settings
screen already shows its calm "not a backup" sentence for that code). The practical limit is therefore a collection of about
2000 catches with 150 KB photos (308 MB on the measured desktop run is just over: such a collection needs a second export, or the
limit raised). Export still builds the whole zip in memory (unchanged). Test: `tests/unit/core-backup.test.ts`.

## 8. Imported catches for species that are not in the Dex (minor, done)

`importBackup` now skips catches whose `speciesId` is not in the Dex list and reports them as `unknownSpecies` (set only when
there are some; they count neither as added nor as skipped). The Dex list is `getLoadedSpecies()`, or `loadSpecies()` with a 4 s
wait; offline on a first visit with no list, nothing is checked and everything imports as before. `options.knownSpeciesIds` (a
`Set`, or `null` for no check) is for tests and callers that know better. The settings screen does not show `unknownSpecies` yet
(its text is the UI fixer's); the numbers on the Dex can no longer exceed the total after a restore. Tests in
`core-backup.test.ts` (5).

## Not tested here

A real phone's microphone noise (flatness), real European photos of the look-alike pairs, Czech spelling of the corrected names.
