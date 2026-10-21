#!/usr/bin/env python3
"""Builds public/data/species.json, the list of birds in the BirdDex Dex.

Run it from the project root with the project's Python:

    .venv/bin/python scripts/build-species.py [--wingdex DIR] [--report FILE] [--no-write] [--verify-models]

What goes in, what comes out
----------------------------
Inputs (all on disk, nothing is downloaded):
  * data/birdnet-v2.4/labels_en.txt and labels_cs.txt   BirdNET V2.4 labels ("Scientific name_Common name", 6522 lines)
  * public/models/birdnet-v2.4-geo-fp16.tflite          BirdNET's location model: [lat, lon, week 1..48] -> 6522 scores
  * WingDex (MIT, https://github.com/jlian/wingdex, pinned commit b0dda4b7cb77d86f918c1a75ad662b0f462bb0b2)
        src/lib/taxonomy.json  10994 rows [common, scientific, eBird code, Wikipedia title, ...]. The row position is
        the row of the WingCLIP text classifier (text_classifier_int8.bin has these 10994 rows plus one bird/not-bird
        probe row at the end), and the order of the rows is the eBird taxonomic order.
  * optional: BirdNET-Analyzer's eBird_taxonomy_codes_2024E.json, only used to cross-check the non-bird list.
Output: public/data/species.json, an array of Species (src/domain/types.ts) sorted by dexNumber.

How the decisions are made (the long version is in docs/notes/species-data.md)
  1. Birds: every label except the sound classes (Dog, Engine, ...) and the frogs, mammals and insects of NON_BIRD_GENERA.
  2. Europe and Czechia: the geo model is run for every week at EUROPE_POINTS and CZECHIA_POINTS. Thresholds on those
     scores pick the candidates; short, commented override tables (EUROPE_EXCLUDE, ...) fix what an ornithologist
     sees is wrong; SENTINELS at the bottom make the script fail when a well known bird is on the wrong side.
  3. Rarity: from the Czech scores (RARITY_PK, then the hand-made RARITY_OVERRIDES) for Czech birds; Europe-only birds are epic or legendary by range size.
  4. WingCLIP row, Wikipedia title and Dex order come from the WingDex taxonomy. A BirdNET bird whose name or species
     concept differs there is listed in WINGCLIP_PINS with the reason; anything unresolved stops the script.
  5. Czech names come straight from labels_cs.txt (only where they differ from the English label) with the first letter
     in capitals; CZECH_NAME_OVERRIDES is the place for corrections.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import unicodedata
from collections import Counter, defaultdict
from dataclasses import dataclass
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
LABELS_EN = ROOT / "data" / "birdnet-v2.4" / "labels_en.txt"
LABELS_CS = ROOT / "data" / "birdnet-v2.4" / "labels_cs.txt"
GEO_MODEL = ROOT / "public" / "models" / "birdnet-v2.4-geo-fp16.tflite"
OUT_FILE = ROOT / "public" / "data" / "species.json"
DEFAULT_WINGDEX = "/home/user/birdnet-team/wingdex"
DEFAULT_ANALYZER_CODES = "/home/user/birdnet-team/birdnet-analyzer/birdnet_analyzer/eBird_taxonomy_codes_2024E.json"
WINGDEX_COMMIT = "b0dda4b7cb77d86f918c1a75ad662b0f462bb0b2"
N_LABELS = 6522
N_TAXA = 10994

# ---------------------------------------------------------------------------------------------------------------------
# 1. Sample points for the location model. Land and coastal points, spread so that every region and habitat is covered.
#    Not sampled on purpose: Cyprus, Svalbard, Faroes, Macaronesia (Azores, Madeira, Canaries) and European Russia east
#    of Minsk and Kyiv. Those would add Middle Eastern, African and Siberian birds that are not "European birds".
# ---------------------------------------------------------------------------------------------------------------------

EUROPE_POINTS: list[tuple[str, float, float]] = [
    # British Isles and Ireland
    ("London", 51.51, -0.13), ("Norfolk coast", 52.95, 0.95), ("Cornwall", 50.15, -5.45),
    ("Peak District", 53.35, -1.80), ("Cairngorms", 57.10, -3.70), ("Shetland", 60.35, -1.20),
    ("Orkney", 59.00, -3.10), ("Northumberland coast", 55.60, -1.65), ("Dublin", 53.35, -6.26),
    ("Kerry", 52.10, -9.70), ("Snowdonia", 53.00, -3.95),
    # Iceland
    ("Reykjavik", 64.14, -21.90), ("Myvatn", 65.60, -17.00), ("Vik", 63.45, -19.00),
    # Norway
    ("Oslo", 59.91, 10.75), ("Bergen", 60.39, 5.32), ("Trondheim", 63.43, 10.40),
    ("Tromso", 69.65, 18.95), ("Varanger", 70.10, 30.00), ("Hardangervidda", 60.20, 7.50),
    ("Dovrefjell", 62.30, 9.60),
    # Sweden and Denmark
    ("Stockholm", 59.33, 18.07), ("Gothenburg", 57.71, 11.97), ("Oland", 56.30, 16.45),
    ("Falsterbo", 55.39, 12.83), ("Abisko", 68.35, 18.82), ("Umea", 63.83, 20.26),
    ("Copenhagen", 55.68, 12.57), ("Skallingen", 55.55, 8.30),
    # Finland and the Baltics
    ("Helsinki", 60.17, 24.94), ("Oulu", 65.01, 25.47), ("Inari", 68.91, 27.02),
    ("Kuusamo", 65.97, 29.19), ("Tallinn", 59.44, 24.75), ("Matsalu", 58.76, 23.67),
    ("Riga", 56.95, 24.11), ("Vilnius", 54.69, 25.28), ("Nemunas delta", 55.30, 21.30),
    # Western Russia, Belarus, Ukraine, Moldova
    ("St Petersburg", 59.93, 30.34), ("Minsk", 53.90, 27.57), ("Bialowieza", 52.70, 23.85),
    ("Kyiv", 50.45, 30.52), ("Lviv", 49.84, 24.03), ("Odesa", 46.48, 30.72),
    ("Crimea", 44.95, 34.10), ("Chisinau", 47.00, 28.86),
    # Poland
    ("Warsaw", 52.23, 21.01), ("Hel", 54.60, 18.80), ("Krakow", 50.06, 19.94),
    ("Zakopane", 49.30, 19.95), ("Biebrza", 53.30, 22.60), ("Wroclaw", 51.10, 17.03),
    # Germany
    ("Berlin", 52.52, 13.40), ("Hamburg", 53.55, 9.99), ("Munich", 48.14, 11.58),
    ("Black Forest", 48.00, 8.00), ("Frankfurt", 50.11, 8.68), ("Dresden", 51.05, 13.74),
    ("Ruegen", 54.45, 13.40), ("Bavarian Forest", 49.00, 13.40), ("Cologne", 50.94, 6.96),
    ("Wadden Sea", 54.40, 8.90),
    # Benelux
    ("Amsterdam", 52.37, 4.90), ("Texel", 53.05, 4.80), ("Brussels", 50.85, 4.35), ("Luxembourg", 49.60, 6.13),
    # France
    ("Paris", 48.86, 2.35), ("Brittany", 48.40, -4.50), ("Camargue", 43.50, 4.50),
    ("French Pyrenees", 42.90, 0.10), ("Alsace", 48.30, 7.40), ("Loire", 47.30, 0.70),
    ("Landes", 44.10, -1.00), ("Corsica", 42.20, 9.10), ("Vanoise", 45.40, 6.80),
    ("Baie de Somme", 50.20, 1.60), ("Massif Central", 45.50, 3.00), ("Crau", 43.60, 5.00),
    # Switzerland and Austria
    ("Zurich", 47.38, 8.54), ("Engadin", 46.65, 9.95), ("Valais", 46.20, 7.60),
    ("Vienna", 48.21, 16.37), ("Hohe Tauern", 47.10, 12.80), ("Neusiedler See", 47.80, 16.80),
    ("Salzkammergut", 47.60, 13.70),
    # Slovakia and Hungary
    ("Bratislava", 48.15, 17.11), ("High Tatras", 49.15, 20.10), ("Kosice", 48.72, 21.26),
    ("Budapest", 47.50, 19.04), ("Hortobagy", 47.58, 21.10), ("Balaton", 46.90, 17.80),
    # Romania
    ("Bucharest", 44.43, 26.10), ("Brasov", 45.65, 25.60), ("Cluj", 46.77, 23.60), ("Dobruja", 44.20, 28.60),
    # Balkans
    ("Ljubljana", 46.05, 14.50), ("Zagreb", 45.81, 15.98), ("Split", 43.51, 16.44),
    ("Plitvice", 44.90, 15.60), ("Istria", 45.20, 13.90), ("Belgrade", 44.79, 20.45),
    ("Sarajevo", 43.86, 18.41), ("Skadar lake", 42.20, 19.30), ("Tirana", 41.33, 19.82),
    ("Skopje", 41.99, 21.43), ("Sofia", 42.70, 23.32), ("Rila", 42.20, 23.60), ("Burgas", 42.50, 27.47),
    # Greece
    ("Athens", 37.98, 23.73), ("Crete", 35.30, 25.00), ("Lesbos", 39.20, 26.40),
    ("Thessaloniki", 40.64, 22.94), ("Evros", 40.85, 26.05), ("Peloponnese", 37.50, 22.30),
    ("Corfu", 39.62, 19.92), ("Rhodes", 36.20, 28.00), ("Olympus", 40.10, 22.35),
    # Western Turkey
    ("Istanbul", 41.01, 28.98), ("Izmir", 38.42, 27.14), ("Dardanelles", 40.15, 26.40), ("Bodrum", 37.04, 27.43),
    # Italy
    ("Rome", 41.90, 12.50), ("Po delta", 44.90, 12.30), ("Milan", 45.20, 9.50),
    ("Sicily", 37.50, 14.00), ("Sardinia", 40.00, 9.00), ("Gargano", 41.90, 16.00),
    ("Gran Paradiso", 45.50, 7.30), ("Calabria", 39.00, 16.50), ("Tuscany", 43.40, 11.20),
    ("Dolomites", 46.40, 11.90), ("Abruzzo", 41.80, 13.90), ("Venice lagoon", 45.40, 12.30),
    # Iberia
    ("Madrid", 40.42, -3.70), ("Donana", 37.00, -6.40), ("Monfrague", 39.80, -6.00),
    ("Ordesa", 42.65, -0.05), ("Ebro delta", 40.70, 0.80), ("Picos de Europa", 43.20, -4.90),
    ("Galicia", 42.80, -8.50), ("Ria Formosa", 37.00, -7.90), ("Lisbon", 38.70, -9.10),
    ("Porto", 41.15, -8.60), ("Tarifa", 36.00, -5.60), ("Almeria", 36.85, -2.45),
    ("Mallorca", 39.70, 3.00), ("Castro Verde", 37.70, -8.00), ("Bardenas", 42.20, -1.50),
    ("Gredos", 40.30, -5.20), ("Albufera", 39.30, -0.35), ("Barcelona", 41.30, 2.10),
    ("Sierra Nevada", 37.10, -3.30), ("Trujillo", 39.45, -5.90), ("Burgos", 42.35, -3.70),
    ("Belchite", 41.30, -0.75),
]

# Czechia: cities, lowland ponds and floodplains, uplands and the border mountains.
CZECHIA_POINTS: list[tuple[str, float, float]] = [
    ("Praha", 50.08, 14.43), ("Brno", 49.20, 16.61), ("Ostrava", 49.83, 18.29), ("Plzen", 49.75, 13.38),
    ("Ceske Budejovice", 48.97, 14.47), ("Hradec Kralove", 50.21, 15.83), ("Liberec", 50.77, 15.06),
    ("Olomouc", 49.59, 17.25), ("Karlovy Vary", 50.23, 12.87), ("Sumava Kvilda", 49.03, 13.58),
    ("Krkonose", 50.73, 15.60), ("Jeseniky", 50.08, 17.23), ("Trebon ponds", 49.00, 14.77),
    ("Lednice Palava", 48.80, 16.80), ("Beskydy", 49.50, 18.25), ("Podyji", 48.85, 15.95),
    ("Krusne hory", 50.40, 13.00), ("Zdarske vrchy", 49.65, 16.00), ("Soutok", 48.65, 16.95),
    ("Ceske stredohori", 50.60, 14.05), ("Brdy", 49.65, 13.85), ("Jizerske hory", 50.85, 15.20),
]

WEEKS = range(1, 49)

# Thresholds on the geo scores. "Emax" is the best score of the species over all Europe points and weeks, "B03" the
# number of Europe points where it reaches 0.03 (BirdNET's own default for species lists) in some week.
EUROPE_RULE = (
    # (minimum Emax, minimum B03)
    (0.50, 0),  # clearly European
    (0.30, 3),  # strong at a few places: island endemics, Arctic and steppe specialities
    (0.09, 8),  # modest but spread over several places: regular, local birds
)
# Czechia: the best score over the Czech points and weeks must reach this (0.005 is about the noise floor of the model).
CZECHIA_MIN_POINT_SCORE = 0.005

# Rarity of Czech birds from "pk", the best week of the average over the Czech points. Each pair is (minimum pk, tier).
RARITY_PK = ((0.25, "common"), (0.08, "uncommon"), (0.02, "rare"), (0.0045, "epic"))  # below the last: legendary
# The reporting-frequency measure (pk) says how often a bird is reported, not how easy it is to meet. Waterbody, reed-bed and
# raptor birds are reported by many observers because they sit on well-watched ponds, so they land in "common" although a
# garden birder meets a Dunnock, a Treecreeper or a Mistle Thrush far more easily. These corrections (a Czech-user view, set by
# hand) move the worst cases one tier. check_tables() keeps the table honest: an entry must be a Czech bird whose computed
# tier it really changes.
RARITY_OVERRIDES: dict[str, str] = {
    # reported a lot, but not a bird of the garden or the park path
    "Mergus merganser": "uncommon",  # Common Merganser
    "Larus cachinnans": "uncommon",  # Caspian Gull
    "Circus aeruginosus": "uncommon",  # Western Marsh Harrier
    "Ardea alba": "uncommon",  # Great Egret
    "Coccothraustes coccothraustes": "uncommon",  # Hawfinch, shy and high in the canopy
    "Acrocephalus arundinaceus": "uncommon",  # Great Reed Warbler, reed beds only
    "Acrocephalus palustris": "uncommon",  # Marsh Warbler
    "Oriolus oriolus": "uncommon",  # Eurasian Golden Oriole, heard far more than seen
    # easy to meet, but reported less often
    "Prunella modularis": "common",  # Dunnock
    "Certhia familiaris": "common",  # Eurasian Treecreeper
    "Certhia brachydactyla": "common",  # Short-toed Treecreeper
    "Turdus viscivorus": "common",  # Mistle Thrush
    # kept birds: no wild score at all, but easy to find where they are kept
    "Pavo cristatus": "uncommon",  # Indian Peafowl
    "Cygnus atratus": "rare",  # Black Swan
    "Chrysolophus pictus": "rare",  # Golden Pheasant
    "Chrysolophus amherstiae": "rare",  # Lady Amherst's Pheasant
    "Numida meleagris": "rare",  # Helmeted Guineafowl
    "Cairina moschata": "uncommon",  # Muscovy Duck
}
# Europe-only birds are epic when they reach 0.03 at this many Europe points (about 1 in 8), otherwise legendary.
EUROPE_ONLY_EPIC_MIN_POINTS = 20

# ---------------------------------------------------------------------------------------------------------------------
# 2. Which labels are birds
# ---------------------------------------------------------------------------------------------------------------------

SOUND_CLASSES = frozenset(
    ["Dog", "Engine", "Environmental", "Fireworks", "Gun", "Human non-vocal", "Human vocal", "Human whistle",
     "Noise", "Power tools", "Siren"]
)

# Frogs, toads, katydids, crickets, a bee and mammals that BirdNET also recognises. Genus names.
NON_BIRD_GENERA = frozenset(
    """Acris Allonemobius Alouatta Amblycorypha Anaxipha Anaxyrus Apis Atlanticus Canis Conocephalus Cyrtoxipha
    Dryophytes Eleutherodactylus Eunemobius Gastrophryne Gryllus Hyliola Incilius Lithobates Microcentrum Miogryllus
    Neoconocephalus Neonemobius Odocoileus Oecanthus Orchelimum Orocharis Phyllopalpus Pseudacris Pterophylla
    Scaphiopus Sciurus Scudderia Spea Tamias Tamiasciurus""".split()
)

# ---------------------------------------------------------------------------------------------------------------------
# 3. Europe and Czechia: corrections of the threshold rules (each with the reason)
# ---------------------------------------------------------------------------------------------------------------------

# The rule keeps these, but they are escaped birds, vagrants or birds of Africa and the Middle East that the model
# lets through at the edge of the sample (Tarifa, Sicily, Izmir, Bodrum).
EUROPE_EXCLUDE: dict[str, str] = {
    "Anser indicus": "Bar-headed Goose: escaped waterfowl",
    "Cyanistes teneriffae": "African Blue Tit: Canary Islands and North Africa",
    "Pycnonotus barbatus": "Common Bulbul: North Africa",
    "Alaudala heinei": "Turkestan Short-toed Lark: Asian steppe",
    "Streptopelia senegalensis": "Laughing Dove: Middle East",
    "Phylloscopus humei": "Hume's Warbler: vagrant",
    "Iduna caligata": "Booted Warbler: vagrant",
    "Colinus virginianus": "Northern Bobwhite: released gamebird, not established",
    "Apus affinis": "Little Swift: vagrant",
}

# The rule drops these, but they belong in a European Dex.
EUROPE_INCLUDE: dict[str, str] = {
    "Chersophilus duponti": "Dupont's Lark: speciality of the Spanish steppe",
    "Alaudala rufescens": "Mediterranean Short-toed Lark: Spain",
    "Bucanetes githagineus": "Trumpeter Finch: south-east Spain",
    "Loxia scotica": "Scottish Crossbill: Scottish endemic",
    "Bucephala islandica": "Barrow's Goldeneye: breeds in Iceland",
    "Ficedula semitorquata": "Semicollared Flycatcher: breeds in the Balkans",
    "Halcyon smyrnensis": "White-throated Kingfisher: lives on the Aegean coast of Turkey (named after Smyrna, today Izmir)",
    # Not wild birds of Europe, but kept in castle gardens, parks, zoos and farms, and people meet (and photograph) them there.
    "Pavo cristatus": "Indian Peafowl: castle gardens and parks",
    "Cygnus atratus": "Black Swan: park ponds",
    "Chrysolophus pictus": "Golden Pheasant: parks and zoos, also escaped",
    "Chrysolophus amherstiae": "Lady Amherst's Pheasant: parks and zoos, also escaped",
    "Numida meleagris": "Helmeted Guineafowl: farms and parks",
    "Cairina moschata": "Muscovy Duck: farms and park ponds",
}

# Passes the Czech threshold, but is a vagrant that has not been seen in Czechia, or an escape that is not established.
CZECHIA_EXCLUDE: dict[str, str] = {
    "Branta bernicla": "Brant: vagrant",
    "Tadorna ferruginea": "Ruddy Shelduck: escapes and vagrants",
    "Alectoris rufa": "Red-legged Partridge: Iberia and France, not Czechia",
    "Alectoris graeca": "Rock Partridge: Alps and Balkans, not Czechia",
    "Apus pallidus": "Pallid Swift: vagrant",
    "Zapornia pusilla": "Baillon's Crake: only old records",
    "Burhinus oedicnemus": "Eurasian Thick-knee: died out as a breeder, now a vagrant",
    "Charadrius alexandrinus": "Kentish Plover: died out as a breeder, now a vagrant",
    "Stercorarius parasiticus": "Parasitic Jaeger: vagrant",
    "Stercorarius pomarinus": "Pomarine Jaeger: vagrant",
    "Gelochelidon nilotica": "Gull-billed Tern: vagrant",
    "Thalasseus sandvicensis": "Sandwich Tern: vagrant",
    "Phoenicopterus roseus": "Greater Flamingo: escapes and vagrants",
    "Morus bassanus": "Northern Gannet: vagrant",
    "Gyps fulvus": "Eurasian Griffon: vagrant",
    "Circaetus gallicus": "Short-toed Snake-Eagle: vagrant",
    "Hieraaetus pennatus": "Booted Eagle: vagrant",
    "Falco naumanni": "Lesser Kestrel: vagrant",
    "Otus scops": "Eurasian Scops-Owl: vagrant",
    "Strix nebulosa": "Great Gray Owl: Fennoscandia, not Czechia",
    "Psittacula krameri": "Rose-ringed Parakeet: not established in Czechia",
    "Cisticola juncidis": "Zitting Cisticola: vagrant",
    "Hippolais polyglotta": "Melodious Warbler: vagrant",
    "Phylloscopus bonelli": "Western Bonelli's Warbler: vagrant",
    "Cettia cetti": "Cetti's Warbler: vagrant",
    "Curruca melanocephala": "Sardinian Warbler: vagrant",
    "Sitta neumayer": "Western Rock Nuthatch: vagrant",
    "Monticola solitarius": "Blue Rock-Thrush: vagrant",
    "Passer italiae": "Italian Sparrow: Italy and the Alps",
    "Passer hispaniolensis": "Spanish Sparrow: vagrant",
    "Montifringilla nivalis": "White-winged Snowfinch: Alps",
    "Pyrrhocorax graculus": "Yellow-billed Chough: Alps, Pyrenees and Balkans; the model leaks it across the border",
    "Emberiza cirlus": "Cirl Bunting: vagrant",
}

# Below the Czech threshold, but regular or annual in Czechia.
CZECHIA_INCLUDE: dict[str, str] = {
    "Pavo cristatus": "Indian Peafowl: castle gardens and parks (Czech chateau parks are full of them)",
    "Cygnus atratus": "Black Swan: park ponds",
    "Chrysolophus pictus": "Golden Pheasant: parks, zoos and escapes",
    "Chrysolophus amherstiae": "Lady Amherst's Pheasant: parks, zoos and escapes",
    "Numida meleagris": "Helmeted Guineafowl: farms and parks",
    "Cairina moschata": "Muscovy Duck: farms and park ponds",
}

# ---------------------------------------------------------------------------------------------------------------------
# 4. WingCLIP rows: BirdNET scientific name -> scientific name of the WingDex taxon, or None when WingCLIP has no row.
#    Only needed where the automatic match (same scientific name AND same English name, or a moved genus with the same
#    species name and the same English name) does not apply.
# ---------------------------------------------------------------------------------------------------------------------

WINGCLIP_PINS: dict[str, str | None] = {
    # Same species, only the English name was changed in the newer eBird taxonomy that WingDex follows.
    "Acrocephalus scirpaceus": "Acrocephalus scirpaceus",  # Eurasian -> Common Reed Warbler
    "Botaurus stellaris": "Botaurus stellaris",  # Great -> Eurasian Bittern
    "Circus aeruginosus": "Circus aeruginosus",  # Eurasian Marsh-Harrier -> Western Marsh Harrier
    "Delichon urbicum": "Delichon urbicum",  # Common -> Western House-Martin
    "Upupa epops": "Upupa epops",  # Eurasian -> Common Hoopoe
    # Split off from a wider species: the Dex bird is the part that lives in Europe, and it keeps the scientific name.
    "Larus argentatus": "Larus argentatus",  # European Herring Gull (the American one is Larus smithsonianus)
    "Nucifraga caryocatactes": "Nucifraga caryocatactes",  # Northern Nutcracker
    "Numenius phaeopus": "Numenius phaeopus",  # Eurasian Whimbrel (the American one is Numenius hudsonicus)
    "Tyto alba": "Tyto alba",  # Western Barn Owl
    "Calonectris diomedea": "Calonectris diomedea",  # Scopoli's Shearwater, the Mediterranean half of BirdNET's Cory's Shearwater
    # The old scientific name now belongs to the wrong half, or the species moved genus and got another name.
    "Cecropis daurica": "Cecropis rufula",  # European Red-rumped Swallow; Cecropis daurica is now the Asian one
    "Accipiter gentilis": "Astur gentilis",  # Eurasian Goshawk (Northern Goshawk was split; goshawks moved to Astur)
    "Bubulcus ibis": "Ardea ibis",  # Western Cattle-Egret
    # Lumped in WingDex: WingCLIP knows one "Redpoll". The row goes to the main species, the other two have none.
    "Acanthis flammea": "Acanthis flammea",
    "Acanthis cabaret": None,
    "Acanthis hornemanni": None,
}

# Birds without a WingCLIP row still need a place in the taxonomic order: sort them next to this WingDex taxon.
ORDER_ANCHORS: dict[str, str] = {
    "Acanthis cabaret": "Acanthis flammea",
    "Acanthis hornemanni": "Acanthis flammea",
}

# ---------------------------------------------------------------------------------------------------------------------
# 5. Names
# ---------------------------------------------------------------------------------------------------------------------

# BirdNET scientific name -> Czech name, for the rare label that is wrong or missing. Written in the same lower case
# style as labels_cs.txt; the first letter is capitalised like every other name.
CZECH_NAME_OVERRIDES: dict[str, str] = {
    # BirdNET's Czech labels follow older nomenclature here. The current names of the Czech Society for Ornithology, written
    # from memory and agreeing with an independent reviewer's memory; a Czech speaker should confirm them (docs/notes/species-data.md).
    "Calidris minuta": "jespáček malý",  # BirdNET: jespák malý
    "Calidris temminckii": "jespáček Temminckův",  # BirdNET: jespák šedý
    "Larus fuscus": "racek tmavohřbetý",  # BirdNET: racek žlutonohý
    "Cecropis daurica": "vlaštovka červenořitá",  # BirdNET: vlaštovka skalní
    # Not changed although they look dated too (not sure enough): Larus hyperboreus "racek šedý", Larus glaucoides "racek polární".
}

# Latin family names (eBird / Clements classification, the one the WingDex order follows), written as
# "Family: genus genus ...". The taxonomy file has no family column, so this table is the family source.
FAMILY_GENERA = """
Anatidae: Anser Branta Cygnus Cairina Alopochen Tadorna Aix Spatula Mareca Anas Netta Aythya Somateria Histrionicus Melanitta Clangula Bucephala Mergellus Mergus Oxyura
Numididae: Numida
Phasianidae: Tetrastes Lagopus Tetrao Lyrurus Perdix Phasianus Pavo Chrysolophus Tetraogallus Coturnix Alectoris Pternistis Francolinus
Odontophoridae: Colinus
Columbidae: Columba Streptopelia
Pteroclidae: Pterocles Syrrhaptes
Otididae: Tetrax
Cuculidae: Clamator Cuculus
Caprimulgidae: Caprimulgus
Apodidae: Apus
Rallidae: Rallus Crex Porzana Gallinula Fulica Porphyrio Zapornia
Gruidae: Anthropoides Grus
Burhinidae: Burhinus
Recurvirostridae: Himantopus Recurvirostra
Haematopodidae: Haematopus
Charadriidae: Pluvialis Charadrius Vanellus
Scolopacidae: Numenius Limosa Lymnocryptes Scolopax Gallinago Phalaropus Xenus Actitis Tringa Arenaria Calidris
Glareolidae: Glareola
Stercorariidae: Stercorarius
Alcidae: Fratercula Cepphus Alca Uria
Laridae: Hydrocoloeus Rissa Xema Chroicocephalus Ichthyaetus Larus Sternula Gelochelidon Hydroprogne Chlidonias Sterna Thalasseus
Phoenicopteridae: Phoenicopterus
Podicipedidae: Tachybaptus Podiceps
Gaviidae: Gavia
Hydrobatidae: Hydrobates
Procellariidae: Fulmarus Calonectris Ardenna Puffinus
Ciconiidae: Ciconia
Sulidae: Morus
Phalacrocoracidae: Phalacrocorax
Threskiornithidae: Plegadis Geronticus Platalea
Ardeidae: Botaurus Ixobrychus Nycticorax Egretta Ardeola Ardea Bubulcus
Pandionidae: Pandion
Accipitridae: Elanus Pernis Aegypius Gyps Circaetus Clanga Hieraaetus Aquila Accipiter Circus Milvus Haliaeetus Buteo
Tytonidae: Tyto
Strigidae: Otus Bubo Surnia Glaucidium Athene Strix Asio Aegolius
Upupidae: Upupa
Meropidae: Merops
Alcedinidae: Alcedo
Halcyonidae: Halcyon
Cerylidae: Ceryle
Coraciidae: Coracias
Picidae: Jynx Picoides Dendrocoptes Dendrocopos Dryobates Picus Dryocopus
Falconidae: Falco
Psittaculidae: Psittacula
Psittacidae: Myiopsitta
Oriolidae: Oriolus
Malaconotidae: Tchagra
Laniidae: Lanius
Corvidae: Perisoreus Garrulus Cyanopica Pica Nucifraga Pyrrhocorax Corvus
Paridae: Periparus Lophophanes Poecile Cyanistes Parus
Remizidae: Remiz
Alaudidae: Alaemon Ammomanes Lullula Alauda Galerida Eremophila Calandrella Melanocorypha Chersophilus Alaudala
Panuridae: Panurus
Cisticolidae: Cisticola Prinia
Scotocercidae: Scotocerca
Acrocephalidae: Iduna Hippolais Acrocephalus
Locustellidae: Locustella
Hirundinidae: Riparia Ptyonoprogne Hirundo Delichon Cecropis
Pycnonotidae: Pycnonotus
Phylloscopidae: Phylloscopus
Cettiidae: Cettia
Aegithalidae: Aegithalos
Sylviidae: Sylvia Curruca
Leiothrichidae: Leiothrix
Regulidae: Regulus
Tichodromidae: Tichodroma
Sittidae: Sitta
Certhiidae: Certhia
Troglodytidae: Troglodytes
Cinclidae: Cinclus
Sturnidae: Sturnus Pastor Acridotheres
Turdidae: Turdus
Muscicapidae: Muscicapa Cercotrichas Erithacus Irania Luscinia Tarsiger Calliope Ficedula Phoenicurus Monticola Saxicola Oenanthe
Bombycillidae: Bombycilla
Estrildidae: Euodice Estrilda Lagonosticta
Prunellidae: Prunella
Passeridae: Passer Petronia Montifringilla Carpospiza
Motacillidae: Motacilla Anthus
Fringillidae: Fringilla Coccothraustes Carpodacus Pinicola Pyrrhula Bucanetes Rhodospiza Chloris Linaria Acanthis Loxia Carduelis Serinus Spinus Haemorhous
Calcariidae: Calcarius Plectrophenax
Emberizidae: Emberiza
"""

GENUS_FAMILY: dict[str, str] = {}
for _line in FAMILY_GENERA.strip().splitlines():
    _family, _, _genera = _line.partition(":")
    for _genus in _genera.split():
        assert _genus not in GENUS_FAMILY, f"genus {_genus} is listed twice in FAMILY_GENERA"
        GENUS_FAMILY[_genus] = _family.strip()

# ---------------------------------------------------------------------------------------------------------------------
# 6. Sentinels: well known birds that must end up on the right side. The script stops if one is wrong.
# ---------------------------------------------------------------------------------------------------------------------

# Seen every week in a Czech garden or park: must be Czech and common.
SENTINEL_CZECH_COMMON = """Parus major|Cyanistes caeruleus|Turdus merula|Erithacus rubecula|Passer domesticus|Passer montanus
Fringilla coelebs|Carduelis carduelis|Chloris chloris|Columba palumbus|Streptopelia decaocto|Pica pica|Corvus cornix
Sturnus vulgaris|Motacilla alba|Phoenicurus ochruros|Sitta europaea|Dendrocopos major|Troglodytes troglodytes
Phylloscopus collybita|Sylvia atricapilla|Hirundo rustica|Delichon urbicum|Apus apus|Anas platyrhynchos
Buteo buteo|Falco tinnunculus|Garrulus glandarius|Turdus philomelos|Pyrrhula pyrrhula|Emberiza citrinella""".replace("\n", "|").split("|")

# Must be in Czechia (any tier): raptors, owls, waders, ducks and other birds every Czech birder knows.
SENTINEL_CZECHIA = """Accipiter nisus|Milvus milvus|Milvus migrans|Haliaeetus albicilla|Pandion haliaetus|Falco peregrinus|Falco subbuteo
Circus aeruginosus|Pernis apivorus|Strix aluco|Asio otus|Strix uralensis|Athene noctua|Bubo bubo|Glaucidium passerinum|Tyto alba
Vanellus vanellus|Actitis hypoleucos|Tringa ochropus|Calidris pugnax|Gallinago gallinago|Numenius arquata|Tringa totanus
Charadrius dubius|Aythya fuligula|Aythya ferina|Anas crecca|Mareca strepera|Mareca penelope|Spatula clypeata|Bucephala clangula
Mergus merganser|Mergellus albellus|Upupa epops|Alcedo atthis|Merops apiaster|Grus grus|Ciconia ciconia|Ciconia nigra
Tetrao urogallus|Lyrurus tetrix|Tetrastes bonasia|Crex crex|Coturnix coturnix|Nucifraga caryocatactes|Cinclus cinclus
Corvus corax|Panurus biarmicus|Luscinia megarhynchos|Cuculus canorus|Oriolus oriolus|Jynx torquilla|Dryocopus martius
Tichodroma muraria|Remiz pendulinus|Locustella luscinioides|Acrocephalus arundinaceus|Emberiza hortulana""".replace("\n", "|").split("|")

# Must be European but not Czech: Mediterranean, Atlantic and Arctic birds, and one Iberian and one Corsican speciality.
SENTINEL_EUROPE_ONLY = """Curruca melanocephala|Curruca undata|Curruca conspicillata|Ichthyaetus audouinii|Sturnus unicolor
Cyanopica cooki|Aquila adalberti|Fratercula arctica|Alca torda|Bubo scandiacus|Falco rusticolus|Somateria spectabilis
Perisoreus infaustus|Pinicola enucleator|Lagopus muta|Uria lomvia|Oenanthe leucura|Sitta whiteheadi
Pterocles alchata|Chersophilus duponti|Rissa tridactyla|Morus bassanus|Surnia ulula|Calidris maritima""".replace("\n", "|").split("|")

# Must NOT be in the Dex: American and Asian vagrants, tropical birds, and things that are not birds at all.
SENTINEL_OUT = """Setophaga striata|Setophaga coronata|Setophaga petechia|Cyanocitta cristata|Turdus migratorius|Cardinalis cardinalis
Poecile atricapillus|Zonotrichia leucophrys|Haemorhous mexicanus|Calypte anna|Ramphastos toco|Phoenicurus moussieri
Dog|Human vocal|Siren|Engine|Canis lupus|Pseudacris crucifer|Gryllus pennsylvanicus|Apis mellifera""".replace("\n", "|").split("|")


# ---------------------------------------------------------------------------------------------------------------------
# Code
# ---------------------------------------------------------------------------------------------------------------------


@dataclass(frozen=True)
class Label:
    index: int
    sci: str
    english: str
    czech_raw: str

    @property
    def genus(self) -> str:
        return self.sci.split(" ")[0]

    @property
    def epithet(self) -> str:
        return self.sci.split(" ")[-1]


@dataclass(frozen=True)
class Taxon:
    row: int
    common: str
    sci: str
    code: str
    wiki: str


def die(message: str) -> None:
    print(f"build-species: {message}", file=sys.stderr)
    sys.exit(1)


def read_labels() -> list[Label]:
    en = LABELS_EN.read_text(encoding="utf-8").split("\n")
    cs = LABELS_CS.read_text(encoding="utf-8").split("\n")
    # The files have no final newline, but tolerate one.
    if en and en[-1] == "":
        en.pop()
    if cs and cs[-1] == "":
        cs.pop()
    if len(en) != N_LABELS or len(cs) != N_LABELS:
        die(f"expected {N_LABELS} labels in both files, found {len(en)} and {len(cs)}")
    labels: list[Label] = []
    seen: set[str] = set()
    for index, (e, c) in enumerate(zip(en, cs)):
        sci, sep, english = e.partition("_")
        csci, _, czech = c.partition("_")
        if not sep or sci != csci:
            die(f"label {index} is malformed or the two files disagree: {e!r} / {c!r}")
        if sci in seen:
            die(f"scientific name {sci!r} appears twice")
        seen.add(sci)
        labels.append(Label(index, sci, english.strip(), czech.strip()))
    return labels


def is_non_bird(label: Label) -> bool:
    if label.sci in SOUND_CLASSES and label.sci == label.english:
        return True
    return label.genus in NON_BIRD_GENERA


def read_taxonomy(wingdex_dir: Path) -> list[Taxon]:
    path = wingdex_dir / "src" / "lib" / "taxonomy.json"
    if not path.exists():
        die(
            f"{path} not found. Clone https://github.com/jlian/wingdex at commit {WINGDEX_COMMIT} and pass "
            "--wingdex DIR (or set WINGDEX_DIR)."
        )
    rows = json.loads(path.read_text(encoding="utf-8"))
    if len(rows) != N_TAXA:
        die(f"the WingDex taxonomy has {len(rows)} rows, expected {N_TAXA} (the classifier has {N_TAXA} species rows plus a probe row)")
    return [Taxon(i, r[0], r[1], r[2], r[3] if len(r) > 3 and r[3] else r[1]) for i, r in enumerate(rows)]


def norm_name(text: str) -> str:
    """Comparable form of an English name: no accents, grey = gray, no punctuation."""
    text = unicodedata.normalize("NFKD", text).lower()
    text = "".join(c for c in text if not unicodedata.combining(c))
    text = text.replace("gray", "grey").replace("'s", "s").replace("'", "").replace("-", " ")
    text = re.sub(r"[^a-z0-9 ]", "", text)
    return re.sub(r"\s+", " ", text).strip()


# ----- geo model -----


def geo_scores(model: Path, points: list[tuple[str, float, float]]) -> tuple[np.ndarray, np.ndarray]:
    """Runs the location model for every week at every point.

    Returns (peak, weekly_mean): peak[p, label] is the best week at point p, weekly_mean[w, label] is the average over
    all points in week w. Scores are rounded to 5 decimals so that the result does not depend on the machine.
    """
    from ai_edge_litert.interpreter import Interpreter  # imported late so --help works without it

    interpreter = Interpreter(model_path=str(model), num_threads=2)
    inp = interpreter.get_input_details()[0]
    out = interpreter.get_output_details()[0]
    interpreter.resize_tensor_input(inp["index"], [len(WEEKS), 3])
    interpreter.allocate_tensors()
    peak = np.zeros((len(points), N_LABELS), dtype=np.float32)
    weekly_sum = np.zeros((len(WEEKS), N_LABELS), dtype=np.float64)
    for p, (_, lat, lon) in enumerate(points):
        batch = np.array([[lat, lon, week] for week in WEEKS], dtype=np.float32)
        interpreter.set_tensor(inp["index"], batch)
        interpreter.invoke()
        scores = np.round(interpreter.get_tensor(out["index"]).astype(np.float32), 5)
        if scores.shape != (len(WEEKS), N_LABELS):
            die(f"unexpected geo model output shape {scores.shape}")
        peak[p] = scores.max(axis=0)
        weekly_sum += scores
    return peak, (weekly_sum / len(points)).astype(np.float32)


@dataclass(frozen=True)
class GeoStats:
    emax: np.ndarray  # best score over all Europe points and weeks
    b03: np.ndarray  # number of Europe points that reach 0.03
    cz_pk: np.ndarray  # best week of the average over the Czech points
    cz_point_max: np.ndarray  # best score at any Czech point and week


def compute_geo() -> GeoStats:
    if not GEO_MODEL.exists():
        die(f"{GEO_MODEL} not found. Run `node scripts/fetch-models.mjs` first.")
    eu_peak, _ = geo_scores(GEO_MODEL, EUROPE_POINTS)
    cz_peak, cz_weekly = geo_scores(GEO_MODEL, CZECHIA_POINTS)
    return GeoStats(
        emax=eu_peak.max(axis=0),
        b03=(eu_peak >= 0.03).sum(axis=0),
        cz_pk=cz_weekly.max(axis=0),
        cz_point_max=cz_peak.max(axis=0),
    )


def passes_europe_rule(emax: float, b03: int) -> bool:
    return any(emax >= min_emax and b03 >= min_b03 for min_emax, min_b03 in EUROPE_RULE)


def decide(label: Label, geo: GeoStats) -> tuple[bool, bool]:
    """(in Europe, in Czechia) for a bird: the threshold rules first, then the override tables."""
    i = label.index
    in_europe = passes_europe_rule(float(geo.emax[i]), int(geo.b03[i]))
    if label.sci in EUROPE_EXCLUDE:
        in_europe = False
    if label.sci in EUROPE_INCLUDE:
        in_europe = True
    in_czechia = in_europe and float(geo.cz_point_max[i]) >= CZECHIA_MIN_POINT_SCORE
    if label.sci in CZECHIA_EXCLUDE:
        in_czechia = False
    if label.sci in CZECHIA_INCLUDE:
        in_czechia = in_europe
    return in_europe, in_czechia


def check_tables(labels: list[Label], geo: GeoStats) -> list[str]:
    """Keeps the override tables honest: every entry must name a BirdNET bird and must change the outcome."""
    problems: list[str] = []
    by_sci = {label.sci: label for label in labels}
    tables = {"EUROPE_EXCLUDE": EUROPE_EXCLUDE, "EUROPE_INCLUDE": EUROPE_INCLUDE, "CZECHIA_EXCLUDE": CZECHIA_EXCLUDE, "CZECHIA_INCLUDE": CZECHIA_INCLUDE}
    for name, table in tables.items():
        for sci in table:
            label = by_sci.get(sci)
            if label is None or is_non_bird(label):
                problems.append(f"{name} names {sci!r}, which is not a BirdNET bird")
                continue
            i = label.index
            rule = passes_europe_rule(float(geo.emax[i]), int(geo.b03[i]))
            czech_score = float(geo.cz_point_max[i]) >= CZECHIA_MIN_POINT_SCORE
            europe_final = decide(label, geo)[0]
            # A score within 10 percent below the Czech threshold keeps its exclusion: another machine may round it up.
            near_czech = float(geo.cz_point_max[i]) >= 0.9 * CZECHIA_MIN_POINT_SCORE
            redundant = {
                "EUROPE_EXCLUDE": not rule,
                "EUROPE_INCLUDE": rule,
                "CZECHIA_EXCLUDE": not (europe_final and near_czech),
                "CZECHIA_INCLUDE": europe_final and czech_score,
            }[name]
            if redundant:
                problems.append(f"{name} has {sci!r}, but the rules already give that answer: remove the entry")
    for sci, tier in RARITY_OVERRIDES.items():
        label = by_sci.get(sci)
        if label is None or is_non_bird(label):
            problems.append(f"RARITY_OVERRIDES names {sci!r}, which is not a BirdNET bird")
            continue
        in_europe, in_czechia = decide(label, geo)
        if not in_czechia:
            problems.append(f"RARITY_OVERRIDES has {sci!r}, which is not a Czech bird in the Dex (Europe-only birds are epic or legendary by range)")
        elif tier not in {name for _, name in RARITY_PK} | {"legendary"}:
            problems.append(f"RARITY_OVERRIDES gives {sci!r} the unknown tier {tier!r}")
        elif measured_rarity(True, float(geo.cz_pk[label.index]), int(geo.b03[label.index])) == tier:
            problems.append(f"RARITY_OVERRIDES has {sci!r}, but the numbers already give {tier!r}: remove the entry")
    for sci, name in CZECH_NAME_OVERRIDES.items():
        label = by_sci.get(sci)
        if label is None or is_non_bird(label):
            problems.append(f"CZECH_NAME_OVERRIDES names {sci!r}, which is not a BirdNET bird")
        elif name[:1].upper() + name[1:] == label.czech_raw[:1].upper() + label.czech_raw[1:]:
            problems.append(f"CZECH_NAME_OVERRIDES has {sci!r}, but BirdNET already says {name!r}: remove the entry")
    return problems


def measured_rarity(in_czechia: bool, pk: float, b03: int) -> str:
    """The tier the numbers give, before RARITY_OVERRIDES."""
    if not in_czechia:
        return "epic" if b03 >= EUROPE_ONLY_EPIC_MIN_POINTS else "legendary"
    for minimum, tier in RARITY_PK:
        if pk >= minimum:
            return tier
    return "legendary"


def rarity_for(sci: str, in_czechia: bool, pk: float, b03: int) -> str:
    return RARITY_OVERRIDES.get(sci) or measured_rarity(in_czechia, pk, b03)


# ----- WingDex matching -----


class Unresolved(Exception):
    pass


def resolve_taxon(label: Label, taxa: list[Taxon], by_sci: dict[str, int], by_common: dict[str, list[int]]) -> tuple[Taxon | None, str]:
    """Finds the WingDex taxon (WingCLIP row) of a BirdNET bird. Returns (taxon or None, how it was found)."""
    if label.sci in WINGCLIP_PINS:
        target = WINGCLIP_PINS[label.sci]
        if target is None:
            return None, "pinned: no WingCLIP row"
        row = by_sci.get(target.lower())
        if row is None:
            die(f"WINGCLIP_PINS maps {label.sci} to {target}, which is not in the WingDex taxonomy")
        return taxa[row], "pinned"
    row = by_sci.get(label.sci.lower())
    if row is not None:
        if norm_name(taxa[row].common) == norm_name(label.english):
            return taxa[row], "same scientific and English name"
        raise Unresolved(f"same scientific name but WingDex calls it {taxa[row].common!r} ({taxa[row].sci})")
    rows = [r for r in by_common.get(norm_name(label.english), []) if taxa[r].sci.split(" ")[-1] == label.epithet]
    if len(rows) == 1:
        return taxa[rows[0]], "genus moved (same species name and English name)"
    raise Unresolved("no WingDex taxon with this scientific or English name")


def czech_name(label: Label) -> str | None:
    override = CZECH_NAME_OVERRIDES.get(label.sci)
    name = override if override is not None else (None if label.czech_raw == label.english else label.czech_raw)
    if not name:
        return None
    return name[0].upper() + name[1:]


def species_id(sci: str) -> str:
    return sci.lower().replace(" ", "-")


# ----- the build -----


def build(args: argparse.Namespace) -> int:
    labels = read_labels()
    taxa = read_taxonomy(Path(args.wingdex))
    by_sci = {t.sci.lower(): t.row for t in taxa}
    by_common: dict[str, list[int]] = defaultdict(list)
    for t in taxa:
        by_common[norm_name(t.common)].append(t.row)

    non_bird = [label for label in labels if is_non_bird(label)]
    print(f"labels: {len(labels)}, not birds: {len(non_bird)}, birds: {len(labels) - len(non_bird)}")
    crosscheck_non_birds(labels, non_bird, Path(args.analyzer_codes))

    geo = compute_geo()

    problems: list[str] = []
    selected: list[tuple[Label, bool]] = []  # (label, in_czechia)
    for label in labels:
        if is_non_bird(label):
            continue
        in_europe, in_czechia = decide(label, geo)
        if in_europe:
            selected.append((label, in_czechia))
    problems += check_tables(labels, geo)

    # Match with WingDex, family, order.
    records: list[dict] = []
    anchored: Counter[int] = Counter()
    unresolved: list[str] = []
    for label, in_czechia in selected:
        try:
            taxon, how = resolve_taxon(label, taxa, by_sci, by_common)
        except Unresolved as reason:
            unresolved.append(f"  {label.sci} ({label.english}): {reason}")
            continue
        family = GENUS_FAMILY.get(label.genus)
        if family is None:
            problems.append(f"no family for genus {label.genus} ({label.sci})")
        if taxon is not None:
            order = (taxon.row, 0)
        else:
            anchor = ORDER_ANCHORS.get(label.sci)
            if anchor is None or anchor.lower() not in by_sci:
                unresolved.append(f"  {label.sci} ({label.english}): no WingCLIP row, so it needs an ORDER_ANCHORS entry")
                continue
            anchored[by_sci[anchor.lower()]] += 1
            order = (by_sci[anchor.lower()], anchored[by_sci[anchor.lower()]])
        records.append({
            "label": label,
            "taxon": taxon,
            "how": how,
            "family": family,
            "order": order,
            "in_czechia": in_czechia,
        })
    if unresolved:
        print("Unresolved WingDex matches (add a WINGCLIP_PINS / ORDER_ANCHORS entry):", file=sys.stderr)
        print("\n".join(unresolved), file=sys.stderr)
    if problems or unresolved:
        for problem in problems:
            print(f"build-species: {problem}", file=sys.stderr)
        if not args.audit:
            return 1

    records.sort(key=lambda r: r["order"])
    species: list[dict] = []
    used_rows: dict[int, str] = {}
    for number, rec in enumerate(records, start=1):
        label: Label = rec["label"]
        taxon: Taxon | None = rec["taxon"]
        i = label.index
        if taxon is not None:
            if taxon.row in used_rows:
                die(f"WingCLIP row {taxon.row} ({taxon.sci}) is claimed by both {used_rows[taxon.row]} and {label.sci}")
            used_rows[taxon.row] = label.sci
        species.append({
            "id": species_id(label.sci),
            "dexNumber": number,
            "scientificName": label.sci,
            "czechName": czech_name(label),
            "englishName": label.english,
            "family": rec["family"],
            "inCzechia": rec["in_czechia"],
            "inEurope": True,
            "rarity": rarity_for(label.sci, rec["in_czechia"], float(geo.cz_pk[i]), int(geo.b03[i])),
            "birdnetIndex": i,
            "wingclipIndex": taxon.row if taxon is not None else None,
            "wikiTitle": taxon.wiki if taxon is not None else label.sci,
        })

    failures = run_sentinels(species)
    failures += validate(species, labels)
    if args.verify_models:
        failures += verify_birdnet(species)
        failures += verify_wingclip(species, taxa)
    report = make_report(species, records, geo, labels)
    if args.report:
        Path(args.report).write_text(report, encoding="utf-8")
    if args.audit:
        print(report)
    summary(species)
    if failures:
        print("build-species: checks failed:", file=sys.stderr)
        print("\n".join(f"  {f}" for f in failures), file=sys.stderr)
        if not args.audit:
            return 1
    if args.no_write or args.audit:
        return 0 if not (failures or unresolved or problems) else 1
    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    text = "[\n" + ",\n".join(json.dumps(s, ensure_ascii=False, separators=(",", ":")) for s in species) + "\n]\n"
    OUT_FILE.write_text(text, encoding="utf-8")
    print(f"wrote {OUT_FILE.relative_to(ROOT)}: {len(species)} species, {len(text.encode('utf-8')) / 1024:.1f} KiB")
    return 0


def verify_birdnet(species: list[dict]) -> list[str]:
    """Runs BirdNET on the 3 second recording of a Lesser Redpoll in tests/fixtures/audio.

    The loudest output must be the position that species.json gives to Acanthis cabaret (the label order equals the
    model output order). Needs ai_edge_litert and public/models/birdnet-v2.4-fp16.tflite.
    """
    import wave

    from ai_edge_litert.interpreter import Interpreter

    model = ROOT / "public" / "models" / "birdnet-v2.4-fp16.tflite"
    if not model.exists():
        return [f"--verify-models needs {model.name} in public/models"]
    with wave.open(str(ROOT / "tests" / "fixtures" / "audio" / "birdnet-demo-sample.wav")) as wav:
        samples = np.frombuffer(wav.readframes(wav.getnframes()), dtype=np.int16).astype(np.float32) / 32768.0
        if wav.getframerate() != 48000 or wav.getnchannels() != 1:
            return ["the demo recording is not 48 kHz mono"]
    window = np.zeros((1, 144000), dtype=np.float32)
    window[0, : min(144000, samples.size)] = samples[:144000]
    interpreter = Interpreter(model_path=str(model))
    interpreter.allocate_tensors()
    interpreter.set_tensor(interpreter.get_input_details()[0]["index"], window)
    interpreter.invoke()
    logits = interpreter.get_tensor(interpreter.get_output_details()[0]["index"])[0]
    best = int(np.argmax(logits))
    redpoll = next(s for s in species if s["scientificName"] == "Acanthis cabaret")
    score = 1 / (1 + float(np.exp(-logits[best])))
    print(f"BirdNET check: the Lesser Redpoll recording scores {score:.2f} at position {best}; species.json says {redpoll['birdnetIndex']}")
    if best != redpoll["birdnetIndex"] or score < 0.5:
        return [f"BirdNET puts the redpoll recording at position {best} ({score:.2f}), species.json says {redpoll['birdnetIndex']}"]
    return []


def verify_wingclip(species: list[dict], taxa: list[Taxon]) -> list[str]:
    """Runs the real WingCLIP model on the fixture photos and checks that its row numbers are the ones in species.json.

    The photos in tests/fixtures/photos/truth.json say what is on each picture. The model must put the right row among
    its top 3 for most of them, and that row must be the wingclipIndex of the matching Dex bird. If the rows were
    shifted by one, or in another order than the WingDex taxonomy, this fails. Needs onnxruntime, pillow and the models.
    """
    import onnxruntime as ort
    from PIL import Image

    models = ROOT / "public" / "models"
    files = [models / "wingclip_visual_int8.onnx", models / "wingclip_visual_int8.data", models / "text_classifier_int8.bin"]
    missing = [f.name for f in files if not f.exists()]
    if missing:
        return [f"--verify-models needs {', '.join(missing)} in public/models"]
    raw = np.fromfile(files[2], dtype=np.uint8)
    rows = raw.size // 772  # 768 int8 values plus one float32 scale per row
    if rows != N_TAXA + 1 or rows * 772 != raw.size:
        return [f"text_classifier_int8.bin has {raw.size / 772:.2f} rows, expected {N_TAXA + 1} (species plus the probe row)"]
    matrix = raw[: rows * 768].view(np.int8).reshape(rows, 768).astype(np.float32) * raw[rows * 768 :].view(np.float32)[:, None]
    classifier = matrix[:N_TAXA]  # the last row is the bird / not-bird probe, never a species
    session = ort.InferenceSession(str(files[0]), providers=["CPUExecutionProvider"])
    input_name = session.get_inputs()[0].name
    mean = np.array([0.48145466, 0.4578275, 0.40821073], dtype=np.float32)
    std = np.array([0.26862954, 0.26130258, 0.27577711], dtype=np.float32)
    by_row = {s["wingclipIndex"]: s for s in species if s["wingclipIndex"] is not None}
    by_common = {t.common: t.row for t in taxa}
    truth = json.loads((ROOT / "tests" / "fixtures" / "photos" / "truth.json").read_text(encoding="utf-8"))
    hits, tried, failures = 0, 0, []
    for name, expected in truth.items():
        if expected is None or expected not in by_common:
            continue
        image = Image.open(ROOT / "tests" / "fixtures" / "photos" / name).convert("RGB")  # same steps as src/lib/clip-preprocess.ts
        scale = 248 / min(image.size)
        image = image.resize((max(248, round(image.width * scale)), max(248, round(image.height * scale))), Image.BICUBIC)
        left, top = (image.width - 224) // 2, (image.height - 224) // 2
        pixels = (np.asarray(image.crop((left, top, left + 224, top + 224)), dtype=np.float32) / 255.0 - mean) / std
        embedding = session.run(None, {input_name: pixels.transpose(2, 0, 1)[None].astype(np.float32)})[0][0]
        top3 = np.argsort(-(classifier @ (embedding / np.linalg.norm(embedding))))[:3].tolist()
        row = by_common[expected]
        hit = row in top3
        tried += 1
        hits += hit
        dex = by_row.get(row)
        print(f"  {expected:22s} row {row:5d}: {'in the top 3' if hit else 'NOT in the top 3'}, "
              f"top 3 = {[taxa[r].common for r in top3]}, Dex bird = {dex['id'] if dex else 'none (not European)'}")
        if hit and dex is not None and dex["wingclipIndex"] != row:
            failures.append(f"{expected}: row {row} is not the wingclipIndex of {dex['id']}")
    print(f"WingCLIP check: the right row is in the model's top 3 for {hits} of {tried} photos")
    if hits < max(3, tried - 3):
        failures.append(f"only {hits} of {tried} fixture photos have the right row in the top 3: the row numbers may be shifted")
    return failures


def crosscheck_non_birds(labels: list[Label], non_bird: list[Label], codes_path: Path) -> None:
    """If BirdNET-Analyzer's eBird code table is around, its non-bird codes ("t-...", sound classes) must be our list."""
    if not codes_path.exists():
        print(f"(no {codes_path.name}: skipping the non-bird cross-check)")
        return
    codes = json.loads(codes_path.read_text(encoding="utf-8"))
    sound_codes = {"dogdog", "engine", "envrnm", "frwrks", "gungun", "humnov", "humvoc", "humwhi", "nocall", "powtoo", "siren1"}
    expected = {
        f"{label.sci}_{label.english}"
        for label in labels
        if codes.get(f"{label.sci}_{label.english}", "").startswith("t-") or codes.get(f"{label.sci}_{label.english}") in sound_codes
    }
    ours = {f"{label.sci}_{label.english}" for label in non_bird}
    if expected != ours:
        die(f"the non-bird list differs from the eBird code table: only ours {sorted(ours - expected)[:5]}, only theirs {sorted(expected - ours)[:5]}")
    print(f"non-bird list agrees with the eBird code table ({len(ours)} labels)")


def run_sentinels(species: list[dict]) -> list[str]:
    by_sci = {s["scientificName"]: s for s in species}
    failures: list[str] = []
    for sci in SENTINEL_CZECH_COMMON:
        s = by_sci.get(sci)
        if s is None or not s["inCzechia"] or s["rarity"] != "common":
            failures.append(f"sentinel {sci}: expected a common Czech bird, got {s and (s['inCzechia'], s['rarity'])}")
    for sci in SENTINEL_CZECHIA:
        s = by_sci.get(sci)
        if s is None or not s["inCzechia"]:
            failures.append(f"sentinel {sci}: expected a Czech bird, got {s and s['inCzechia']}")
    for sci in SENTINEL_EUROPE_ONLY:
        s = by_sci.get(sci)
        if s is None or s["inCzechia"] or s["rarity"] not in ("epic", "legendary"):
            failures.append(f"sentinel {sci}: expected a Europe-only epic or legendary bird, got {s and (s['inCzechia'], s['rarity'])}")
    for sci in SENTINEL_OUT:
        if sci in by_sci:
            failures.append(f"sentinel {sci}: must not be in the Dex")
    return failures


def validate(species: list[dict], labels: list[Label]) -> list[str]:
    failures: list[str] = []
    ids = [s["id"] for s in species]
    if len(set(ids)) != len(ids):
        failures.append("ids are not unique")
    if [s["dexNumber"] for s in species] != list(range(1, len(species) + 1)):
        failures.append("dexNumbers are not 1..N")
    names = [s["czechName"] for s in species if s["czechName"]]
    if len(set(names)) != len(names):
        failures.append("two birds have the same Czech name")
    by_index = {label.index: label for label in labels}
    for s in species:
        label = by_index[s["birdnetIndex"]]
        if label.sci != s["scientificName"] or label.english != s["englishName"]:
            failures.append(f"{s['id']}: birdnetIndex {s['birdnetIndex']} points at {label.sci}")
        if s["inCzechia"] and not s["inEurope"]:
            failures.append(f"{s['id']}: Czech but not European")
        if s["family"] is None:
            failures.append(f"{s['id']}: no family")
    wing = [s["wingclipIndex"] for s in species if s["wingclipIndex"] is not None]
    if len(set(wing)) != len(wing):
        failures.append("two birds share a WingCLIP row")
    return failures


def summary(species: list[dict]) -> None:
    czech = [s for s in species if s["inCzechia"]]
    print(f"species: {len(species)} in Europe, {len(czech)} in Czechia, {len(species) - len(czech)} only in Europe")
    print("rarity (Czechia):", dict(Counter(s["rarity"] for s in czech)))
    print("rarity (Europe only):", dict(Counter(s["rarity"] for s in species if not s["inCzechia"])))
    print("Czech name missing:", sum(1 for s in species if s["czechName"] is None), "| no WingCLIP row:", sum(1 for s in species if s["wingclipIndex"] is None))


def make_report(species: list[dict], records: list[dict], geo: GeoStats, labels: list[Label]) -> str:
    lines: list[str] = []
    add = lines.append
    add("# Species build report (not committed)")
    add("")
    add("## How each bird was matched with WingDex (everything except an exact match)")
    for rec in records:
        if rec["how"] != "same scientific and English name":
            label: Label = rec["label"]
            taxon: Taxon | None = rec["taxon"]
            target = f"{taxon.sci} / {taxon.common} [row {taxon.row}]" if taxon else "none"
            add(f"  {label.sci:30s} {label.english:28s} -> {target:60s} ({rec['how']})")
    add("")
    add("## Closest calls for the Europe rule (within 20 percent of a threshold)")
    chosen = {s["birdnetIndex"] for s in species}
    for label in labels:
        if is_non_bird(label):
            continue
        i = label.index
        emax, b03 = float(geo.emax[i]), int(geo.b03[i])
        near = any(0.8 * lo <= emax <= 1.25 * lo for lo, _ in EUROPE_RULE if lo > 0)
        if near and emax >= 0.05:
            add(f"  {'IN ' if i in chosen else 'OUT'} {label.sci:30s} {label.english:28s} Emax={emax:.3f} B03={b03}")
    add("")
    add("## Closest calls for the Czech threshold (point score 0.003 to 0.008, in Europe)")
    for label in labels:
        i = label.index
        if i in chosen and 0.003 <= float(geo.cz_point_max[i]) <= 0.008:
            s = next(x for x in species if x["birdnetIndex"] == i)
            add(f"  {'CZ ' if s['inCzechia'] else 'no '} {label.sci:30s} {label.english:28s} pointmax={float(geo.cz_point_max[i]):.4f}")
    add("")
    add("## Czech birds by rarity (pk = best week of the Czech average)")
    for tier in ("common", "uncommon", "rare", "epic", "legendary"):
        members = [s for s in species if s["inCzechia"] and s["rarity"] == tier]
        add(f"### {tier} ({len(members)})")
        for s in sorted(members, key=lambda x: -float(geo.cz_pk[x["birdnetIndex"]])):
            add(f"  pk={float(geo.cz_pk[s['birdnetIndex']]):.3f} {s['scientificName']:30s} {s['czechName'] or '-'} / {s['englishName']}")
    add("")
    add("## Europe-only birds (B03 = Europe points that reach 0.03)")
    for tier in ("epic", "legendary"):
        members = [s for s in species if not s["inCzechia"] and s["rarity"] == tier]
        add(f"### {tier} ({len(members)})")
        for s in sorted(members, key=lambda x: -int(geo.b03[x["birdnetIndex"]])):
            add(f"  B03={int(geo.b03[s['birdnetIndex']]):3d} Emax={float(geo.emax[s['birdnetIndex']]):.2f} {s['scientificName']:30s} {s['czechName'] or '-'} / {s['englishName']}")
    return "\n".join(lines) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description="Build public/data/species.json")
    parser.add_argument("--wingdex", default=os.environ.get("WINGDEX_DIR", DEFAULT_WINGDEX), help="WingDex checkout (default %(default)s)")
    parser.add_argument("--analyzer-codes", default=os.environ.get("ANALYZER_CODES", DEFAULT_ANALYZER_CODES), help="optional eBird code table of BirdNET-Analyzer")
    parser.add_argument("--report", help="also write a review report to this file")
    parser.add_argument("--no-write", action="store_true", help="do everything but write species.json")
    parser.add_argument("--audit", action="store_true", help="print the review report and carry on even when something is unresolved")
    parser.add_argument("--verify-models", action="store_true", help="also run BirdNET on the test recording and WingCLIP on the test photos to check the index numbers (needs the models)")
    return build(parser.parse_args())


if __name__ == "__main__":
    sys.exit(main())
