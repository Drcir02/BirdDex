# BirdPoints (BP): design proposal

**Status: a proposal, nothing of it is in the app yet.** The numbers below are starting values to polish and balance.
The table of ranges per bird is in `docs/notes/birdpoints-ranges-draft.csv` (open it in a spreadsheet; `min` and `max` are the
values to edit).

## The idea

Every successful catch gets a number of BirdPoints, like CP in Pokémon GO. Catching a bird you already have is then worth
something: a better catch beats your best BP of that bird.

1. Each bird has its own range, for example mallard 50 to 750 BP.
2. The quality of the catch (how sure the app was, how and when it was caught, ...) decides where in the range you start.
3. A random luck roll moves the start up or down a little. The top of the range is only reachable with luck: a perfect catch
   of a mallard starts at 680 and ends between about 625 and 750.

## Step by step

```
span   = max - min                                   (of this bird, from the table)
Q      = 0.50 x confidence + 0.10 x clarity + 0.10 x season + 0.10 x time of day + 0.20 x way     (0 to 1)
Q      = Q x repeat factor
start  = min + 0.90 x span x Q^1.4                   (0.90 keeps the top tenth for luck)
luck   = from -9 % to +13 % of the span, two dice averaged (extremes are rare)
BP     = round( clamp(start + span x luck, min, max) )
```

| Factor | Weight | How it is scored (0 to 1) |
|---|---|---|
| Detection confidence | 50 % | 50 % sure = 0, 75 % = 0.5, 100 % = 1 |
| Clarity | 10 % | lead over the second guess: 0.5 or more = 1 |
| Season | 10 % | the bird's month strip (the "Kdy" bars) for the month of the catch: peak 1.0, likely 0.7, a few 0.35, not there 0.1 |
| Time of day | 10 % | the bird's time of day (morning, evening, night ...) against the hour of the catch: right 1.0, close 0.7, wrong 0.5 |
| Way of catching | 20 % | live camera 1.0, sound scan 0.9, photo taken in the last hour 0.8, older photo from the gallery falls to 0.4 over a week |
| Repeat factor | multiplies Q | the same bird caught again within 24 h: 1st 1.0, 2nd 0.85, 3rd 0.70, 4th and later 0.55 (stops rolling one bird at one pond for luck) |

The range of a bird (default, you can overwrite every number in the CSV):

| Rarity | min to max at the size of a mallard |
|---|---|
| common | 50 to 750 |
| uncommon | 80 to 1000 |
| rare | 120 to 1400 |
| epic | 200 to 1900 |
| legendary | 300 to 2600 |

Then the max is scaled by the size of the bird (AVONET body mass: 1 kg is x1.0, a tit about x0.7, a big eagle about x1.1)
and by shyness (tame x0.95, wary x1.0, shy x1.08). A bird that only lives in Europe is epic or legendary in the Dex, so its
range is high.

## What comes out (mallard-like range 50 to 750, 100 000 simulated catches each)

| Catch | Q | Start | 90 % of catches land in | Chance of the max |
|---|---|---|---|---|
| Perfect: live camera, 100 %, peak season, right hour | 1.00 | 680 | 625 to 750 | 3.9 % |
| Great field catch: live, 93 %, in season, right hour | 0.93 | 619 | 564 to 702 | 0 % |
| Typical sound catch: 80 %, so-so hour | 0.74 | 463 | 408 to 547 | 0 % |
| Old gallery photo, 72 %, shoulder month | 0.47 | 272 | 217 to 355 | 0 % |
| Forced catch of an unsure guess, 45 % | 0.15 | 94 | 50 to 178 | 0 % |

## Where it is stored

Each catch keeps `bp` (the result), `bpBase` (the start), `bpQ` and `bpLuck`. When you change the table later, an old catch
can be recalculated with the same quality and the same luck, so nobody has to re-roll. The backup file gets the same
optional fields. Catches made before BP existed get a BP once, from their saved confidence, way and date, with a luck roll
that is then fixed.

## Where it shows

* After a catch: the BP big, a bar from the bird's min to its max with a marker, "start 619, luck +14", a tap opens the
  breakdown, and "Nový rekord!" when it beats your best of that bird.
* Bird page: best BP of the bird and the BP of every catch. Dex card: best BP of a caught bird.
* Trainer card: total BP = the sum of the best BP of every caught bird (so a repeat catch counts only when it is better).
* Several birds caught at once: each rolls on its own.

## Open decisions

See the end of the chat message this came with.
