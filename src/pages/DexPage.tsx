import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { useHref, useNavigate, useSearchParams } from 'react-router-dom'
import { ROUTES } from '../app/routes'
import { normalizeForSearch, SpeciesLoadError, useSpecies, type Region } from '../data'
import { useCaughtSummary } from '../db'
import { DexControls } from '../features/dex/DexControls'
import {
  dexQueryToParams,
  dexQueryToSearch,
  hasActiveFilters,
  parseDexQuery,
  progressStage,
  regionProgress,
  selectSpecies,
  type DexQuery,
  type DexSort,
  type StatusFilter,
} from '../features/dex/filters'
import { SpeciesGrid } from '../features/dex/SpeciesGrid'
import '../features/dex/dex.css'
import { formatPercent, t } from '../i18n'
import { Button, ButtonLink } from '../ui/Button'
import { EmptyState } from '../ui/EmptyState'
import { Notice } from '../ui/Notice'
import { Page, PageHeader } from '../ui/Page'
import { ProgressRing } from '../ui/ProgressRing'
import { Spinner } from '../ui/Spinner'

/** The query part of the address of the page: after the "#/" of the hash router, or the ordinary one. */
function queryOfPageAddress(): string {
  const { hash, search } = window.location
  if (hash.startsWith('#/')) return hash.includes('?') ? hash.slice(hash.indexOf('?') + 1) : ''
  return search.replace(/^\?/, '')
}

/** How long the search waits after the last key before it goes into the address. */
const SEARCH_COMMIT_MS = 250
/** Seven quick taps on the progress ring open the hidden demo page. */
const SECRET_TAPS = 7
const SECRET_WINDOW_MS = 4000

export default function DexPage() {
  const navigate = useNavigate()
  const { species, error, retry } = useSpecies()
  const summary = useCaughtSummary()
  const [params] = useSearchParams()
  const dexHref = useHref(ROUTES.dex)

  // The state of the list lives here, and the address is only a copy of it, written with the browser's history API.
  // Going through the router instead would give every change a new history key (which the scroll memory of the shell
  // is filed under) and would show the change a moment late, so a quick second tap could be merged onto a stale address.
  const [query, setQuery] = useState<DexQuery>(() => parseDexQuery(params))
  const queryRef = useRef(query)
  const timer = useRef<number | undefined>(undefined)

  const write = useCallback(
    (next: DexQuery) => {
      try {
        // Keep the state the router keeps there (its key), so the entry stays the same entry for the back button.
        window.history.replaceState(window.history.state, '', `${dexHref}${dexQueryToSearch(next)}`)
      } catch {
        // A browser that refuses (Safari allows 100 changes in 30 seconds) only loses the memory of the filters.
      }
    },
    [dexHref],
  )

  /** Changes part of the state. A search waits a moment before it is written to the address; everything else is written at once. */
  const apply = (patch: Partial<DexQuery>, { wait = false }: { wait?: boolean } = {}) => {
    const next = { ...queryRef.current, ...patch }
    queryRef.current = next
    setQuery(next)
    window.clearTimeout(timer.current)
    timer.current = undefined
    if (wait) {
      timer.current = window.setTimeout(() => {
        timer.current = undefined
        write(queryRef.current)
      }, SEARCH_COMMIT_MS)
    } else {
      write(next)
    }
  }

  /** Writes a search that is still waiting for its moment into the address now (before leaving for a bird). */
  const flush = useCallback(() => {
    if (timer.current === undefined) return
    window.clearTimeout(timer.current)
    timer.current = undefined
    write(queryRef.current)
  }, [write])

  /** Takes over a state that came from outside: the screen shows it and the search that was waiting is dropped. */
  const follow = useCallback((outside: DexQuery) => {
    if (dexQueryToParams(outside).toString() === dexQueryToParams(queryRef.current).toString()) return
    window.clearTimeout(timer.current)
    timer.current = undefined
    queryRef.current = outside
    setQuery(outside)
  }, [])

  // The router moved to another address of this screen (a link inside the app).
  const address = params.toString()
  useEffect(() => follow(parseDexQuery(new URLSearchParams(address))), [address, follow])

  // The browser moved (back and forward, or a changed address). The router cannot see our own changes of the address, so
  // it may think nothing changed; the address of the page itself says what the state should be.
  useEffect(() => {
    const onPop = () => follow(parseDexQuery(new URLSearchParams(queryOfPageAddress())))
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [follow])

  useEffect(
    () => () => {
      window.clearTimeout(timer.current)
    },
    [],
  )

  const onSearch = (value: string) => apply({ q: value }, { wait: true })
  const reset = () => apply({ q: '', status: 'all' })

  const bySpecies = summary.bySpecies
  const isCaught = useCallback((id: string) => bySpecies.has(id), [bySpecies])
  // The chips and the search box answer at once; the long list follows when the phone has a moment (typing stays smooth).
  const listQuery = useDeferredValue(query)
  const items = useMemo(() => (species ? selectSpecies(species, listQuery, isCaught) : []), [species, listQuery, isCaught])
  const ready = !!species && summary.ready
  // No numbers until the database has answered: "0 of 276" would be wrong for a moment for somebody who has caught birds.
  const progress = useMemo(() => (species && ready ? regionProgress(species, query.region, isCaught) : undefined), [species, ready, query.region, isCaught])

  const taps = useRef<number[]>([])
  const onRingTap = () => {
    const now = Date.now()
    taps.current = [...taps.current.filter((time) => now - time < SECRET_WINDOW_MS), now]
    if (taps.current.length >= SECRET_TAPS) {
      taps.current = []
      navigate('/dev/demo')
    }
  }

  const ring = progress ? (
    <div className="bd-dex__ring" onClick={onRingTap}>
      <ProgressRing value={progress.fraction} size={76} strokeWidth={10} label={formatPercent(progress.fraction)} ariaLabel={t('dex.progressLabel')} />
    </div>
  ) : undefined

  const header = (
    <PageHeader
      title={t('dex.title')}
      subtitle={
        progress ? (
          <>
            <span className="bd-dex__progress" data-testid="dex-progress">
              {t('dex.progress', { caught: progress.caught, total: progress.total })}
            </span>
            <span className="bd-dex__note">{t(`dex.progressNote.${progressStage(progress)}` as const)}</span>
          </>
        ) : (
          t('dex.subtitle')
        )
      }
      actions={ring}
    />
  )

  if (error && !species) {
    const network = error instanceof SpeciesLoadError && error.reason === 'network'
    return (
      <Page className="bd-dex">
        {header}
        <Notice
          tone="error"
          title={t('dex.loadError.title')}
          action={
            <Button icon="refresh" onClick={retry}>
              {t('common.retry')}
            </Button>
          }
        >
          {t(network ? 'dex.loadError.network' : 'dex.loadError.other')}
        </Notice>
      </Page>
    )
  }

  if (!ready) {
    return (
      <Page className="bd-dex">
        {header}
        <div className="bd-dex__loading" role="status">
          <Spinner size="lg" label={null} />
          <p>{t('dex.loading')}</p>
        </div>
      </Page>
    )
  }

  return (
    <Page className="bd-dex">
      {header}
      {summary.error ? (
        <Notice tone="warning" title={t('dex.summaryError.title')}>
          {t('dex.summaryError.text')}
        </Notice>
      ) : null}
      <DexControls
        count={items.length}
        search={query.q}
        region={query.region}
        status={query.status}
        sort={query.sort}
        onSearch={onSearch}
        onRegion={(region: Region) => apply({ region })}
        onStatus={(status: StatusFilter) => apply({ status })}
        onSort={(sort: DexSort) => apply({ sort })}
      />
      <div className="bd-dex__results" data-stale={listQuery !== query || undefined}>
        {items.length > 0 ? (
          <SpeciesGrid items={items} bySpecies={bySpecies} query={listQuery} onNavigate={flush} />
        ) : (
          <EmptyList query={listQuery} onReset={reset} />
        )}
      </div>
    </Page>
  )
}

function EmptyList({ query, onReset }: { query: DexQuery; onReset: () => void }) {
  const searching = normalizeForSearch(query.q) !== ''
  if (!searching && query.status === 'caught') {
    return (
      <EmptyState
        title={t('dex.emptyDex.title')}
        message={t('dex.emptyDex.hint')}
        action={
          <ButtonLink to={ROUTES.scan} icon="scan">
            {t('dex.emptyDex.action')}
          </ButtonLink>
        }
      />
    )
  }
  if (!searching && query.status === 'missing') {
    return <EmptyState title={t('dex.allCaught.title')} message={t('dex.allCaught.hint')} />
  }
  return (
    <EmptyState
      title={t('dex.empty.title')}
      message={t('dex.empty.hint')}
      action={
        hasActiveFilters(query) ? (
          <Button variant="secondary" onClick={onReset}>
            {t('dex.empty.reset')}
          </Button>
        ) : undefined
      }
    />
  )
}
