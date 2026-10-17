import type { SpeciesCaughtSummary } from '../../db'
import type { Species } from '../../domain/types'
import { t } from '../../i18n'
import { speciesHref, type DexQuery } from './filters'
import { SpeciesCard } from './SpeciesCard'

export interface SpeciesGridProps {
  items: readonly Species[]
  bySpecies: ReadonlyMap<string, SpeciesCaughtSummary>
  /** The state of the list; every card links to its bird with this state attached. */
  query: DexQuery
  onNavigate?: () => void
}

/** The cards of the Dex. Cards far from the screen are skipped by the browser (content-visibility), so hundreds stay smooth. */
export function SpeciesGrid({ items, bySpecies, query, onNavigate }: SpeciesGridProps) {
  return (
    <ul className="bd-dexgrid" aria-label={t('dex.gridLabel')} data-testid="species-grid">
      {items.map((species) => (
        <SpeciesCard key={species.id} species={species} summary={bySpecies.get(species.id)} href={speciesHref(species.id, query)} onNavigate={onNavigate} />
      ))}
    </ul>
  )
}
