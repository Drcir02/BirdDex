#!/usr/bin/env python3
"""Adds the BirdPoints range of every bird that has no row yet in data/bp-ranges.csv. Rows that exist are never touched.


The default range of a bird:
  * the floor (min) is fixed by the rarity: common 50, uncommon 300, rare 650, epic 1100, legendary 1600;
  * the span above it (700, 700, 750, 800, 1000 at the size of a mallard) is stretched by the size of the bird
    (AVONET body mass: x1 at 1 kg, 1 + 0.18 x log10(mass / 1000), between 0.65 and 1.3) and by its shyness (tame x0.95, wary
    x1.0, shy x1.08), and the max is rounded to tens.
The CSV is the source of truth: change min and max in it by hand (a spreadsheet will do) and run scripts/build-species-info.py,
which copies them into species.json. See docs/notes/birdpoints-design.md.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SPECIES_FILE = ROOT / "public" / "data" / "species.json"
BP_FILE = ROOT / "data" / "bp-ranges.csv"
FIELDS = ["dex", "id", "czech_name", "latin", "rarity", "mass_g", "shy", "min", "max", "note"]

TIER = {"common": (50, 700), "uncommon": (300, 700), "rare": (650, 750), "epic": (1100, 800), "legendary": (1600, 1000)}  # (min, span)
SHY = {1: 0.95, 2: 1.0, 3: 1.08}


def clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def masses(path: Path, species: list[dict]) -> dict[str, float]:
    import openpyxl

    workbook = openpyxl.load_workbook(path, read_only=True)
    rows = workbook["AVONET1_BirdLife"].iter_rows(values_only=True)
    head = next(rows)
    by_name = {}
    for row in rows:
        record = dict(zip(head, row))
        if record["Species1"]:
            by_name[record["Species1"]] = record
    rows = workbook["BirdLife-eBird crosswalk"].iter_rows(values_only=True)
    head = next(rows)
    to_birdlife: dict[str, str] = {}
    for row in rows:
        record = dict(zip(head, row))
        if record["Species1"] and record["Species2"]:
            to_birdlife.setdefault(record["Species2"], record["Species1"])
    result = {}
    for s in species:
        record = by_name.get(s["scientificName"]) or by_name.get(to_birdlife.get(s["scientificName"], ""))
        result[s["id"]] = float(record["Mass"]) if record and record["Mass"] else 1000.0
    return result


def default_range(s: dict, mass: float) -> tuple[int, int]:
    low, span = TIER[s["rarity"]]
    size = clamp(1 + 0.18 * math.log10(mass / 1000.0), 0.65, 1.30)
    return low, int(round((low + span * size * SHY[s["info"]["shy"]]) / 10.0) * 10)


def main() -> int:
    parser = argparse.ArgumentParser(description="Add the missing rows of data/bp-ranges.csv")
    parser.add_argument("--avonet", required=True, help="AVONET Supplementary dataset 1.xlsx (for the body mass)")
    args = parser.parse_args()

    species = json.loads(SPECIES_FILE.read_text(encoding="utf-8"))
    if any("info" not in s for s in species):
        print("make-bp-ranges: species.json has no info yet: run scripts/build-species-info.py first", file=sys.stderr)
        return 1
    existing: dict[str, dict] = {}
    if BP_FILE.exists():
        with BP_FILE.open(encoding="utf-8", newline="") as handle:
            existing = {row["id"]: row for row in csv.DictReader(handle)}
    mass = masses(Path(args.avonet), species)

    rows, added = [], 0
    for s in species:
        row = existing.get(s["id"])
        if row is None:
            low, high = default_range(s, mass[s["id"]])
            row = {"min": low, "max": high, "note": ""}
            added += 1
        rows.append(
            {
                "dex": s["dexNumber"],
                "id": s["id"],
                "czech_name": s["czechName"] or "",
                "latin": s["scientificName"],
                "rarity": s["rarity"],
                "mass_g": round(mass[s["id"]], 1),
                "shy": s["info"]["shy"],
                "min": row["min"],
                "max": row["max"],
                "note": row.get("note", ""),
            }
        )
    with BP_FILE.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=FIELDS)
        writer.writeheader()
        writer.writerows(rows)
    print(f"wrote {BP_FILE.relative_to(ROOT)}: {len(rows)} birds, {added} new")
    return 0


if __name__ == "__main__":
    sys.exit(main())
