// When may the Catch button be pressed? One table of rules per way of identifying (sound, photo, live camera)
// and per Sensitivity setting, and one pure function that applies them. Screens show the verdict, they do not decide.
//
// The numbers come from measurements with the real models (docs/notes/integration.md, section 5; the engines' own numbers are in
// sound-engine.md section 7 and photo-engine.md "Catch thresholds"). What they have to do:
//   sound: the one false alarm found (perfectly flat synthetic noise) reaches 0.55 at the model; the engine now keeps flat noise
//          away from the model altogether (src/ml/audio/flatness.ts), but easy still sits above the false alarm (0.6). A clear bird
//          is 0.85 and more, a bird that is really there but faint, in a busy recording, 0.5 to 0.6.
//   photo: a bird the model knows well is 0.98 and more; the same species behind a lookalike (Common and Barrow's Goldeneye) 0.63
//          without the location filter; the Cormorant 0.75; foreign birds that look like a European one reach 0.67 (geese from
//          China read as Pink-footed Goose), 0.54 (an unknown tit) and 0.48 (an American woodpecker). Normal is above all of
//          those, so the foreign geese, the gulls and the unknown tit cannot be caught on the normal setting.
//          Confidence alone cannot tell the rest apart: the right answers sit at 0.63 to 0.99 and North American birds that look like
//          a European one reach 0.67 to 0.97 (Palm Warbler read as Water Pipit 0.97, Great Blue Heron as Purple Heron 0.90, House
//          Sparrow in a mosaic as Mandarin Duck 0.79). Two more facts about the picture catch most of those (see PictureEvidence):
//          pBird (the sparrow and the cormorants on a marker are 0.84 to 0.96, every right answer 0.98 and more) and
//          outsideDexTop (the plain model's best species outside the Dex: American birds the Dex lacks reach 0.8 to 0.9, the Great
//          Blue Heron seen from afar 0.24 to 0.38, a Palm Warbler only 0.28 to 0.37, while the right Great Cormorant already
//          reaches 0.20 to 0.27 because of its American cousins). So that bird sets the limit: normal 0.35. The Palm Warbler read
//          as a Water Pipit (0.97) stays a known gap. Measured on 26 photos, see photo-engine.md "Foreign look-alikes".

import type { Candidate, CatchMethod, Sensitivity } from './types'

export interface CatchRule {
  /** The guess must be at least this sure, from 0 to 1. */
  minConfidence: number
  /** The guess must lead the strongest of the other guesses by at least this much. 0 switches the check off. */
  minMargin: number
  /** Pictures only: the picture must show a bird at least this clearly (pBird, 0 to 1). 0 switches the check off. */
  minBird: number
  /** Pictures only: the plain model's best species outside the Dex may not be surer than this. 1 switches the check off. */
  maxOutsideDex: number
}

/** What the engine knows about a picture besides the guesses. A missing number means "not known" and its check is skipped. */
export interface PictureEvidence {
  pBird?: number
  outsideDexTop?: number
}

// Sound: BirdNET scores each species on its own, so two birds singing together can both score high.
// A margin over the second guess would wrongly block that, so sound only needs a high enough score.
// Photo and live camera: WingCLIP's guesses compete with each other, so a catch also needs a clear lead.
const PICTURE_RULES: Record<Sensitivity, CatchRule> = {
  strict: { minConfidence: 0.85, minMargin: 0.3, minBird: 0.97, maxOutsideDex: 0.3 },
  normal: { minConfidence: 0.7, minMargin: 0.2, minBird: 0.95, maxOutsideDex: 0.35 },
  // Easy accepts more mistakes (the confidence bar is low), but not a picture that is hardly a bird or that the model itself
  // thinks shows a bird outside the Dex.
  easy: { minConfidence: 0.55, minMargin: 0.1, minBird: 0.85, maxOutsideDex: 0.6 },
}

export const CATCH_RULES: Readonly<Record<CatchMethod, Readonly<Record<Sensitivity, CatchRule>>>> = {
  sound: {
    strict: { minConfidence: 0.85, minMargin: 0, minBird: 0, maxOutsideDex: 1 },
    normal: { minConfidence: 0.7, minMargin: 0, minBird: 0, maxOutsideDex: 1 },
    easy: { minConfidence: 0.6, minMargin: 0, minBird: 0, maxOutsideDex: 1 },
  },
  photo: PICTURE_RULES,
  live: PICTURE_RULES,
}

export function catchRule(method: CatchMethod, sensitivity: Sensitivity): CatchRule {
  return CATCH_RULES[method][sensitivity]
}

export interface EvaluateOptions {
  /**
   * Whether the extra checks of a picture count: the lead over the other guesses, how clearly it shows a bird, a possible foreign
   * look-alike. The screens switch them off (since the owner's phone test): a guess above the percentage of the chosen
   * sensitivity is simply sure enough, and the person, who confirms every catch, decides whether it is right. The checks stay
   * here, measured and tested, so they can be switched on again. Default: on.
   */
  extraChecks?: boolean
}

/** What the screens pass: only the percentage of the sensitivity decides. */
export const CONFIDENCE_ONLY: EvaluateOptions = { extraChecks: false }

/** Why the Catch button is off for a guess. Screens turn this into a Czech sentence. */
export type BlockReason = 'low-confidence' | 'unclear-margin' | 'not-a-clear-bird' | 'maybe-outside-dex'

export interface CandidateVerdict {
  speciesId: string
  confidence: number
  /**
   * How far this guess leads the strongest of the other guesses. Zero for a tie, negative when another guess is
   * stronger. With no other guess it equals the confidence, because the missing rival counts as 0.
   */
  margin: number
  allowed: boolean
  /** Set exactly when the guess is not allowed. If several rules fail, the first of these is named: confidence, lead, picture, foreign bird. */
  reason?: BlockReason
}

// Scores such as 0.6 - 0.4 land a hair below 0.2 in floating point. Without a little slack, a guess sitting exactly on
// a threshold could be refused for no visible reason.
const SLACK = 1e-9

const cleanScore = (value: number): number => (Number.isFinite(value) ? value : 0)

/**
 * Judges every guess on its own. The result has one verdict per candidate, in the same order as the input
 * (the input does not have to be sorted). `evidence` is what the engine knows about a picture (photo and live camera).
 */
export function evaluateCandidates(
  candidates: readonly Candidate[],
  method: CatchMethod,
  sensitivity: Sensitivity,
  evidence: PictureEvidence = {},
  options: EvaluateOptions = {},
): CandidateVerdict[] {
  const base = catchRule(method, sensitivity)
  const rule: CatchRule = options.extraChecks === false ? { ...base, minMargin: 0, minBird: 0, maxOutsideDex: 1 } : base
  const scores = candidates.map((candidate) => cleanScore(candidate.confidence))
  // Facts about the whole picture. Only a number that is really there counts; NaN is not a fact.
  const birdKnown = typeof evidence.pBird === 'number' && Number.isFinite(evidence.pBird)
  const clearBird = !birdKnown || rule.minBird <= 0 || (evidence.pBird as number) + SLACK >= rule.minBird
  const outsideKnown = typeof evidence.outsideDexTop === 'number' && Number.isFinite(evidence.outsideDexTop)
  const nothingForeign = !outsideKnown || rule.maxOutsideDex >= 1 || (evidence.outsideDexTop as number) <= rule.maxOutsideDex + SLACK

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
      allowed: confidentEnough && clearLead && clearBird && nothingForeign,
    }
    if (!confidentEnough) verdict.reason = 'low-confidence'
    else if (!clearLead) verdict.reason = 'unclear-margin'
    else if (!clearBird) verdict.reason = 'not-a-clear-bird'
    else if (!nothingForeign) verdict.reason = 'maybe-outside-dex'
    return verdict
  })
}
