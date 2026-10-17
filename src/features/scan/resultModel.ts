// The view-model of the result screen: everything the screen shows about the guesses, worked out from the pending
// identification, the Dex data, the sensitivity setting and what is already caught. Pure, so it is easy to test;
// the screen only draws it. The rules for the Catch button come from src/domain/thresholds.ts and are not decided here.

import { displayName, getSpeciesById, secondaryName } from '../../data/species'
import { catchRule, evaluateCandidates, type BlockReason } from '../../domain/thresholds'
import type { CatchMethod, PendingIdentification, Rarity, Sensitivity, Species } from '../../domain/types'
import { normalizeCandidates } from './pendingBuilders'

export interface CandidateView {
  speciesId: string
  species: Species
  /** The Czech name, or the scientific name when BirdNET has no Czech one. */
  name: string
  /** The scientific name for the line under the name, or null when it already is the name. */
  scientificName: string | null
  /** 0 to 1. */
  confidence: number
  rarity: Rarity
  /** The Catch button works for this guess. */
  allowed: boolean
  /** Why it does not. Set exactly when `allowed` is false. */
  reason?: BlockReason
  /** How many times the species is in the Dex already (0 = a new species). */
  timesCaught: number
}

export interface ResultView {
  method: CatchMethod
  candidates: CandidateView[]
  /** At least one guess may be caught. */
  anyAllowed: boolean
  /** The least confidence the Catch button asks for, with the current sensitivity. For the notch on the bar. */
  neededConfidence: number
  /** The pending identification had no guesses (nothing heard, no bird in the picture). */
  empty: boolean
}

export interface ResultInput {
  pending: Pick<PendingIdentification, 'method' | 'candidates'>
  species: readonly Species[]
  sensitivity: Sensitivity
  /** Species id to how many times it is caught. */
  caughtCounts: ReadonlyMap<string, number>
}

export function buildResultView({ pending, species, sensitivity, caughtCounts }: ResultInput): ResultView {
  const guesses = normalizeCandidates(pending.candidates)
  // The verdicts compare every guess with the others, so they are worked out for the whole list before any is left out.
  const verdicts = evaluateCandidates(guesses, pending.method, sensitivity)
  const candidates: CandidateView[] = []
  guesses.forEach((guess, index) => {
    const bird = getSpeciesById(guess.speciesId, species)
    // A guess that is not in the Dex cannot be shown or caught anywhere, so it is left out.
    if (!bird) return
    const verdict = verdicts[index]
    candidates.push({
      speciesId: bird.id,
      species: bird,
      name: displayName(bird),
      scientificName: secondaryName(bird),
      confidence: guess.confidence,
      rarity: bird.rarity,
      allowed: verdict.allowed,
      ...(verdict.reason ? { reason: verdict.reason } : {}),
      timesCaught: caughtCounts.get(bird.id) ?? 0,
    })
  })
  return {
    method: pending.method,
    candidates,
    anyAllowed: candidates.some((candidate) => candidate.allowed),
    neededConfidence: catchRule(pending.method, sensitivity).minConfidence,
    empty: candidates.length === 0,
  }
}

/** The text key for a blocked guess. */
export function reasonKey(reason: BlockReason): 'result.reason.lowConfidence' | 'result.reason.unclear' {
  return reason === 'low-confidence' ? 'result.reason.lowConfidence' : 'result.reason.unclear'
}

/** Which scan screen the person goes back to to try again. */
export function scanPathFor(method: CatchMethod): '/scan/sound' | '/scan/photo' | '/scan/live' {
  switch (method) {
    case 'sound':
      return '/scan/sound'
    case 'photo':
      return '/scan/photo'
    case 'live':
      return '/scan/live'
  }
}

/** The confirmation question mentions what will be saved along with the bird. */
export function confirmTextKey(media: PendingIdentification['media']): 'result.confirm.withPhoto' | 'result.confirm.withSound' | 'result.confirm.withoutMedia' {
  if (!media) return 'result.confirm.withoutMedia'
  return media.kind === 'audio' ? 'result.confirm.withSound' : 'result.confirm.withPhoto'
}
