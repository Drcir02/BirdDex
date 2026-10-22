// "Ptáci": every bird you caught as a card with its BP, three in a row, strongest first. Every catch is its own bird: the same
// species with the same BP is two cards. The Dex is the index of species; this is the backpack.
import { useCallback, useDeferredValue, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ROUTES } from '../app/routes'
import { displayName, getSpeciesById, normalizeForSearch } from '../data/species'
import { useSpecies } from '../data/useSpecies'
import { getDb, useLiveQuery } from '../db'
import { BirdCard } from '../features/birds/BirdCard'
import { useBirdPointsSync } from '../features/birds/useBirdPointsSync'
import {
  BIRD_SORTS,
  birdHref,
  birdsQueryToParams,
  buildBirdEntries,
  parseBirdsQuery,
  selectBirds,
  type BirdSort,
  type BirdsQuery,
} from '../features/birds/list'
import '../features/dex/dex.css'
import '../features/birds/birds.css'
import type { CatchRecord } from '../domain/types'
import { t } from '../i18n'
import { Button, ButtonLink } from '../ui/Button'
import { Chip } from '../ui/Chip'
import { Icon } from '../ui/icons'
import { EmptyState } from '../ui/EmptyState'
import { Notice } from '../ui/Notice'
import { Page, PageHeader } from '../ui/Page'
import { SearchField } from '../ui/SearchField'
import { Spinner } from '../ui/Spinner'

const SORT_LABEL = { bp: 'birds.sort.bp', newest: 'birds.sort.newest', name: 'birds.sort.name', rarity: 'birds.sort.rarity' } as const satisfies Record<BirdSort, string>
const NO_CATCHES: CatchRecord[] = []

/** "1 pták", "2 ptáci", "5 ptáků". */
const countText = (count: number) => t(count === 1 ? 'birds.count.one' : count >= 2 && count <= 4 ? 'birds.count.few' : 'birds.count.many', { count })

export default function BirdsPage() {
  const { species, error, retry } = useSpecies()
  const catches = useLiveQuery(() => getDb().catches.toArray(), [], NO_CATCHES)
  useBirdPointsSync(species, catches)
  const [params, setParams] = useSearchParams()
  const query = useMemo(() => parseBirdsQuery(params), [params])
  // The text of the search box answers at once; the list and the address follow.
  const [typed, setTyped] = useState<string | undefined>()
  const search = typed ?? query.q

  const apply = useCallback(
    (patch: Partial<BirdsQuery>) => setParams(birdsQueryToParams({ ...query, ...patch }), { replace: true }),
    [query, setParams],
  )
  const onSearch = (value: string) => {
    setTyped(value)
    apply({ q: value })
  }

  const showAll = () => {
    setTyped('')
    setParams(new URLSearchParams(), { replace: true })
  }

  const listQuery = useDeferredValue({ ...query, q: search })
  const entries = useMemo(() => (species ? buildBirdEntries(catches.value, species) : []), [catches.value, species])
  const items = useMemo(() => selectBirds(entries, listQuery), [entries, listQuery])
  const ready = !!species && catches.ready
  const total = entries.length
  const only = query.species && species ? getSpeciesById(query.species, species) : undefined

  const header = <PageHeader title={t('birds.title')} />

  if (error && !species) {
    return (
      <Page className="bd-birds">
        <PageHeader title={t('birds.title')} />
        <Notice
          tone="error"
          title={t('common.errors.title')}
          action={
            <Button icon="refresh" onClick={retry}>
              {t('common.retry')}
            </Button>
          }
        >
          {t('birds.loadError')}
        </Notice>
      </Page>
    )
  }

  if (!ready) {
    return (
      <Page className="bd-birds">
        {header}
        <div className="bd-dex__loading" role="status">
          <Spinner size="lg" label={null} />
          <p>{t('birds.loading')}</p>
        </div>
      </Page>
    )
  }

  if (total === 0) {
    return (
      <Page className="bd-birds">
        <PageHeader title={t('birds.title')} />
        <EmptyState
          title={t('birds.empty.title')}
          message={t('birds.empty.text')}
          action={
            <ButtonLink to={ROUTES.scan} icon="scan" data-testid="birds-empty-scan">
              {t('birds.empty.action')}
            </ButtonLink>
          }
        />
      </Page>
    )
  }

  return (
    <Page className="bd-birds">
      <PageHeader title={t('birds.title')} />
      <div className="bd-dexctl">
        <form
          onSubmit={(event) => {
            event.preventDefault()
            if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
          }}
        >
          <SearchField value={search} onChange={onSearch} label={t('birds.searchLabel')} placeholder={t('birds.searchPlaceholder')} />
        </form>
        {query.species ? (
          <div className="bd-birds__filter" data-testid="birds-species-filter">
            <p>{only ? displayName(only) : query.species}</p>
            <Chip icon="close" onClick={() => apply({ species: undefined })}>
              {t('birds.allSpecies')}
            </Chip>
          </div>
        ) : null}
        <div className="bd-dexctl__foot">
          <p className="bd-dexctl__count" role="status" data-testid="birds-shown">
            {countText(items.length)}
          </p>
          <label className="bd-dexsort">
            <span className="bd-sr-only">{t('birds.sortGroup')}</span>
            <svg className="bd-dexsort__icon" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
              <path d="M4 6h16M4 12h11M4 18h6" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
            </svg>
            <select className="bd-dexsort__select" value={query.sort} onChange={(event) => apply({ sort: event.target.value as BirdSort })} data-testid="birds-sort">
              {BIRD_SORTS.map((option) => (
                <option key={option} value={option}>
                  {t(SORT_LABEL[option])}
                </option>
              ))}
            </select>
            <Icon name="chevron" size={18} className="bd-dexsort__arrow" />
          </label>
        </div>
      </div>
      {items.length > 0 ? (
        <ul className="bd-bgrid" aria-label={t('birds.title')} data-testid="birds-grid">
          {items.map(({ record, species: bird }) => (
            <BirdCard key={record.id} record={record} species={bird} href={birdHref(record.id, listQuery)} />
          ))}
        </ul>
      ) : (
        <EmptyState
          title={t('birds.none')}
          message={t('birds.noneHint')}
          action={
            normalizeForSearch(search) !== '' || query.species ? (
              <Button variant="secondary" onClick={showAll}>
                {t('birds.allSpecies')}
              </Button>
            ) : undefined
          }
        />
      )}
    </Page>
  )
}
