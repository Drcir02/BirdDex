# BirdPoints (BP): design

**Status: a design, nothing of it is in the app yet.** The numbers are starting values to polish and balance. The table of
ranges per bird is `docs/notes/birdpoints-ranges-draft.csv` (open it in a spreadsheet; `min` and `max` are the values to edit).

## Decided

* Every catch is its **own bird** in the Dex with its own BP, also when it is the same species with the same BP. Nothing is
  merged, nothing is "best of a species", and catching a species again always adds a new bird.
* **No repeat penalty.** A bird caught again within a day rolls like any other.
* No total BP and no "best per bird" (see the open question about the trainer card).
* Size and shyness stay in the ranges. The luck window stays at -9 % / +13 % (about 4 % chance of the max on a perfect catch).
* Higher floors: even the weakest catch of a legendary bird starts around 1600 BP, an epic one around 1100.
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

## What catches give (reference size, 60 000 simulated catches each; start, then 90 % of catches)

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

## How to show it (design considerations)

The Dex today is a grid of species (a silhouette until caught). With BP the thing to collect is the individual bird, as in
Pokémon GO, where the Pokédex lists species and the storage lists every Pokémon with its CP.

**The card of one caught bird:** the BP big at the top, the photo (own photo; for a sound catch the reference photo with a
speaker badge), the name, rarity stars, the date. A small bar can show where in the bird's range it landed. Tap: the bird's
page with the clip or photo, the breakdown (confidence, season, time of day, way, luck) and the delete button.

| Option | What it is | For | Against |
|---|---|---|---|
| **A. Two views in the same Dex (recommended)** | A switch at the top of the Dex: **Moji ptáci** and **Podle druhů**. *Moji ptáci*: every caught bird as a card, strongest first, then a line "Ještě nechycení (N)" and the silhouettes of the missing species. *Podle druhů*: today's species grid, each caught species with a "x3" badge. | Nothing new in the bottom bar. The caught birds with BP come first and the missing ones after, as asked. The species progress ("Chyceno 40 z 282") stays. | The Dex screen does two jobs |
| B. A fourth bottom button | **Dex** stays as it is, a new **Ptáci** screen lists the individuals | Two clean screens, closest to Pokémon GO | Four buttons in a bar made for three, a bigger change |
| C. One list only | The Dex becomes the list of individuals plus silhouettes, no species view | Simplest | Loses the species overview and the "x of 282" completion feeling |

Sorting and filters in *Moji ptáci*: BP (default), newest, name, rarity; the region chips and the search work as now. The
species page keeps its info block and lists all birds of that species, each with its BP, strongest first. A species card in
*Podle druhů* shows how many birds you have ("x3") and no BP, because the BP belongs to the individual.

**Sound:** a sound catch is a full bird with its own BP and its own card (the clip plays on its page), not a buff. The way of
catching only scores it a little lower than the live camera (0.9 against 1.0). Several birds caught from one recording are
several cards that share the one clip. A possible later extra is a "heard and seen" bonus when a photo and a recording of the
same species come within minutes of each other; it is not part of the first version.

**After a catch:** the BP big with a bar from min to max and a marker, "start 619, luck +14", a tap opens the breakdown.

## Open questions

1. The trainer card: I read "no total BP" as no total at all, only counts (species, birds). Say if you want a total of all
   birds later.
2. The floors of uncommon (300) and rare (650) are my fill-in between your 50, 1100 and 1600.
3. Which of A, B or C for the screens.
