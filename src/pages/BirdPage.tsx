// One caught bird: its picture or recording, its BP with the bar between the least and the most BP of its species, the five
// scores the BP was made of, when and where, a note, and delete. The arrows step to the previous and the next bird of the list
// it was opened from.
import { useMemo, useState } from 'react'
import { useBirdPointsSync } from '../features/birds/useBirdPointsSync'
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ROUTES, speciesPath } from '../app/routes'
import { displayName, getSpeciesById, secondaryName } from '../data/species'
import { familyNameCs } from '../data/families'
import { useSpecies } from '../data/useSpecies'
import { deleteCatch, getDb, updateCatchNote, useLiveQuery, useMediaUrl } from '../db'
import { FACTOR_ORDER, bpRangeOf, factorsOf, type BpFactors } from '../domain/birdPoints'
import { BpMeter } from '../features/birds/BpMeter'
import { birdHref, buildBirdEntries, neighboursInList, parseBirdsQuery, selectBirds, DEFAULT_BIRDS_QUERY, birdsQueryToSearch } from '../features/birds/list'
import { AudioPlayer } from '../features/dex/AudioPlayer'
import { METHOD_ICON, mapUrl, placeOf } from '../features/dex/format'
import { PhotoViewer } from '../features/dex/PhotoViewer'
import { RarityStars } from '../features/dex/RarityStars'
import { ReferenceImage } from '../features/dex/ReferenceImage'
import { forgetThumbnail } from '../features/dex/thumbnails'
import { useReferencePhoto } from '../features/photos'
import '../features/dex/species.css'
import '../features/birds/birds.css'
import type { CatchRecord } from '../domain/types'
import { formatDateTime, formatPercent, t } from '../i18n'
import { Button, ButtonLink } from '../ui/Button'
import { Chip } from '../ui/Chip'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { EmptyState } from '../ui/EmptyState'
import { Icon } from '../ui/icons'
import { IconButton, IconLink } from '../ui/IconButton'
import { LcdPanel } from '../ui/LcdPanel'
import { Page } from '../ui/Page'
import { Spinner } from '../ui/Spinner'
import { useToast } from '../ui/Toast'

const NO_CATCHES: CatchRecord[] = []

export default function BirdPage() {
  const { id = '' } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const [params] = useSearchParams()
  const toast = useToast()
  const { species } = useSpecies()
  const catches = useLiveQuery(() => getDb().catches.toArray(), [], NO_CATCHES)
  const [viewing, setViewing] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [busy, setBusy] = useState(false)

  useBirdPointsSync(species, catches)
  const record = catches.value.find((entry) => entry.id === id)
  const bird = record && species ? getSpeciesById(record.speciesId, species) : undefined
  const query = useMemo(() => parseBirdsQuery(params), [params])
  const entries = useMemo(() => (species ? buildBirdEntries(catches.value, species) : []), [catches.value, species])
  // The list the bird was opened from; a link that does not fit it (the bird is not in it) uses the whole list.
  const { list, neighbours } = useMemo(() => {
    let wanted = selectBirds(entries, query)
    if (!wanted.some((entry) => entry.record.id === id)) wanted = selectBirds(entries, DEFAULT_BIRDS_QUERY)
    return { list: wanted, neighbours: neighboursInList(wanted, id) }
  }, [entries, query, id])

  const image = useMediaUrl(record && record.method !== 'sound' ? record.mediaId : undefined)
  const reference = useReferencePhoto(bird?.id, { enabled: !!bird && !(record && record.method !== 'sound' && record.mediaId) })

  const listHref = `${ROUTES.birds}${birdsQueryToSearch(query)}`
  const fromList = typeof location.state === 'object' && location.state !== null && 'fromBirds' in location.state
  const goBack = () => (fromList ? navigate(-1) : navigate(listHref, { replace: true }))

  if (!species || !catches.ready) {
    return (
      <Page className="bd-bird">
        <div className="bd-dex__loading" role="status">
          <Spinner size="lg" label={null} />
          <p>{t('birds.loading')}</p>
        </div>
      </Page>
    )
  }

  if (!record || !bird) {
    return (
      <Page className="bd-bird">
        <EmptyState
          headingLevel={1}
          title={t('birds.detail.notFound')}
          message={t('birds.detail.notFoundHint')}
          action={
            <ButtonLink to={ROUTES.birds} icon="bird">
              {t('birds.detail.toList')}
            </ButtonLink>
          }
        />
      </Page>
    )
  }

  const range = bpRangeOf(bird)
  const factors = factorsOf(record)
  const place = placeOf(record)
  const point = place.kind === 'none' ? undefined : place.point
  const name = displayName(bird)
  const latin = secondaryName(bird)
  const family = bird.family ? (familyNameCs(bird.family) ?? bird.family) : undefined

  const confirmDelete = async () => {
    if (busy) return
    setBusy(true)
    try {
      await deleteCatch(record.id)
      if (record.mediaId) forgetThumbnail(record.mediaId)
      toast.show(t('birds.detail.deleted'), { tone: 'success' })
      setRemoving(false)
      navigate(listHref, { replace: true })
    } catch {
      toast.show(t('birds.detail.deleteFailed'), { tone: 'error' })
    } finally {
      setBusy(false)
    }
  }

  const stepState = { fromBirds: true }
  return (
    <Page className="bd-bird">
      <nav className="bd-spnav" aria-label={t('birds.detail.title')}>
        <IconButton icon="back" label={t('common.back')} onClick={goBack} data-testid="bird-back" />
        <p className="bd-spnav__position" aria-live="polite">
          {neighbours.position > 0 ? t('birds.detail.position', { position: neighbours.position, total: neighbours.total }) : ''}
        </p>
        {neighbours.previous ? (
          <IconLink to={birdHref(neighbours.previous.record.id, query)} replace state={stepState} icon="chevron" label={t('birds.detail.previous')} className="bd-spnav__flip" data-testid="bird-prev" />
        ) : (
          <IconButton icon="chevron" label={t('birds.detail.previous')} className="bd-spnav__flip" disabled />
        )}
        {neighbours.next ? (
          <IconLink to={birdHref(neighbours.next.record.id, query)} replace state={stepState} icon="chevron" label={t('birds.detail.next')} data-testid="bird-next" />
        ) : (
          <IconButton icon="chevron" label={t('birds.detail.next')} disabled />
        )}
      </nav>

      <LcdPanel className="bd-bird__main" data-testid="bird-main" data-catch-id={record.id} data-method={record.method}>
        <div className="bd-bird__picture" data-method={record.method}>
          {image.url ? (
            <button type="button" className="bd-bird__photo" onClick={() => setViewing(true)} aria-label={t('dex.photo.enlarge')} data-testid="bird-photo">
              <img src={image.url} alt={t('birds.detail.photo')} draggable={false} />
            </button>
          ) : reference.photo ? (
            <ReferenceImage src={reference.photo.thumbnailUrl} alt={t('dex.photo.altReference')} className="bd-bird__reference" />
          ) : null}
        </div>
        {record.method === 'sound' && record.mediaId ? <AudioPlayer mediaId={record.mediaId} className="bd-bird__audio" /> : null}

        <h1 className="bd-bird__name" data-testid="bird-name">
          {name}
        </h1>
        {latin ? (
          <p className="bd-bird__latin" lang="la">
            <i>{latin}</i>
          </p>
        ) : null}
        <div className="bd-bird__chips">
          <Chip tone={bird.rarity}>
            <RarityStars rarity={bird.rarity} size={12} />
            {t(`common.rarity.${bird.rarity}` as const)}
          </Chip>
          {family ? <Chip tone="neutral">{family}</Chip> : null}
          {record.id.startsWith('demo-') ? <Chip tone="warning">{t('dex.demo.demoTag')}</Chip> : null}
        </div>

        {record.bp !== undefined ? <BpMeter bp={record.bp} range={range} base={record.bpBase} /> : null}
      </LcdPanel>

      <LcdPanel title={t('birds.bp.breakdown')} titleLevel={2} data-testid="bird-breakdown">
        {factors ? (
          <ul className="bd-factors">
            {FACTOR_ORDER.map((key) => (
              <FactorRow key={key} factorKey={key} factors={factors} />
            ))}
          </ul>
        ) : (
          <p>{t('birds.bp.noBreakdown')}</p>
        )}
        {record.bpLegacy ? (
          <p className="bd-bird__legacy" data-testid="bird-legacy">
            {t('birds.bp.legacy')}
          </p>
        ) : null}
      </LcdPanel>

      <LcdPanel className="bd-bird__facts">
        <p className="bd-bird__fact" data-testid="bird-when">
          <Icon name="calendar" size={20} />
          <time dateTime={new Date(record.caughtAt).toISOString()}>{formatDateTime(record.caughtAt)}</time>
        </p>
        <p className="bd-bird__fact" data-testid="bird-where">
          <Icon name="location" size={20} />
          {place.kind === 'none' ? <span className="bd-bird__muted">{t('birds.detail.noPlace')}</span> : <span>{place.text}</span>}
          {point ? (
            <a className="bd-catch__map" href={mapUrl(point)} target="_blank" rel="noopener noreferrer">
              {t('birds.detail.openMap')}
            </a>
          ) : null}
        </p>
        <p className="bd-bird__fact" data-testid="bird-way">
          <Icon name={METHOD_ICON[record.method]} size={20} />
          {t(`common.methods.${record.method}` as const)}, {formatPercent(record.confidence)}
        </p>
        <NoteEditor key={record.id} record={record} />
      </LcdPanel>

      <div className="bd-bird__actions">
        <ButtonLink to={speciesPath(bird.id)} variant="secondary" icon="dex" fullWidth data-testid="bird-species">
          {t('birds.detail.aboutSpecies')}
        </ButtonLink>
        <Button variant="secondary" icon="trash" fullWidth onClick={() => setRemoving(true)} data-testid="bird-delete">
          {t('birds.detail.delete')}
        </Button>
      </div>

      {viewing && record.mediaId ? <PhotoViewer mediaId={record.mediaId} onClose={() => setViewing(false)} /> : null}
      <ConfirmDialog
        open={removing}
        tone="danger"
        busy={busy}
        title={t('birds.detail.deleteTitle')}
        message={<p>{t('birds.detail.deleteMessage')}</p>}
        confirmLabel={t('birds.detail.deleteConfirm')}
        cancelLabel={t('birds.detail.deleteCancel')}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setRemoving(false)}
      />
      {/* The list behind the arrows is only used for them. */}
      <span hidden data-testid="bird-list-size">
        {list.length}
      </span>
    </Page>
  )
}

function FactorRow({ factorKey, factors }: { factorKey: keyof BpFactors; factors: BpFactors }) {
  const value = factors[factorKey]
  return (
    <li className="bd-factor" data-testid={`factor-${factorKey}`}>
      <span className="bd-factor__name">{t(`birds.bp.factor.${factorKey}` as const)}</span>
      <div
        className="bd-factor__bar"
        role="meter"
        aria-label={t(`birds.bp.factor.${factorKey}` as const)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(value * 100)}
        aria-describedby={undefined}
      >
        <i style={{ width: `${Math.round(value * 100)}%` }} />
      </div>
      <span className="bd-factor__value">{formatPercent(value)}</span>
      <span className="bd-factor__hint">{t(`birds.bp.factorHint.${factorKey}` as const)}</span>
    </li>
  )
}

/** The note of a bird: a text box and a button that saves it. */
function NoteEditor({ record }: { record: CatchRecord }) {
  const toast = useToast()
  const [text, setText] = useState(record.note ?? '')
  const [saving, setSaving] = useState(false)
  const changed = text.trim() !== (record.note ?? '')
  const save = async () => {
    if (saving || !changed) return
    setSaving(true)
    try {
      await updateCatchNote(record.id, text.trim() || undefined)
      toast.show(t('birds.detail.noteSaved'), { tone: 'success' })
    } catch {
      toast.show(t('birds.detail.noteFailed'), { tone: 'error' })
    } finally {
      setSaving(false)
    }
  }
  return (
    <div className="bd-bird__note">
      <label>
        <span className="bd-bird__notelabel">{t('birds.detail.note')}</span>
        <textarea
          className="bd-bird__textarea"
          rows={2}
          maxLength={500}
          value={text}
          placeholder={t('birds.detail.notePlaceholder')}
          onChange={(event) => setText(event.target.value)}
          data-testid="bird-note"
        />
      </label>
      {changed ? (
        <Button icon="check" disabled={saving} onClick={() => void save()} data-testid="bird-note-save">
          {t('birds.detail.noteSave')}
        </Button>
      ) : null}
    </div>
  )
}
