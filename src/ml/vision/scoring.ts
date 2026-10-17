// From cosine similarities to guesses: the species softmax, the bird probe and the choice of the three guesses.
// Pure functions, no DOM: they run in the worker, on the main thread and in unit tests.
//
// What WingDex does (src/lib/bird-id-local.ts, rank.ts): softmax over sim / T + beta * log(occurrence prior), over the best 25
// species of the whole 10994, then confidence = P(bird) * probability. We have no occurrence prior for photos, so:
//   - the temperature T is WingDex's own, and the vision-only temperatures it fitted before the prior existed (0.0072 to
//     0.0078) are close to it, so the probabilities keep roughly the calibration it measured;
//   - the species outside our Dex are not thrown away but lowered by a fixed penalty, and stay in the softmax as rivals;
//   - an optional OccurrencePrior adds its own term, in the same form as WingDex (see prior.ts);
//   - the confidence is P(bird) * P(species), as in WingDex.

import type { Candidate } from '../../domain/types'
import { CALIBRATION, SCORING } from './constants'

export function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x))
}

/** The inverse of sigmoid, clamped like WingDex's: a probe that saturates at exactly 1 would give an infinite logit. */
export function logit(p: number): number {
  const eps = 1e-7
  const c = p < eps ? eps : p > 1 - eps ? 1 - eps : p
  return Math.log(c / (1 - c))
}

export interface ProbeCalibration {
  bias: number
  plattA: number
  plattB: number
  threshold: number
}

/** The calibrated probability that a picture shows a bird, from the probe's raw output (probe . embedding). */
export function birdProbability(dot: number, probe: ProbeCalibration = CALIBRATION.probe): { pRaw: number; pBird: number } {
  const pRaw = sigmoid(dot + probe.bias)
  return { pRaw, pBird: sigmoid(probe.plattA * logit(pRaw) + probe.plattB) }
}

/** True for a picture that very probably shows no bird, or when the probability is unusable. */
export function isNotABird(pBird: number, threshold: number = CALIBRATION.probe.threshold): boolean {
  return !(pBird >= threshold)
}

/** One entry per WingCLIP species row: 1 when the row belongs to a species of the Dex. */
export function makeDexMask(speciesRows: number, dexRows: ArrayLike<number>): Uint8Array {
  const mask = new Uint8Array(speciesRows)
  for (let i = 0; i < dexRows.length; i++) {
    const row = dexRows[i]
    if (!Number.isInteger(row) || row < 0 || row >= speciesRows) throw new RangeError(`WingCLIP row ${row} does not exist`)
    mask[row] = 1
  }
  return mask
}

export interface SpeciesScoringOptions {
  temperature?: number
  outOfDexPenalty?: number
  /** One value per Dex species, in Dex order, added to the score (see priorToLogWeights). */
  logPrior?: Float32Array
}

export interface SpeciesScoring {
  /** P(species) for each Dex species, in Dex order. Together with outsideMass it adds up to 1. */
  probs: Float32Array
  /** The probability that the bird is one of the species outside the Dex. */
  outsideMass: number
}

/**
 * Softmax over all species rows of score = cosine / temperature, minus `outOfDexPenalty` for species outside the Dex, plus
 * the log prior of the Dex species. Returns the probabilities of the Dex species and the mass that stays outside.
 */
export function scoreSpecies(sims: Float32Array, dexRows: ArrayLike<number>, dexMask: Uint8Array, options: SpeciesScoringOptions = {}): SpeciesScoring {
  const temperature = options.temperature ?? CALIBRATION.temperature
  const penalty = options.outOfDexPenalty ?? SCORING.outOfDexPenalty
  const logPrior = options.logPrior
  if (logPrior && logPrior.length !== dexRows.length) throw new RangeError('The prior has to have one value per Dex species')
  const rows = sims.length
  const scores = new Float64Array(rows)
  for (let r = 0; r < rows; r++) scores[r] = sims[r] / temperature - (dexMask[r] ? 0 : penalty)
  if (logPrior) for (let i = 0; i < dexRows.length; i++) scores[dexRows[i]] += logPrior[i]

  let max = -Infinity
  for (let r = 0; r < rows; r++) if (scores[r] > max) max = scores[r]
  const probs = new Float32Array(dexRows.length)
  if (!Number.isFinite(max)) return { probs, outsideMass: 1 }

  let total = 0
  let inside = 0
  for (let r = 0; r < rows; r++) {
    const e = Math.exp(scores[r] - max)
    scores[r] = e
    total += e
  }
  for (let i = 0; i < dexRows.length; i++) {
    const p = scores[dexRows[i]] / total
    probs[i] = p
    inside += p
  }
  return { probs, outsideMass: Math.max(0, 1 - inside) }
}

/**
 * How sure the plain model is about the most likely species outside the Dex: the largest probability of a non-Dex row in the
 * softmax over all rows with no penalty and no prior. This is the model's own opinion, before the Dex is allowed to win.
 * High (0.35 and up is where the normal Catch rule stops) means that the picture probably shows a bird we do not have: an
 * American woodpecker or gull reaches 0.8 to 0.9. It is not a clean detector of look-alikes: the right Great Cormorant reads
 * 0.27 because of its American cousins, as much as a Palm Warbler (0.28) that the penalised softmax calls a Water Pipit.
 */
export function outsideDexTop(sims: Float32Array, dexMask: Uint8Array, temperature: number = CALIBRATION.temperature): number {
  let max = -Infinity
  for (let r = 0; r < sims.length; r++) if (sims[r] > max) max = sims[r]
  if (!Number.isFinite(max)) return 0
  let total = 0
  let best = 0
  for (let r = 0; r < sims.length; r++) {
    const e = Math.exp((sims[r] - max) / temperature)
    total += e
    if (!dexMask[r] && e > best) best = e
  }
  const share = best / total
  return Number.isFinite(share) ? share : 0
}

/** Indexes of the k largest values, strongest first. Equal values keep their order. */
export function topIndices(values: ArrayLike<number>, k: number): number[] {
  const best: number[] = []
  for (let i = 0; i < values.length; i++) {
    const v = values[i]
    if (best.length === k && v <= values[best[k - 1]]) continue
    let at = best.length
    while (at > 0 && values[best[at - 1]] < v) at--
    best.splice(at, 0, i)
    if (best.length > k) best.pop()
  }
  return best
}

export function clamp01(value: number): number {
  return value > 0 ? (value < 1 ? value : 1) : 0
}

/** The guesses: the `count` strongest species with confidence = P(bird) * P(species). */
export function toCandidates(probs: ArrayLike<number>, pBird: number, idOf: (index: number) => string, count: number = SCORING.candidateCount): Candidate[] {
  return topIndices(probs, count).map((index) => ({ speciesId: idOf(index), confidence: clamp01(pBird * probs[index]) }))
}
