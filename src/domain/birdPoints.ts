// BirdPoints (BP): the number every caught bird gets, like CP in Pokémon GO. The design and the reasons are in
// docs/notes/birdpoints-design.md; every number to balance is in BP_CONFIG and in data/bp-ranges.csv (the range of each bird).
//
//   Q     = the weighted quality of the catch (0 to 1): how sure the app was, how clearly, in the right season and hour, and how
//           the bird was caught
//   start = min + headroom x (max - min) x Q^curve       (the top tenth of the range is left for luck)
//   BP    = clamp(start + (max - min) x luck, min, max)  (luck is a little below or above zero, two dice averaged)
//
// Pure functions of their inputs (the dice are passed in), so every rule is unit-tested without a browser.

import type { CatchMethod, DayPart, Rarity, Species } from './types'

/** The least and the most BP a bird can get. */
export type BpRange = readonly [min: number, max: number]

export const BP_CONFIG = {
  /** What each factor counts for in Q. The five add up to 1. */
  weights: { confidence: 0.5, clarity: 0.1, season: 0.1, timeOfDay: 0.1, way: 0.2 },
  /** Q is raised to this power: above 1 makes the last bit of quality count for more. */
  curve: 1.4,
  /** The share of the range a perfect catch reaches without luck. 0.9 leaves the top tenth to luck. */
  headroom: 0.9,
  /** Luck, as a share of the range: from -9 % to +13 %. Two dice are averaged, so the ends are rare. */
  luckDown: 0.09,
  luckUp: 0.13,
  /** Confidence below this scores 0, 100 % scores 1. */
  confidenceFloor: 0.5,
  /** A lead over the next guess of this much (or more) scores 1. */
  clarityFull: 0.5,
  /** The score of the month's level in the bird's month strip: 0 not there, 1 a few, 2 likely, 3 most likely. */
  seasonScores: [0.1, 0.35, 0.7, 1] as readonly number[],
  /** The hour is right (1), within `closeHours` of the right time (closeScore), or wrong (farScore). */
  closeScore: 0.7,
  farScore: 0.5,
  closeHours: 2,
  /** How the bird was caught. A photo is worth `photoFreshScore` when it was just taken and falls to `photoStaleScore` over a week. */
  liveScore: 1,
  soundScore: 0.9,
  photoFreshScore: 0.8,
  photoStaleScore: 0.4,
  photoFreshMs: 3_600_000,
  photoStaleMs: 7 * 86_400_000,
  /** What stands in for a factor that an old catch did not save, or a bird without info. */
  neutral: { clarity: 0.6, season: 0.7, timeOfDay: 0.7 },
}

/** The range of a rarity at the size of a mallard. Only used for a bird that has no range in species.json. */
export const TIER_RANGES: Record<Rarity, BpRange> = {
  common: [50, 750],
  uncommon: [300, 1000],
  rare: [650, 1400],
  epic: [1100, 1900],
  legendary: [1600, 2600],
}

/** The five scores (0 to 1) that make Q, in the order of BP_CONFIG.weights. */
export interface BpFactors {
  confidence: number
  clarity: number
  season: number
  timeOfDay: number
  way: number
}

export const FACTOR_ORDER = ['confidence', 'clarity', 'season', 'timeOfDay', 'way'] as const satisfies readonly (keyof BpFactors)[]

export interface BirdPoints {
  /** The result. */
  bp: number
  /** Where the quality alone puts the bird in its range, before luck. */
  base: number
  /** 0 to 1. */
  quality: number
  /** The luck roll as a share of the range, about -0.09 to 0.13. */
  luck: number
  factors: BpFactors
  /** The range of the bird that the BP was worked out against. */
  range: BpRange
}

const clamp = (value: number, low: number, high: number): number => Math.min(high, Math.max(low, value))
const clamp01 = (value: number): number => (Number.isFinite(value) ? clamp(value, 0, 1) : 0)
const round2 = (value: number): number => Math.round(value * 100) / 100
const round4 = (value: number): number => Math.round(value * 10_000) / 10_000

// ---------- The five factors ----------

/** 50 % sure scores 0, 75 % scores 0.5, 100 % scores 1. */
export function confidenceScore(confidence: number): number {
  const { confidenceFloor } = BP_CONFIG
  return clamp01((confidence - confidenceFloor) / (1 - confidenceFloor))
}

/** The lead over the strongest guess that was not sure enough (0 to 1 as a share of 0.5). No such guess, no doubt: 1. */
export function clarityScore(lead: number | undefined): number {
  if (lead === undefined) return 1
  return clamp01(lead / BP_CONFIG.clarityFull)
}

/** The bird's month strip for the month of the catch. A bird without the strip gets the neutral score. */
export function seasonScore(months: string | undefined, caughtAt: number): number {
  if (!months || !/^[0-3]{12}$/.test(months)) return BP_CONFIG.neutral.season
  const level = Number(months[new Date(caughtAt).getMonth()])
  return BP_CONFIG.seasonScores[level] ?? BP_CONFIG.neutral.season
}

/** The hours (local, from and up to, the end may go past 24 to cross midnight) of each time of day. */
const DAY_WINDOWS: Record<DayPart, ReadonlyArray<readonly [number, number]>> = {
  day: [[8, 18]],
  dawn: [[4, 9]],
  dawn_dusk: [
    [4, 9],
    [17, 21],
  ],
  dusk: [[19, 28]],
  night: [[21, 29]],
}

/** How far (in hours, going round the clock) an hour is from a window: 0 inside it. */
function hoursFromWindow(hour: number, [from, to]: readonly [number, number]): number {
  for (const shifted of [hour, hour + 24]) {
    if (shifted >= from && shifted < to) return 0
  }
  const toStart = Math.min(Math.abs(hour - from), Math.abs(hour + 24 - from), Math.abs(hour - 24 - from))
  const toEnd = Math.min(Math.abs(hour - to), Math.abs(hour + 24 - to), Math.abs(hour - 24 - to))
  return Math.min(toStart, toEnd)
}

/** The hour of the catch against the time of day of the bird: right 1, within two hours 0.7, wrong 0.5. */
export function timeOfDayScore(day: DayPart | undefined, caughtAt: number): number {
  if (!day || !DAY_WINDOWS[day]) return BP_CONFIG.neutral.timeOfDay
  const date = new Date(caughtAt)
  const hour = date.getHours() + date.getMinutes() / 60
  const distance = Math.min(...DAY_WINDOWS[day].map((window) => hoursFromWindow(hour, window)))
  if (distance === 0) return 1
  return distance <= BP_CONFIG.closeHours ? BP_CONFIG.closeScore : BP_CONFIG.farScore
}

/** Live camera 1, sound 0.9, a photo 0.8 that falls to 0.4 over a week (an old picture from the gallery is worth less). */
export function wayScore(method: CatchMethod, ageMs: number): number {
  if (method === 'live') return BP_CONFIG.liveScore
  if (method === 'sound') return BP_CONFIG.soundScore
  const { photoFreshScore, photoStaleScore, photoFreshMs, photoStaleMs } = BP_CONFIG
  if (!(ageMs > photoFreshMs)) return photoFreshScore
  if (ageMs >= photoStaleMs) return photoStaleScore
  return photoFreshScore + ((photoStaleScore - photoFreshScore) * (ageMs - photoFreshMs)) / (photoStaleMs - photoFreshMs)
}

// ---------- Quality, start, luck ----------

/** The weighted sum of the five scores. */
export function qualityOf(factors: BpFactors): number {
  const { weights } = BP_CONFIG
  return clamp01(FACTOR_ORDER.reduce((sum, key) => sum + weights[key] * clamp01(factors[key]), 0))
}

/** Where quality alone puts a bird in its range. */
export function baseBp(range: BpRange, quality: number): number {
  const [min, max] = range
  return min + BP_CONFIG.headroom * (max - min) * clamp01(quality) ** BP_CONFIG.curve
}

/** A luck roll: from -luckDown to +luckUp, the average of two dice so that the ends are rare. */
export function rollLuck(random: () => number = Math.random): number {
  const { luckDown, luckUp } = BP_CONFIG
  return -luckDown + (luckDown + luckUp) * ((random() + random()) / 2)
}

/** The BP of a catch with this quality and this luck. Also used to recalculate a catch after the range table changed. */
export function finishBp(range: BpRange, quality: number, luck: number): { bp: number; base: number } {
  const [min, max] = range
  const base = baseBp(range, quality)
  return { bp: Math.round(clamp(base + (max - min) * luck, min, max)), base: Math.round(base) }
}

/** The range of a bird: its own from species.json, or the one of its rarity. */
export function bpRangeOf(species: Pick<Species, 'rarity' | 'info'>): BpRange {
  const own = species.info?.bp
  return own && own[0] < own[1] ? own : TIER_RANGES[species.rarity]
}

// ---------- A whole catch ----------

export interface BirdPointsInput {
  species: Pick<Species, 'rarity' | 'info'>
  method: CatchMethod
  /** 0 to 1. */
  confidence: number
  /** The lead over the strongest guess that was not sure enough; leave out when unknown (an old catch) or when there was none to lead. */
  lead?: number
  /** Milliseconds since 1970: when the bird was seen or heard (the date of a photo from the gallery is its own). */
  caughtAt: number
  /** Milliseconds since 1970: the moment of the catch. Defaults to the clock. */
  now?: number
  /** The dice. Defaults to Math.random. */
  random?: () => number
  /** A catch from before BP existed has no lead and gets the neutral clarity. */
  unknownClarity?: boolean
}

export function calculateBirdPoints(input: BirdPointsInput): BirdPoints {
  const now = input.now ?? Date.now()
  const info = input.species.info
  const factors: BpFactors = {
    confidence: confidenceScore(input.confidence),
    clarity: input.unknownClarity ? BP_CONFIG.neutral.clarity : clarityScore(input.lead),
    season: seasonScore(info?.months, input.caughtAt),
    timeOfDay: timeOfDayScore(info?.day, input.caughtAt),
    way: wayScore(input.method, now - input.caughtAt),
  }
  const quality = qualityOf(factors)
  const luck = rollLuck(input.random)
  const range = bpRangeOf(input.species)
  const { bp, base } = finishBp(range, quality, luck)
  return { bp, base, quality, luck, factors, range }
}

/** What is saved with a catch: the result, and what is needed to recalculate it with the same luck after a rebalance. */
export interface StoredBirdPoints {
  bp: number
  bpBase: number
  bpQ: number
  bpLuck: number
  /** The range the BP was worked out against: when the table changes, only the catches whose range differs are recalculated. */
  bpRange: [number, number]
  /** The five scores in the order of FACTOR_ORDER, two decimals. */
  bpFactors: number[]
  /** True for a catch from before BP existed (its clarity was not known). */
  bpLegacy?: true
}

export function toStored(points: BirdPoints, legacy = false): StoredBirdPoints {
  const stored: StoredBirdPoints = {
    bp: points.bp,
    bpBase: points.base,
    bpQ: round4(points.quality),
    bpLuck: round4(points.luck),
    bpRange: [points.range[0], points.range[1]],
    bpFactors: FACTOR_ORDER.map((key) => round2(points.factors[key])),
  }
  if (legacy) stored.bpLegacy = true
  return stored
}

/** The same quality and the same luck against a (changed) range. */
export function recalculateStored(stored: Pick<StoredBirdPoints, 'bpQ' | 'bpLuck'>, range: BpRange): { bp: number; bpBase: number } {
  const { bp, base } = finishBp(range, stored.bpQ, stored.bpLuck)
  return { bp, bpBase: base }
}

/** The five stored scores as named scores, or undefined when the catch has none. */
export function factorsOf(stored: { bpFactors?: readonly number[] }): BpFactors | undefined {
  const values = stored.bpFactors
  if (!values || values.length !== FACTOR_ORDER.length || values.some((value) => !Number.isFinite(value))) return undefined
  return Object.fromEntries(FACTOR_ORDER.map((key, index) => [key, values[index]])) as unknown as BpFactors
}
