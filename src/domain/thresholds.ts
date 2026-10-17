// When may the Catch button be pressed? One table of rules per way of identifying (sound, photo, live camera)
// and per Sensitivity setting, and one pure function that applies them. Screens show the verdict, they do not decide.
//
// The numbers come from measurements with the real models (docs/notes/integration.md, section 5; the engines' own numbers are in
// sound-engine.md section 7 and photo-engine.md "Catch thresholds"). What they have to do:
//   sound: the one false alarm found (perfectly flat synthetic noise) reaches 0.55, a clear bird 0.85 and more, a bird that is
//          really there but faint, in a busy recording, 0.5 to 0.6. So easy sits just above the false alarm.
//   photo: a bird the model knows well is 0.98 and more; the same species behind a lookalike (Common and Barrow's Goldeneye) 0.63
//          without the location filter; the Cormorant 0.75; foreign birds that look like a European one reach 0.67 (geese from
//          China read as Pink-footed Goose), 0.54 (an unknown tit) and 0.48 (an American woodpecker). Normal is above all of
//          those, so the foreign geese, the gulls and the unknown tit cannot be caught on the normal setting.

import type { Candidate, CatchMethod, Sensitivity } from './types'

export interface CatchRule {
  /** The guess must be at least this sure, from 0 to 1. */
  minConfidence: number
  /** The guess must lead the strongest of the other guesses by at least this much. 0 switches the check off. */
  minMargin: number
}

// Sound: BirdNET scores each species on its own, so two birds singing together can both score high.
// A margin over the second guess would wrongly block that, so sound only needs a high enough score.
// Photo and live camera: WingCLIP's guesses compete with each other, so a catch also needs a clear lead.
const PICTURE_RULES: Record<Sensitivity, CatchRule> = {
  strict: { minConfidence: 0.85, minMargin: 0.3 },
  normal: { minConfidence: 0.7, minMargin: 0.2 },
  easy: { minConfidence: 0.55, minMargin: 0.1 },
}

export const CATCH_RULES: Readonly<Record<CatchMethod, Readonly<Record<Sensitivity, CatchRule>>>> = {
  sound: {
    strict: { minConfidence: 0.85, minMargin: 0 },
    normal: { minConfidence: 0.7, minMargin: 0 },
    easy: { minConfidence: 0.6, minMargin: 0 },
  },
  photo: PICTURE_RULES,
  live: PICTURE_RULES,
}

export function catchRule(method: CatchMethod, sensitivity: Sensitivity): CatchRule {
  return CATCH_RULES[method][sensitivity]
}

/** Why the Catch button is off for a guess. Screens turn this into a Czech sentence. */
export type BlockReason = 'low-confidence' | 'unclear-margin'

export interface CandidateVerdict {
  speciesId: string
  confidence: number
  /**
   * How far this guess leads the strongest of the other guesses. Zero for a tie, negative when another guess is
   * stronger. With no other guess it equals the confidence, because the missing rival counts as 0.
   */
  margin: number
  allowed: boolean
  /** Set exactly when the guess is not allowed. If both rules fail, the confidence is named: it is the more basic problem. */
  reason?: BlockReason
}

// Scores such as 0.6 - 0.4 land a hair below 0.2 in floating point. Without a little slack, a guess sitting exactly on
// a threshold could be refused for no visible reason.
const SLACK = 1e-9

const cleanScore = (value: number): number => (Number.isFinite(value) ? value : 0)

/**
 * Judges every guess on its own. The result has one verdict per candidate, in the same order as the input
 * (the input does not have to be sorted).
 */
export function evaluateCandidates(
  candidates: readonly Candidate[],
  method: CatchMethod,
  sensitivity: Sensitivity,
): CandidateVerdict[] {
  const rule = catchRule(method, sensitivity)
  const scores = candidates.map((candidate) => cleanScore(candidate.confidence))

  // The best of the *other* guesses is the strongest score, except for the strongest guess itself, whose rival is the runner-up.
  let strongestIndex = -1
  let strongest = 0
  let runnerUp = 0
  scores.forEach((score, index) => {
    if (strongestIndex === -1 || score > strongest) {
      if (strongestIndex !== -1) runnerUp = strongest
      strongest = score
      strongestIndex = index
    } else if (score > runnerUp) {
      runnerUp = score
    }
  })

  return candidates.map((candidate, index) => {
    const confidence = scores[index]
    const rival = index === strongestIndex ? runnerUp : strongest
    // A lone guess has no rival, so its margin is simply its confidence (the missing rival counts as 0).
    const margin = confidence - Math.max(0, rival)
    const confidentEnough = confidence + SLACK >= rule.minConfidence
    const clearLead = rule.minMargin <= 0 || margin + SLACK >= rule.minMargin
    const verdict: CandidateVerdict = {
      speciesId: candidate.speciesId,
      confidence,
      margin,
      allowed: confidentEnough && clearLead,
    }
    if (!confidentEnough) verdict.reason = 'low-confidence'
    else if (!clearLead) verdict.reason = 'unclear-margin'
    return verdict
  })
}
