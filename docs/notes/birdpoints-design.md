# BirdPoints (BP): design

**Status: built (see "Built" at the end).** The design below is what was agreed. The numbers are starting values to polish and balance. The table of
ranges per bird is `data/bp-ranges.csv` (open it in a spreadsheet; `min` and `max` are the values to edit).

## Decided

* Every catch is its **own bird** in the Dex with its own BP, also when it is the same species with the same BP. Nothing is
  merged, nothing is "best of a species", and catching a species again always adds a new bird.
* **No repeat penalty.** A bird caught again within a day rolls like any other.
* No total BP, no "best per bird" and nothing on the trainer card: every bird is shown on its own with its own BP.
* Size and shyness stay in the ranges. The luck window stays at -9 % / +13 % (about 4 % chance of the max on a perfect catch).
* Higher floors: even the weakest catch of a legendary bird starts around 1600 BP, an epic one around 1100 (uncommon 300 and rare 650 are confirmed).
* Old catches get a BP with the new system.

## How a catch gets its BP

```
span   = max - min                                   (of this bird, from the table)
Q      = 0.50 x confidence + 0.10 x clarity + 0.10 x season + 0.10 x time of day + 0.20 x way     (0 to 1)
start  = min + 0.90 x span x Q^1.4                   (0.90 keeps the top tenth for luck)
luck   = from -9 % to +13 % of the span, two dice averaged (extremes are rare)
BP     = round( clamp(start + span x luck, min, max) )
```

| Factor | Weight | How it is scored (0 to 1) |
|---|---|---|
| Detection confidence | 50 % | 50 % sure = 0, 75 % = 0.5, 100 % = 1 |
| Clarity | 10 % | lead over the second guess: 0.5 or more = 1 |
| Season | 10 % | the bird's month strip for the month of the catch: peak 1.0, likely 0.7, a few 0.35, not there 0.1 |
| Time of day | 10 % | the bird's time of day against the hour of the catch: right 1.0, close 0.7, wrong 0.5 |
| Way of catching | 20 % | live camera 1.0, sound scan 0.9, photo taken in the last hour 0.8, older gallery photo falls to 0.4 over a week |

## Ranges

The floor (`min`) of a rarity is fixed. Size (AVONET body mass: 1 kg is x1.0, a tit about x0.7, a big eagle about x1.1) and
shyness (tame x0.95, wary x1.0, shy x1.08) stretch the span above the floor, so the max moves with them.

| Rarity | min | max at the size of a mallard |
|---|---|---|
| common | 50 | 750 |
| uncommon | 300 | 1000 |
| rare | 650 | 1400 |
| epic | 1100 | 1900 |
| legendary | 1600 | 2600 |

Resulting max range of the real table: common 480 to 840, uncommon 760 to 1160, rare 1140 to 1530, epic 1620 to 2110,
legendary 2250 to 2810. The mallard is pinned to 50 to 750 (the formula gives 50 to 710).

## What catches give (reference size, 60 000 simulated catches each; start, then the range where 99 of 100 catches land)

| Rarity (range) | Perfect (Q 1.0) | Great field catch (0.93) | Typical sound (0.74) | Old gallery photo (0.47) | Forced unsure (0.15) |
|---|---|---|---|---|---|
| common 50-750 | 680 (625-750) | 619 (564-702) | 463 (408-547) | 269 (213-352) | 94 (50-178) |
| uncommon 300-1000 | 930 (875-1000) | 869 (814-952) | 713 (658-797) | 519 (464-602) | 344 (300-428) |
| rare 650-1400 | 1325 (1266-1400) | 1260 (1201-1349) | 1093 (1033-1182) | 885 (825-974) | 697 (650-787) |
| epic 1100-1900 | 1820 (1757-1900) | 1750 (1687-1846) | 1572 (1509-1667) | 1350 (1287-1445) | 1151 (1100-1246) |
| legendary 1600-2600 | 2500 (2421-2600) | 2413 (2334-2532) | 2190 (2112-2310) | 1913 (1834-2032) | 1663 (1600-1782) |

## Where it is stored

Every catch is already its own record, so it keeps `bp` (the result), `bpBase` (the start), `bpQ` and `bpLuck`. After a
rebalance of the table an old catch can be recalculated with the same quality and the same luck, so nobody re-rolls. The
backup file gets the same optional fields. **Old catches** get a BP once at the first start after the update, from their saved
confidence, way and date (the lead over the second guess was not saved, so a middle value is used) with a luck roll that is
then fixed.

## The two screens (decided: like Pokémon GO)

Pokémon GO has the Pokédex (which species you have) and the Pokémon list (every one you caught, with its CP). We get the same pair.

### 1. Dex: the index of species (stays where it is)

Only the overview, no BP anywhere: a grid of all species, the picture of the bird when caught and the silhouette when not.
"Chyceno 40 z 282", the region chips (Česko, Evropa), the search and the status chips stay.
A card is tappable and opens the **species page**. It stays because the finding info ("Kdy a kde ho hledat", months, place,
shyness, time of day) is how you find a bird you miss. The species page loses the list of catches and the BP. A caught species
has one row there, "Moji ptáci tohoto druhu (3)", that opens the Ptáci screen filtered to that species.

### 2. Ptáci: every bird you caught (new, a fourth key in the bottom bar)

```
 +-----------------------------------+     +-----------------------------------+
 | Moji ptáci            17 ptáků    |     | <  Detail ptáka          2 z 17 > |
 | [hledej…]                         |     |  +-----------------------------+  |
 | [BP v] [Nejnovější] [Název] [Vz.] |     |  |   vlastní fotka (nebo ukázka |  |
 | +--------+ +--------+             |     |  |   + přehrávač nahrávky)      |  |
 | | BP 684 | | BP 512 |             |     |  +-----------------------------+  |
 | | foto   | | foto   |             |     |  Kachna divoká   (Anas platyr…)   |
 | | Kachna | | Kachna |             |     |  BP 684                          |
 | | *      | | *      |             |     |  50 ------------------o-- 750     |
 | +--------+ +--------+             |     |  start 619  štěstí +65            |
 | | BP 590 | | BP 244 |             |     |  Jistota 93 %   ###########-      |
 | | foto   | | zvuk * |             |     |  Čistota        ########---       |
 | | Kos    | | Sýkora |             |     |  Roční doba     ##########        |
 | +--------+ +--------+             |     |  Denní doba     ##########        |
 |                                   |     |  Způsob: živá kamera ##########   |
 | DEX | PTÁCI | SKENOVAT | NASTAVENÍ|     |  12. 9. 2026, 7:42, Praha         |
 +-----------------------------------+     |  Poznámka …            [Smazat]   |
                                           +-----------------------------------+
```

* **List:** every caught bird is a card, 2 per row, strongest first. The card has the BP big on top, the picture (your own
  photo; for a sound catch the reference photo with a speaker badge), the name and the rarity stars. Sorting: BP (default),
  newest, name, rarity. The search and the region/rarity chips work as in the Dex.
* **A bird:** its detail page (arrows to the previous and next bird of the current list). It shows the picture or, for a sound
  catch, the player of the clip; the BP with the bar from the bird's min to its max and a marker; "start 619, luck +65"; the
  five factors (confidence, clarity, season, time of day, way of catching) as small meters; date, place with the map link,
  a note, a link "O druhu" to the species page, and Delete. A bird of the same species with the same BP is a separate card.
* **Empty:** "V batohu zatím nikdo není" with a button to scan.
* **After a catch:** the success screen shows the BP (the big number and the bar) and the buttons are "Zobrazit ptáka" (opens
  its detail) and "Skenovat dál". Several birds caught at once: a list with the BP of each, every row opens its bird.
* **Sound:** a sound catch is a full bird with its own BP and card, not a buff (the way of catching scores it 0.9 against 1.0
  for the live camera). Birds from one recording share the clip. A "heard and seen" bonus is a possible later extra.

**Bottom bar:** four keys, DEX, PTÁCI, SKENOVAT, NASTAVENÍ. Four keys are about 82 px wide on a 360 to 390 px phone, so the
labels get a smaller size (or Nastavení becomes a gear icon); it is checked at 320, 360 and 390 px. The key can be called
"Batoh" instead of "Ptáci".

### What is built, in this order

1. The BP module (pure, tested with a fixed random generator) and the table of ranges (CSV to JSON).
2. The stored fields, the first-start BP for old catches, the backup file.
3. BP on the result and success screens.
4. The Ptáci screen and the bird page, the fourth key.
5. The species page loses the catch list; the Dex stays the index.
6. Tests (unit and browser), the test guide and the docs.

## Built

* `src/domain/birdPoints.ts`: the formula and every number to balance (`BP_CONFIG`, `TIER_RANGES`), pure and tested with seeded dice
  (`tests/unit/birdpoints.test.ts`).
* `data/bp-ranges.csv`: the `min` and `max` of every bird, the source of truth. `scripts/make-bp-ranges.py` adds the rows of new
  birds with the default formula and never touches existing rows; `scripts/build-species-info.py` copies the table into
  `species.json` (`info.bp`). To balance: edit the CSV, run `build-species-info.py`, push. Catches already made are recalculated
  at the next start of the app with the same quality and the same luck (`src/features/birds/syncBirdPoints.ts`).
* Every catch stores `bp`, `bpBase`, `bpQ`, `bpLuck`, `bpRange`, `bpFactors` (and `bpLegacy` for a catch from before BP). The
  backup file carries them. Catches without a BP get one at the start of the app and when a Ptáci screen opens.
* The bottom bar is Ptáci | Skenovat | Dex; the settings are a gear in the top right corner; the trainer card moved from the
  settings to the Dex (folded). The screens are `src/pages/BirdsPage.tsx` (list, three in a row) and `src/pages/BirdPage.tsx`
  (one bird); the species page lost its list of catches and links to `/birds?species=<id>`.
* Clarity (one of the five scores) is the lead of a bird over the strongest guess that was not sure enough; a catch from before BP
  has no lead and gets the middle value 0.6.
