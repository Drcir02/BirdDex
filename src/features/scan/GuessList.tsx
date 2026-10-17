import { displayName, getSpeciesById } from '../../data/species'
import type { Candidate, Species } from '../../domain/types'
import { formatPercent } from '../../i18n'
import { ConfidenceBar } from '../../ui'
import { MAX_CANDIDATES, MIN_SHOWN_CONFIDENCE } from './pendingBuilders'

export interface GuessListProps {
  candidates: readonly Candidate[]
  /** The Dex list, for the Czech names. While it is still loading the names are left out. */
  species: readonly Species[] | undefined
  /** Draws the catch threshold as a notch on every bar. */
  threshold?: number
  /** What to say while there are no guesses. */
  empty: string
  /** The rows are smaller (the live camera). */
  compact?: boolean
}

/** The guesses of a running scan: the Czech name and a bar for each of the strongest few. */
export function GuessList({ candidates, species, threshold, empty, compact = false }: GuessListProps) {
  const shown = candidates.filter((candidate) => candidate.confidence >= MIN_SHOWN_CONFIDENCE).slice(0, MAX_CANDIDATES)
  if (shown.length === 0) {
    return (
      <p className="bd-scan-guess-empty" role="status">
        {empty}
      </p>
    )
  }
  return (
    <ol className={compact ? 'bd-scan-guesses bd-scan-guesses--compact' : 'bd-scan-guesses'}>
      {shown.map((candidate) => {
        const bird = species ? getSpeciesById(candidate.speciesId, species) : undefined
        const name = bird ? displayName(bird) : '…'
        return (
          <li key={candidate.speciesId} className="bd-scan-guess" data-testid="guess">
            <span className="bd-scan-guess__line">
              <span className="bd-scan-guess__name" data-testid="guess-name">
                {name}
              </span>
              <span className="bd-scan-guess__percent" data-testid="guess-percent">
                {formatPercent(candidate.confidence)}
              </span>
            </span>
            <ConfidenceBar value={candidate.confidence} threshold={threshold} showValue={false} label={`${name}: ${formatPercent(candidate.confidence)}`} />
          </li>
        )
      })}
    </ol>
  )
}
