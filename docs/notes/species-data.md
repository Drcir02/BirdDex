# Species data for the Dex (task F2)

`public/data/species.json` (423 birds, 119 KiB, about 20 KiB gzipped) is built by `scripts/build-species.py` from the BirdNET labels, BirdNET's location model and the WingDex taxonomy. `src/data/` loads it and offers the helpers the screens and engines need. Everything below was run here; the last section lists what could not be tested.

## What is in the file

423 birds, all in Europe (`inEurope` is true for every one; the file is the Dex), of which **276 occur in Czechia** (`inCzechia`) and 147 only elsewhere in Europe.

| Rarity | Czech birds | Europe-only birds | Together |
|---|---|---|---|
| common | 81 | - | 81 |
| uncommon | 54 | - | 54 |
| rare | 85 | - | 85 |
| epic | 46 | 97 | 143 |
| legendary | 10 | 50 | 60 |

Fields (`Species` in `src/domain/types.ts`), with what the script puts in them:

| Field | Value |
|---|---|
| `id` | scientific name in lower case with dashes, `parus-major`. Stable: store ids, never Dex numbers |
| `dexNumber` | 1 to 423 in WingDex (eBird) taxonomic order, so families sit together. It changes when the list is rebuilt, the id does not |
| `scientificName`, `englishName` | exactly the BirdNET label, for example `Accipiter gentilis` / `Northern Goshawk` (the label, not the newest eBird name) |
| `czechName` | `labels_cs.txt` where it differs from the English label, **with the first letter in capitals** (`Sýkora koňadra`, the label has `sýkora koňadra`) so it can be a heading as it is; null where BirdNET only has English (today: none of the 423) |
| `family` | Latin family name (`Paridae`), which is what `SpeciesSilhouette` understands. The WingDex taxonomy has no family column, so the script has its own genus to family table (eBird / Clements families). It is checked by the order: every family is one unbroken block in Dex order, so a wrong family would show up |
| `rarity` | see "Rarity" |
| `birdnetIndex` | exact position in BirdNET's 6522 outputs (and in the label files) |
| `wingclipIndex` | exact row of `text_classifier_int8.bin` (row 10994 is the bird / not-bird probe and is never a species). Null for the two redpolls WingCLIP lumps (see below) |
| `wikiTitle` | English Wikipedia article title from the WingDex taxonomy (`Great tit`); the scientific name for the two birds without a WingCLIP row (Wikipedia redirects it) |

## API (`src/data/species.ts`, also `src/data/index.ts`)

```ts
import { loadSpecies, getSpeciesById, filterByRegion, searchSpecies, sortSpecies, displayName, secondaryName,
  speciesByBirdnetIndex, speciesByWingclipIndex, birdnetIndices, wingclipIndices } from '../data'   // or '../data/species'
import { useSpecies } from '../data'            // React hook: { species, error, retry }
import { familyNameCs } from '../data'          // 'Paridae' -> 'sýkorovití'
```

| Need | Call |
|---|---|
| Load the list once (memoised, a failed load can be retried) | `const list = await loadSpecies()`: a `readonly Species[]` sorted by `dexNumber`. Throws `SpeciesLoadError` (`reason` is `network`, `http` or `malformed`) |
| In a component | `const { species, error, retry } = useSpecies()`: `species` is undefined while loading; it is set at once if the list was loaded before |
| After loading, without awaiting | `getLoadedSpecies()` gives the list or undefined |
| One bird | `getSpeciesById('parus-major')` (loaded list) or `getSpeciesById(id, list)` |
| Czech birds / all birds of the Dex | `filterByRegion(list, 'czechia')` / `filterByRegion(list, 'europe')` (the whole file) |
| By rarity | `filterByRarity(list, 'rare')` or `filterByRarity(list, ['epic', 'legendary'])`; `regionCounts(list)` gives `{ czechia, europe }` |
| Search | `searchSpecies(list, 'sykora kon')`: Czech, English and scientific names, case and accents ignored, every word must match, best matches first (a name that starts with the word beats one that only contains it), then Dex order. `{ limit }` is optional. Empty query gives nothing |
| Sort | `sortSpecies(list, 'number' \| 'name' \| 'family' \| 'rarity', { descending? })`, a copy. `name` uses `Intl.Collator('cs')` (c, č, d, ď ... h, ch, i), `family` is A to Z then Dex order, `rarity` is common first |
| Group by family | `groupByFamily(list)` gives `{ family, species }[]` in Dex order |
| Name to show | `displayName(s)` is the Czech name or, when BirdNET has none, the scientific name; `secondaryName(s)` is the scientific name, or null when it is already the main name. `formatDexNumber(7)` is `#007` |
| Engines | `speciesByBirdnetIndex(list)` and `speciesByWingclipIndex(list)` give a `ReadonlyMap<number, Species>` (cached per list; only birds of the Dex are in them, so BirdNET's 6100 other labels and WingCLIP's 10500 other species are simply not found). `birdnetIndices(list, region?)` and `wingclipIndices(list, region?)` give an `Int32Array` of positions in Dex order for masking scores |

Every helper takes the list as its first argument, so tests can pass their own. The lookup helpers (`getSpeciesById`, the maps, the index lists) fall back to the loaded list and answer "nothing" before it is loaded. In tests: `resetSpeciesCache(list)` pretends the list is loaded, `resetSpeciesCache()` forgets it.

Other exports: `RARITIES`, `rarityRank`, `inRegion`, `compareCzech`, `czechCollator`, `normalizeForSearch`, `matchScore`, `parseSpecies` (validates and sorts), `fetchSpeciesList` (loads without memory), `SPECIES_URL`, `SPECIES_CACHE_NAME`.

### Recipes for the other tasks

```ts
// Dex screen: useSpecies gives the list, the helpers do the rest
const { species, error, retry } = useSpecies()
const shown = useMemo(() => {
  if (!species) return []
  const inRegion = filterByRegion(species, region)                       // 'czechia' | 'europe'
  return query ? searchSpecies(inRegion, query) : sortSpecies(inRegion, sortKey)   // a search result is already in order of match
}, [species, region, query, sortKey])
// a card: displayName(s) is the title, secondaryName(s) the small line, formatDexNumber(s.dexNumber) the number,
// <SpeciesSilhouette family={s.family} />, s.rarity for the colour, caught state from useCaughtSummary().bySpecies.get(s.id)

// Result screen and species page: a candidate or a route parameter to a bird
const bird = getSpeciesById(candidate.speciesId)                          // undefined until loadSpecies() has finished

// Sound engine: BirdNET scores (6522) to candidates, limited to the Dex
const list = await loadSpecies()                                          // do this in prepare()
const dex = speciesByBirdnetIndex(list)                                   // Map<number, Species>
const europe = birdnetIndices(list, 'europe')                             // Int32Array of positions to keep
// candidates = indices sorted by score, filtered with dex.has(i), mapped with dex.get(i)!.id

// Photo engine: the WingCLIP classifier has 10994 species rows; only the Dex rows are candidates
const rows = wingclipIndices(list, 'europe')                              // Int32Array, no nulls
const byRow = speciesByWingclipIndex(list)                                // row -> Species
```

### Loading and offline

`loadSpecies()` fetches `${import.meta.env.BASE_URL}data/species.json` with `cache: 'no-cache'` (revalidate, so a new deploy shows at once; GitHub Pages answers 304) and keeps a copy in Cache Storage (`birddex-data-v1`). When the network fails, or the server answers with a page that is not the data, the copy is used. With no network and no copy it throws.

**Integrator, please look at this:** `vite.config.ts` (not mine) precaches only `js, css, html, svg, png, ico, woff2`, so the service worker does **not** hold `data/species.json`. The loader's own Cache Storage copy covers it (tested in a real browser, offline), but the simplest fix is to add `json` to `workbox.globPatterns` (the file is 119 KiB), and then the Dex is available from the very first offline start. Nothing else needs to change.

## Decisions

### 1. Which labels are birds

BirdNET V2.4 has 6522 labels: 6421 birds and **101 that are not**: 11 sound classes (Dog, Engine, Environmental, Fireworks, Gun, Human non-vocal, Human vocal, Human whistle, Noise, Power tools, Siren) and 90 frogs, toads, katydids, crickets, one bee and some mammals (`NON_BIRD_GENERA` in the script, 36 genera). The script checks this list against BirdNET-Analyzer's `eBird_taxonomy_codes_2024E.json` (non-birds have `t-...` codes there) and stops if the two lists differ; they agree. Intersecting with the WingDex taxonomy alone would not have been enough: it drops real birds that WingDex names differently. No non-bird can reach the Dex (the geo model gives them about 0 anyway, and the script and the tests check).

### 2. Matching with WingDex (the WingCLIP row, the order, the Wikipedia title)

The WingDex taxonomy (`src/lib/taxonomy.json`, 10994 rows) is the classifier: row `i` is row `i` of `text_classifier_int8.bin`, which has 10995 rows (10994 species plus the probe; 10995 x 768 int8 plus 10995 float32 scales is exactly the 8488140 bytes of the file). The order of the rows is eBird's taxonomic order.

The newer eBird taxonomy behind WingDex renamed, moved and split many birds since the 2021 names in BirdNET's labels. The script accepts a match only when it is certain: the same scientific name **and** the same English name, or the same species epithet **and** the same English name under a moved genus (7 birds: Alpine Swift, Little Ringed Plover, Kentish Plover, Little Bittern, Demoiselle Crane, Eurasian Dotterel, Eurasian Jackdaw). Everything else must be pinned by hand in `WINGCLIP_PINS` or the script stops and lists it. Only 16 of 423 needed that, and I checked each one:

| BirdNET | WingDex taxon | Why |
|---|---|---|
| Acrocephalus scirpaceus, Botaurus stellaris, Circus aeruginosus, Delichon urbicum, Upupa epops | same name, English name changed | Common Reed Warbler, Eurasian Bittern, Western Marsh Harrier, Western House-Martin, Common Hoopoe |
| Larus argentatus, Nucifraga caryocatactes, Numenius phaeopus, Tyto alba | same scientific name | a wider species was split; the part that lives in Europe keeps the old name (European Herring Gull, Northern Nutcracker, Eurasian Whimbrel, Western Barn Owl) |
| Calonectris diomedea | Scopoli's Shearwater | BirdNET's Cory's covers two species; this is the Mediterranean one |
| **Cecropis daurica** | **Cecropis rufula** (European Red-rumped Swallow) | the trap: the old name now belongs to the Asian half, an exact name match would have given the wrong row |
| **Accipiter gentilis** | **Astur gentilis** (Eurasian Goshawk) | goshawks moved genus and the American one was split off. A match through the old eBird code gave American Goshawk, which is wrong for Europe |
| Bubulcus ibis | Ardea ibis (Western Cattle-Egret) | genus change |
| Acanthis flammea | Acanthis flammea ("Redpoll") | WingDex lumped three redpolls into one |
| **Acanthis cabaret, Acanthis hornemanni** | none (`wingclipIndex: null`) | the other two redpolls. They have no row of their own, and the one row goes to the main species so that a row never means two birds |

**Unmatched BirdNET birds that occur in Europe:** only the two redpolls (no WingCLIP row). The 14 others in the table above did match, but only after a check by hand, and every other bird in the Dex matched by itself. Of all 6421 BirdNET birds, 5972 have the same scientific and English name in WingDex, 194 only moved genus, 16 are pinned above, and 239 (mostly tropical birds that eBird renamed or split, for example 177 with the same scientific name but another English name) would need a decision; none of those 239 is a bird of Europe, so none was decided. The two redpolls sort next to the Redpoll (`ORDER_ANCHORS`) and use their scientific name as Wikipedia title. A photo of a Lesser or Hoary Redpoll will be recognised as the Common Redpoll; they can still be caught by sound.

Both index numbers were **verified with the real models**: `build-species.py --verify-models` runs BirdNET on the 3 second Lesser Redpoll recording (the loudest output is position 6, 0.94, and that is the `birdnetIndex` of `acanthis-cabaret`), and runs the int8 WingCLIP model on the seven fixture photos of `tests/fixtures/photos` (same preprocessing as `clip-preprocess.ts`) and checks that the right row is in the model's top 3. It is for 5 of 7 (kingfisher, mallard, rock pigeon, goldeneye, hairy woodpecker); the two misses are a cormorant that WingDex's location prior normally rescues and a sparrow in a coloured mosaic. If the rows were shifted by one the numbers would collapse.

### 3. Europe and Czechia membership

**Sampling.** The location model (`[lat, lon, week]`, week 1 to 48, run in batches with `ai_edge_litert`) is run for all 48 weeks at **155 Europe points** (British Isles, Iceland, Scandinavia, Finland, the Baltics, Belarus and Ukraine, Poland, Germany, Benelux, France, Switzerland, Austria, Slovakia, Hungary, Romania, the Balkans, Greece, western Turkey, Italy, Iberia; coasts, islands, plains and mountains, listed in the script) and at **22 points in Czechia** (cities, ponds, floodplains, uplands, the border mountains). Scores are rounded to 5 decimals so the result does not depend on the machine. Left out on purpose: Cyprus, Svalbard, the Faroes, the Azores, Madeira and the Canary Islands, and Russia east of Minsk and Kyiv; they would add African, Middle Eastern and Siberian birds. Moscow, Cyprus, Antalya and Eskisehir were in my first sample and I took them out when they brought in Siberian taiga birds and Cypriot specialities.

**Europe rule.** A bird is European when its best score over all points and weeks (`Emax`) and the number of points where it reaches 0.03 in some week (`B03`; 0.03 is BirdNET's own default for species lists) satisfy one of: `Emax >= 0.50`; or `Emax >= 0.30` and `B03 >= 3` (island endemics, Arctic and steppe specialities); or `Emax >= 0.09` and `B03 >= 8` (modest but spread: local regulars). Then two short override tables, each entry with its reason in the script:

* `EUROPE_EXCLUDE` (9): things the rule lets in that are not European birds: Bar-headed Goose, African Blue Tit, Common Bulbul, Turkestan Short-toed Lark, Laughing Dove, Hume's Warbler, Booted Warbler, Northern Bobwhite, Little Swift.
* `EUROPE_INCLUDE` (7): real European birds the rule drops because the sample is small there: Dupont's Lark, Mediterranean Short-toed Lark, Trumpeter Finch, Scottish Crossbill, Barrow's Goldeneye (Iceland), Semicollared Flycatcher, White-throated Kingfisher (the Aegean coast of Turkey, which the owner counts as Europe).

Vagrants are out: Blackpoll Warbler scores 0.004 everywhere in Europe, Yellow-rumped Warbler 0.02, American Robin and the other American birds under 0.03. The script keeps the tables honest: an entry that does not change the outcome is an error. **Robustness:** I re-ran the rule on 40 random samples that keep 80 percent of the Europe points; at most 9 of the 423 birds flip (local specialities that depend on one or two points: Western Olivaceous Warbler, Barbary Partridge, Corsican Nuthatch, Leach's Storm-Petrel, Black Wheatear, Red-necked Nightjar, Pin-tailed Sandgrouse, Demoiselle Crane, and Azure Tit on the other side), and the Czech decision flips for only 5 birds (Pink-footed Goose and four that are excluded by table anyway).

**Czechia rule.** A European bird is Czech when its best score at any Czech point and week is at least 0.005 (about the noise floor of the model), minus `CZECHIA_EXCLUDE` (33 entries: Mediterranean, Alpine and Arctic birds the model leaks across the border, escapes, vagrants), plus `CZECHIA_INCLUDE` (empty). The model is coarse near borders: Yellow-billed Chough scored 0.1 at a Czech point (leak from the Alps), Sardinian Warbler 0.007, Rose-ringed Parakeet 0.016.

**Counts.** 423 European and 276 Czech birds. The brief expected "roughly 450 to 700" and "300 to 420". I did not stretch the thresholds to get there: the model finds about 307 candidate Czech birds at the noise floor and 284 at 0.01; the other birds on the Czech national list (more than 400 species in all) are vagrants that it scores at about zero everywhere in the country, and including them would put birds nobody can see into the Czech filter. In Europe, BirdNET simply does not have a label for at least 29 regular European species (see the gap list below), and the rest of the shortfall is Middle Eastern and North African birds that the sample would let in and the rule keeps out. The thresholds are constants at the top of the script if the owner wants more.

**Sentinels** (in the script, which stops when one is wrong, and in `tests/unit/data-species-data.test.ts`): 31 garden birds must be Czech and common (Great Tit, Blackbird, Robin, House Sparrow, Tree Sparrow, Chaffinch, Goldfinch, Greenfinch, Woodpigeon, Collared Dove, Magpie, Hooded Crow, Starling, White Wagtail, Black Redstart, Nuthatch, Great Spotted Woodpecker, Wren, Chiffchaff, Blackcap, Swallow, House Martin, Swift, Mallard, Buzzard, Kestrel, Jay, Song Thrush, Bullfinch, Yellowhammer and more); 58 raptors, owls, waders, ducks, grouse, hoopoe, kingfisher, crane, storks, nutcracker, dipper, raven, bearded reedling and so on must be Czech; 24 Mediterranean, Atlantic and Arctic birds must be European, not Czech, and epic or legendary; 20 American and Asian vagrants, tropical birds and non-birds must be absent (the TypeScript test has slightly shorter lists). I also checked a list of about 370 European species from memory against the Dex: the only ones missing are on purpose (Northern Bald Ibis, Bar-headed Goose, Lanceolated Warbler) or have no BirdNET label.

`--report FILE` writes a review report with every bird by tier, how each was matched with WingDex, and the closest calls (birds whose best score is within 20 percent of a threshold, to see which verdicts would flip with another sample).

### 4. Rarity

Czech birds, from `pk`, the best week of the average over the 22 Czech points (an encounter-probability measure): common `pk >= 0.25` (a bird you see weekly in a garden, park or pond: Great Tit 1.0, Robin 0.74, Tree Sparrow 0.53), uncommon `>= 0.08` (Hawfinch is borderline at 0.27 common, Dunnock 0.13, Hoopoe 0.09), rare `>= 0.02` (Tawny Owl 0.04, Hobby 0.07, Dipper 0.05), epic `>= 0.0045` (Ural Owl, Eagle-Owl, Capercaillie, Black Grouse, Boreal Owl, Hazel Grouse, Ortolan Bunting), legendary below (Wallcreeper, Dotterel, Great Snipe, Red-necked Phalarope, Citrine Wagtail, Glossy Ibis, Three-toed Woodpecker, Moustached Warbler, Pink-footed Goose, Greater Spotted Eagle). 80 percent of the Czech birds are common, uncommon or rare, so most are reachable.

**Europe-only birds are always epic or legendary**: epic when the bird reaches 0.03 at 20 or more of the 155 Europe points (about 1 in 8, so you meet it on an ordinary trip to Spain, Italy, Scandinavia or the coast: Sardinian Warbler, Razorbill, Northern Gannet, Cetti's Warbler), legendary below that (range-restricted: Snowy Owl, Siberian Jay, Spanish Eagle, Dupont's Lark, Corsican Nuthatch, Pin-tailed Sandgrouse, King Eider). The rule is mechanical, so a few verdicts are arguable (Great Gray Owl comes out epic). The constants are `RARITY_PK` and `EUROPE_ONLY_EPIC_MIN_POINTS` in the script.

### 5. Czech names

I read all 423 Czech names against the English ones and scanned the labels for placeholders (a Latin word inside the name, foreign letters, double spaces, capitals): nothing. Duplicate names: none. Every Dex bird has a real Czech name (100 percent, the test demands 95). They are the usual Czech Society for Ornithology style (`sýkora koňadra`, `kos černý`, `pěnkava obecná`, `žluna zelená`, `chřástal polní`). `CZECH_NAME_OVERRIDES` is empty. Two I could not verify and left as they are: Glaucous Gull is `racek šedý` and Iceland Gull `racek polární` in the labels, while my memory says `racek polární` is the Glaucous Gull and `racek grónský` the Iceland Gull. Both are Europe-only rarities. A Czech reader should check them and any other name that looks odd.

### 6. Wikipedia titles

From the WingDex taxonomy (it validated them against Wikipedia): `Great tit`, `Greylag goose`, `Western jackdaw`. `src/lib/wikimedia.ts` of WingDex fetches `https://en.wikipedia.org/api/rest_v1/page/summary/<title with underscores>`; the same works here. For a bird that WingDex splits (Cecropis daurica and rufula) the title is the one of the row we use.

## BirdNET birds of Europe that BirdNET does not know (not in the Dex)

The Dex can only hold birds with a BirdNET label (`birdnetIndex` is a required number). At least 29 regular European species have no label, so the sound engine can never hear them and they are not in the Dex, although WingCLIP can recognise them in a photo: Bearded Vulture (Lammergeier), Egyptian Vulture, Bonelli's Eagle, Long-legged Buzzard, Levant Sparrowhawk, Saker, Lanner and Eleonora's Falcon, European Shag, Pygmy Cormorant, Great White and Dalmatian Pelican, Little Auk, Balearic and Yelkouan Shearwater, Steller's Eider, Red-breasted Goose, White-headed Duck, Marbled Duck, Great Bustard, Black-winged Pratincole, Cream-coloured Courser, Ivory Gull, Pallas's Gull, Rüppell's, Marmora's, Balearic and Eastern Subalpine Warbler, Menetries's Warbler. In Czechia the loss is small (Saker Falcon, Great Bustard and vagrants). **Option for the integrator:** make `birdnetIndex` `number | null` in the contract and add these as photo-only birds; I did not change the contract during a parallel build.

## How to rebuild

```
.venv/bin/python scripts/build-species.py                    # writes public/data/species.json
.venv/bin/python scripts/build-species.py --report r.txt     # also writes the review report (matches, closest calls, every bird by tier)
.venv/bin/python scripts/build-species.py --no-write --verify-models   # check only; also runs BirdNET and WingCLIP on the test files
```

Needs `public/models/birdnet-v2.4-geo-fp16.tflite` (fetch-models), the WingDex checkout (`--wingdex DIR` or `WINGDEX_DIR`, default `/home/user/birdnet-team/wingdex`, pinned commit `b0dda4b7cb77d86f918c1a75ad662b0f462bb0b2`; only `src/lib/taxonomy.json` is read) and, optionally, BirdNET-Analyzer's `eBird_taxonomy_codes_2024E.json` for the non-bird cross-check. The same inputs give a byte-identical file (checked by hashing two runs). The script stops (exit 1, nothing written) when a match is unresolved, a sentinel is on the wrong side, two birds share a WingCLIP row or a Czech name, a bird has no family, or an override entry is not needed. CI does not run it: the file is committed.

## Tests

* `tests/unit/data-species.test.ts` (31): normalising, search (accents, order of results, limits), Czech sorting, family grouping, filters, maps, index lists, the loader (network, offline copy, bad answers, one fetch for many callers, retry).
* `tests/unit/data-species-data.test.ts` (24): the real file against the label files: unique ids, ids from names, Dex numbers 1 to N in taxonomic order, families unbroken, **the label at every `birdnetIndex` is that bird in both languages**, Czech names equal to the Czech labels, 100 percent named (95 demanded), WingCLIP rows unique and below 10994, no sound class, frog, mammal or insect, Europe-only birds epic or legendary, tier spread, the sentinels, search on the real list. No model files needed.
* `tests/unit/data-use-species.test.ts` (3, jsdom): the `useSpecies` hook (empty, then the list; the list at once when already loaded; a failure and `retry`).
* `tests/e2e/data.spec.ts` (4, port 4183): the built site serves the file with Czech letters intact; in real Chromium `loadSpecies` fetches once, writes the Cache Storage copy and works offline, fails with a clear reason with neither; Chromium's Czech sorting and the accent-free search give the expected answers.

## Not tested here, and gotchas

* No Czech native speaker has read the names (see decision 5). No real phone: iOS Safari's `Intl.Collator('cs')` should match Chromium's ICU, but I could not run it.
* The location model is coarse near borders and its scores for rarely reported birds are small; the tiers follow it. A bird that is common in a place the 22 Czech points miss would look rarer than it is.
* Czechia is flagged by threshold plus 33 manual exclusions; the exclusions are ornithological judgement from memory of the Czech list, not from a data source on this machine (the network is closed).
* `family` is in Latin on purpose (the silhouettes read Latin families first); `familyNameCs` has Czech names for 72 of the 75 families (Calcariidae, Leiothrichidae and Psittaculidae have no common one, show the Latin name).
* The Dex is the BirdNET list, not the whole European list (see above).
* When the list is rebuilt, `dexNumber` can change (new birds shift the numbers). Catches store `speciesId`, so nothing breaks, but do not store numbers.
