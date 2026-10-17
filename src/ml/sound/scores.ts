// From BirdNET's 6522 raw outputs (logits) to scores and to the birds of the Dex. Pure functions, no model needed.

import type { Species } from '../../domain/types'

/** BirdNET V2.4 has 6522 outputs: 6421 birds and 101 other things (frogs, insects, Dog, Engine, Human, Noise...). */
export const BIRDNET_OUTPUTS = 6522

/**
 * BirdNET's own way to turn a logit into a score between 0 and 1: a plain sigmoid, with the logit first clipped to
 * -15..15 (flat_sigmoid with sensitivity 1.0 in BirdNET Analyzer's model.py). Scores of different species do not
 * compete: two birds singing together can both score high.
 */
export function sigmoid(logit: number): number {
  const clipped = logit < -15 ? -15 : logit > 15 ? 15 : logit
  return 1 / (1 + Math.exp(-clipped))
}

/** Scores for all outputs. Pass `into` to reuse a buffer between windows. */
export function scoresFromLogits(logits: ArrayLike<number>, into?: Float32Array): Float32Array {
  const scores = into && into.length === logits.length ? into : new Float32Array(logits.length)
  for (let i = 0; i < logits.length; i++) scores[i] = sigmoid(logits[i])
  return scores
}

export interface RankedOutput {
  /** Position in BirdNET's outputs. */
  index: number
  score: number
}

/**
 * The `count` best scores among the allowed positions (all positions when `allowed` is null), strongest first.
 * `weights` (optional) multiplies a position's score before it is compared and returned. Equal scores keep the lower
 * position first, so the answer is the same on every run.
 */
export function topScores(scores: ArrayLike<number>, allowed: ArrayLike<number> | null, count: number, weights?: ArrayLike<number>): RankedOutput[] {
  const best: RankedOutput[] = []
  if (count <= 0) return best
  const total = allowed ? allowed.length : scores.length
  for (let i = 0; i < total; i++) {
    const index = allowed ? allowed[i] : i
    const score = weights ? scores[index] * weights[index] : scores[index]
    if (!(score > 0)) continue
    if (best.length === count && score <= best[count - 1].score) continue
    // Insert in order (the list is tiny, so a linear scan is the fastest way).
    let at = best.length
    while (at > 0 && best[at - 1].score < score) at--
    best.splice(at, 0, { index, score })
    if (best.length > count) best.pop()
  }
  return best
}

// ---------- Which outputs may be reported ----------

/** Which BirdNET outputs the engine may report, and under which species id. */
export interface SpeciesLookup {
  /** Allowed positions, ascending. */
  readonly indices: Int32Array
  /** The species id to report for a position, or undefined when it may not be reported. */
  idOf(index: number): string | undefined
  /** Optional factor per BirdNET output (1 leaves a score as it is). Set by the location prior, see weightByLocation. */
  readonly weights?: Float32Array
}

/** Only the birds of the Dex. BirdNET's other 6000 species, and every non-bird class, are never reported. */
export function dexLookup(list: readonly Species[]): SpeciesLookup {
  const ids = new Map<number, string>()
  for (const species of list) ids.set(species.birdnetIndex, species.id)
  const indices = Int32Array.from(ids.keys()).sort()
  return { indices, idOf: (index) => ids.get(index) }
}

/** The id of the Dex entry style for a BirdNET label: "Poecile atricapillus_Black-capped Chickadee" gives "poecile-atricapillus". */
export function idFromLabel(label: string): string {
  const scientific = label.split('_')[0] ?? label
  return scientific.trim().toLowerCase().replace(/\s+/g, '-')
}

/**
 * Debug only: every one of BirdNET's outputs is allowed, with the Dex id where the bird is in the Dex and an id made
 * from the label otherwise. This lets the North American test recording be checked against the model.
 */
export function allLabelsLookup(labels: readonly string[], list: readonly Species[]): SpeciesLookup {
  const dex = new Map<number, string>()
  for (const species of list) dex.set(species.birdnetIndex, species.id)
  const indices = new Int32Array(labels.length)
  for (let i = 0; i < labels.length; i++) indices[i] = i
  return { indices, idOf: (index) => dex.get(index) ?? (index < labels.length ? idFromLabel(labels[index]) : undefined) }
}

/** Birds that BirdNET's location model does not expect here keep competing, but their scores are multiplied by this. */
export const OFF_LIST_FACTOR = 0.8

/**
 * Applies the location prior: the birds of the lookup whose location score is at least `threshold` (BirdNET Analyzer's
 * species list) count fully, all others count `offListFactor` times their score. They are not thrown away: a clear
 * recording of a bird that is out of season or out of range (a nightingale played in October, a rarity) can still be
 * caught, while a borderline look-alike from far away cannot. When fewer than `minimum` birds of the lookup are
 * expected (open sea, a bad position) the prior says too little to trust, and the lookup is returned unchanged.
 */
export function weightByLocation(
  lookup: SpeciesLookup,
  locationScores: ArrayLike<number>,
  threshold: number,
  minimum: number,
  offListFactor: number = OFF_LIST_FACTOR,
): SpeciesLookup {
  let expected = 0
  for (const index of lookup.indices) if (locationScores[index] >= threshold) expected++
  if (expected < minimum) return lookup
  const weights = new Float32Array(locationScores.length).fill(offListFactor)
  for (const index of lookup.indices) if (locationScores[index] >= threshold) weights[index] = 1
  return { indices: lookup.indices, idOf: lookup.idOf, weights }
}
