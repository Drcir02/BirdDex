// Shared data types. Every part of the app (data, database, identification, screens) agrees on these.
// Change them only when you must, and then update every user of the changed type in the same go.

export type Rarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary'

/** One bird in the Dex. Built by scripts/build-species.py into public/data/species.json. */
export interface Species {
  /** Stable id: the scientific name in lower case with spaces turned into dashes, for example "parus-major". */
  id: string
  /** The number shown in the Dex as #001. It follows taxonomic order, so related birds sit together. */
  dexNumber: number
  scientificName: string
  /** Czech common name from BirdNET's Czech labels. Null when BirdNET has none: the UI then shows the scientific name alone. */
  czechName: string | null
  /** English common name. Used for search and photo lookups. It is never the main name in the UI. */
  englishName: string
  family: string | null
  inCzechia: boolean
  inEurope: boolean
  rarity: Rarity
  /** Position of this species in BirdNET V2.4's 6522 outputs. */
  birdnetIndex: number
  /** Row of this species in the WingCLIP text classifier. Null when WingCLIP does not know the species. */
  wingclipIndex: number | null
  /** Wikipedia article title for fetching a reference photo at run time. */
  wikiTitle: string | null
  /** When and where to find the bird (built by scripts/build-species-info.py). Missing in a Dex file from before it existed. */
  info?: SpeciesInfo
}

export type PlaceKey = 'water' | 'river' | 'coast' | 'sea' | 'forest' | 'woods' | 'scrub' | 'fields' | 'town' | 'rocks' | 'steppe'
export type DayPart = 'day' | 'dawn' | 'dawn_dusk' | 'dusk' | 'night'
/** 1 lets you come close, 2 is wary, 3 is shy or far away and needs a zoom. */
export type Shyness = 1 | 2 | 3

export interface SpeciesInfo {
  /** Twelve digits, January to December: 0 not there, 1 a few, 2 likely, 3 most likely. For a bird that is not in Czechia: in Europe. */
  months: string
  place: PlaceKey
  shy: Shyness
  /** An estimate by bird family; EltonTraits tells which birds are nocturnal. */
  day: DayPart
  /** Which group text of the app ("dex.info.tips.<tip>") belongs to the bird. */
  tip: string
  /** Birds that are not in Czechia only: ISO codes of the European countries where the bird lives, best first. */
  countries?: string[]
  /** The least and the most BirdPoints a bird of this species can get (data/bp-ranges.csv). */
  bp?: [number, number]
}

export type CatchMethod = 'sound' | 'photo' | 'live'

export interface Candidate {
  speciesId: string
  /** 0 to 1. For sound it is BirdNET's score. For photos it is the calibrated probability. */
  confidence: number
}

export interface GeoPoint {
  lat: number
  lon: number
  accuracyM?: number
}

/** A confirmed catch. The Dex shows a species as caught when at least one catch exists for it. */
export interface CatchRecord {
  id: string
  speciesId: string
  /** Milliseconds since 1970. */
  caughtAt: number
  method: CatchMethod
  confidence: number
  location?: GeoPoint
  /** Place name looked up when online, for example "Praha". */
  placeName?: string
  /** Id of the saved photo or audio clip in the media table. */
  mediaId?: string
  note?: string
  /** BirdPoints of this bird (src/domain/birdPoints.ts). Missing only until the first start after BP came. */
  bp?: number
  /** Where the quality alone put the bird in its range, before luck. */
  bpBase?: number
  /** The quality of the catch, 0 to 1, and the luck roll as a share of the range: together they recalculate the BP after a rebalance. */
  bpQ?: number
  bpLuck?: number
  /** The range of the bird (least and most BP) that the BP was worked out against. */
  bpRange?: [number, number]
  /** The five scores that made the quality: confidence, clarity, season, time of day, way of catching (0 to 1). */
  bpFactors?: number[]
  /** The BP was worked out afterwards for a catch from before BP existed, so its clarity is a guess. */
  bpLegacy?: boolean
}

export interface MediaRecord {
  id: string
  kind: 'image' | 'audio'
  mime: string
  blob: Blob
  /** Audio clips only. */
  durationS?: number
  createdAt: number
}

/** What the scan screens hand to the result screen, until the user confirms or drops it. Lives in memory only. */
export interface PendingIdentification {
  method: CatchMethod
  /** Up to three guesses, strongest first. */
  candidates: Candidate[]
  /** The picture or audio clip to save if the user confirms the catch. */
  media?: { kind: 'image' | 'audio'; blob: Blob; mime: string; durationS?: number }
  location?: GeoPoint
  /**
   * Photo and live camera only: how sure the engine is that the picture shows a bird at all, and how sure the plain model is
   * of its best species outside the Dex (a look-alike we do not have). Both feed the Catch rules (thresholds.ts); a guess
   * that scores high but comes from an unclear picture or from a possibly foreign bird is not offered for catching.
   */
  pBird?: number
  outsideDexTop?: number
  /** Live camera: the scanner caught it by itself (it was sure enough); the result screen then saves the catch at once. */
  autoCatch?: boolean
  createdAt: number
}

export type Sensitivity = 'strict' | 'normal' | 'easy'

export interface ModelProgress {
  modelId: string
  stage: 'downloading' | 'preparing' | 'ready'
  loadedBytes: number
  totalBytes: number
}
