import type { BirdPoints } from '../../domain/birdPoints'
import type { CandidateView } from './resultModel'

/** One bird that was caught: its guess, the id of its catch (for its page) and the BirdPoints it got. */
export interface CaughtBird {
  view: CandidateView
  catchId: string
  points: BirdPoints
}
