import { useMemo, useState } from 'react'
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ROUTES } from '../app/routes'
import { getSpeciesById, useSpecies } from '../data'
import { useCaughtSummary, useSpeciesCatches } from '../db'
import {
  DEFAULT_QUERY,
  cameFromDex,
  dexQueryToSearch,
  neighboursOf,
  parseDexQuery,
  selectSpecies,
  speciesHref,
  type DexQuery,
} from '../features/dex/filters'
import { PhotoViewer } from '../features/dex/PhotoViewer'
import { NameBlock, StatusBlock } from '../features/dex/SpeciesInfo'
import { SpeciesPhoto } from '../features/dex/SpeciesPhoto'
import '../features/dex/species.css'
import type { Species } from '../domain/types'
import { t } from '../i18n'
import { Button, ButtonLink } from '../ui/Button'
import { EmptyState } from '../ui/EmptyState'
import { IconButton, IconLink } from '../ui/IconButton'
import { Page } from '../ui/Page'
import { Spinner } from '../ui/Spinner'

/** The list the bird was opened from. When the address does not fit this bird (a shared link), the whole region of the bird is used. */
function listQueryFor(species: Species, fromAddress: DexQuery): DexQuery {
  return { ...fromAddress, region: fromAddress.region === 'czechia' && !species.inCzechia ? 'europe' : fromAddress.region }
}

export default function SpeciesPage() {
  const { id = '' } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const [params] = useSearchParams()
  const { species: list, error, retry } = useSpecies()
  const summary = useCaughtSummary()
  const { catches } = useSpeciesCatches(id)
  const [viewing, setViewing] = useState<string | undefined>()

  const bird = list ? getSpeciesById(id, list) : undefined
  const addressQuery = useMemo(() => parseDexQuery(params), [params])
  const caughtSummary = bird ? summary.bySpecies.get(bird.id) : undefined

  const query = useMemo(() => (bird ? listQueryFor(bird, addressQuery) : DEFAULT_QUERY), [bird, addressQuery])
  const inList = useMemo(() => {
    if (!list || !bird) return []
    const isCaught = (speciesId: string) => summary.bySpecies.has(speciesId)
    const wanted = selectSpecies(list, query, isCaught)
    // The bird itself always belongs to its own list, even if it no longer fits the filters (the last catch was just deleted).
    return wanted.some((species) => species.id === bird.id) ? wanted : selectSpecies(list, { ...query, status: 'all', q: '' }, isCaught)
  }, [list, bird, query, summary.bySpecies])
  const neighbours = useMemo(() => neighboursOf(inList, id), [inList, id])

  // Back goes to the Dex list the bird was opened from, exactly as it was left. When this address was opened directly (a
  // shared link, a reload on a new tab) there is nothing behind it, so the Dex is opened with the same filters instead.
  const fromDex = cameFromDex(location.state)
  const goBack = () => {
    if (fromDex) navigate(-1)
    else navigate(`${ROUTES.dex}${dexQueryToSearch(query)}`, { replace: true })
  }

  if (error && !list) {
    return (
      <Page className="bd-species">
        <EmptyState
          headingLevel={1}
          title={t('dex.loadError.title')}
          message={t('dex.loadError.other')}
          action={
            <Button icon="refresh" onClick={retry}>
              {t('common.retry')}
            </Button>
          }
        />
      </Page>
    )
  }

  if (!list || !summary.ready) {
    return (
      <Page className="bd-species">
        <div className="bd-dex__loading" role="status">
          <Spinner size="lg" label={null} />
          <p>{t('dex.loading')}</p>
        </div>
      </Page>
    )
  }

  if (!bird) {
    return (
      <Page className="bd-species">
        <EmptyState
          headingLevel={1}
          title={t('dex.species.notFound')}
          message={t('dex.species.notFoundHint')}
          action={
            <ButtonLink to={ROUTES.dex} icon="dex">
              {t('dex.species.toDex')}
            </ButtonLink>
          }
        />
      </Page>
    )
  }

  const ownPhoto = catches.find((record) => record.method !== 'sound' && record.mediaId)?.mediaId

  return (
    <Page className="bd-species">
      <nav className="bd-spnav" aria-label={t('dex.species.title')}>
        <IconButton icon="back" label={t('common.back')} onClick={goBack} data-testid="species-back" />
        <p className="bd-spnav__position" aria-live="polite">
          {neighbours.position > 0 ? t('dex.species.position', { position: neighbours.position, total: neighbours.total }) : ''}
        </p>
        {neighbours.previous ? (
          <IconLink
            to={speciesHref(neighbours.previous.id, query)}
            replace
            state={location.state}
            icon="chevron"
            label={t('dex.species.previous')}
            className="bd-spnav__flip"
            data-testid="species-prev"
          />
        ) : (
          <IconButton icon="chevron" label={t('dex.species.previous')} className="bd-spnav__flip" disabled />
        )}
        {neighbours.next ? (
          <IconLink to={speciesHref(neighbours.next.id, query)} replace state={location.state} icon="chevron" label={t('dex.species.next')} data-testid="species-next" />
        ) : (
          <IconButton icon="chevron" label={t('dex.species.next')} disabled />
        )}
      </nav>

      <SpeciesPhoto key={bird.id} species={bird} caught={!!caughtSummary} ownMediaId={ownPhoto} onOpenOwn={setViewing} />
      <NameBlock species={bird} />
      <StatusBlock species={bird} summary={caughtSummary} />

      {catches.length > 0 ? (
        <ButtonLink to={`${ROUTES.birds}?species=${encodeURIComponent(bird.id)}`} icon="bird" fullWidth data-testid="species-birds">
          {t('dex.myBirds', { count: catches.length })}
        </ButtonLink>
      ) : null}

      {viewing ? <PhotoViewer mediaId={viewing} onClose={() => setViewing(undefined)} /> : null}
    </Page>
  )
}
