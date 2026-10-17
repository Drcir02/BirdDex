import { useState, type ReactNode } from 'react'
import { formatDexNumber } from '../../data/species'
import { useMediaUrl } from '../../db'
import type { Species } from '../../domain/types'
import { t } from '../../i18n'
import { Button } from '../../ui/Button'
import { LcdPanel } from '../../ui/LcdPanel'
import { Spinner } from '../../ui/Spinner'
import { SpeciesSilhouette } from '../../ui/SpeciesSilhouette'
import { SegmentedControl } from '../../ui/SegmentedControl'
import { useReferencePhoto, type ReferencePhoto } from '../photos'
import { ReferenceImage } from './ReferenceImage'

export interface SpeciesPhotoProps {
  species: Species
  caught: boolean
  /** The newest saved photo of this bird, when one of the catches has one. */
  ownMediaId: string | undefined
  /** Called with the saved photo's id when the person taps it, to show it at full size. */
  onOpenOwn: (mediaId: string) => void
}

type View = 'own' | 'reference'

/** "CC BY-SA 4.0" stays as it is; the public domain gets its Czech name. */
export function licenceLabel(licence: string): string {
  return /^(public domain|pd)\b/i.test(licence) ? t('dex.photo.publicDomain') : licence
}

/** The big green screen on the detail page: a silhouette, the person's own photo, or a reference photo with its credit. */
export function SpeciesPhoto({ species, caught, ownMediaId, onOpenOwn }: SpeciesPhotoProps) {
  const own = useMediaUrl(ownMediaId)
  const [view, setView] = useState<View | undefined>()
  const [peek, setPeek] = useState(false)

  // A bird that is not caught keeps its secret until the person asks to see it. A caught one looks the photo up at once.
  const wantsReference = caught || peek
  const reference = useReferencePhoto(species.id, { enabled: wantsReference })
  const hasOwn = caught && !!ownMediaId
  const shown: View = hasOwn ? (view ?? 'own') : 'reference'
  const showsReference = shown === 'reference' && wantsReference
  const canSwitch = hasOwn && reference.status === 'ready'

  let screen: ReactNode
  let credit: ReferencePhoto | undefined
  let note: string | undefined
  if (hasOwn && shown === 'own') {
    if (own.url) {
      screen = (
        <button type="button" className="bd-spphoto__open" onClick={() => ownMediaId && onOpenOwn(ownMediaId)} aria-label={t('dex.photo.enlarge')} data-testid="own-photo">
          <img className="bd-spphoto__img" src={own.url} alt={t('dex.photo.altMine')} draggable={false} />
        </button>
      )
    } else if (own.loading) {
      screen = <Spinner size="lg" label={t('common.loading')} />
    } else {
      screen = <Silhouette species={species} caught />
      note = t('dex.photo.missing')
    }
  } else if (showsReference) {
    if (reference.status === 'ready' && reference.photo) {
      credit = reference.photo
      screen = (
        <ReferenceImage
          key={reference.photo.imageUrl}
          src={reference.photo.imageUrl}
          fallbackSrc={reference.photo.thumbnailUrl}
          alt={t('dex.photo.altReference')}
          className="bd-spphoto__img"
          eager
          placeholder={<Silhouette species={species} caught={caught} />}
        />
      )
    } else if (reference.status === 'loading') {
      screen = (
        <div className="bd-spphoto__wait">
          <Spinner size="lg" label={null} />
          <span>{t('dex.photo.searching')}</span>
        </div>
      )
    } else {
      screen = <Silhouette species={species} caught={caught} />
      note = reference.status === 'error' ? t('dex.photo.offline') : t('dex.photo.none')
    }
  } else {
    screen = <Silhouette species={species} caught={caught} />
  }

  return (
    <section className="bd-spphoto" aria-label={t('dex.species.photo')}>
      <LcdPanel tone="dark" className="bd-spphoto__panel">
        <div className="bd-spphoto__screen" data-view={credit ? 'reference' : hasOwn && shown === 'own' && own.url ? 'own' : 'silhouette'} data-testid="species-photo">
          {screen}
          <span className="bd-spphoto__number">{formatDexNumber(species.dexNumber)}</span>
          <span className="bd-spphoto__scan" aria-hidden="true" />
        </div>
        {credit ? (
          <p className="bd-spphoto__credit" data-testid="photo-credit">
            <span>{t('dex.photo.credit', { author: credit.author || t('dex.photo.unknownAuthor') })}</span>
            <a href={credit.link} target="_blank" rel="noopener noreferrer" aria-label={`${t('dex.photo.sourceLink')}: ${licenceLabel(credit.licence)}`}>
              {licenceLabel(credit.licence)} · {t('dex.photo.source')}
            </a>
          </p>
        ) : note ? (
          <p className="bd-spphoto__note" role="status">
            {note}
          </p>
        ) : null}
      </LcdPanel>

      {canSwitch ? (
        <SegmentedControl
          label={t('dex.species.photo')}
          value={shown}
          options={[
            { value: 'own', label: t('dex.photo.mine') },
            { value: 'reference', label: t('dex.photo.reference') },
          ]}
          onChange={setView}
        />
      ) : null}
      {!caught ? (
        <Button variant="secondary" fullWidth aria-pressed={peek} onClick={() => setPeek((value) => !value)} data-testid="photo-peek">
          {t(peek ? 'dex.photo.hide' : 'dex.photo.reveal')}
        </Button>
      ) : null}
    </section>
  )
}

function Silhouette({ species, caught }: { species: Species; caught: boolean }) {
  return (
    <span className="bd-spphoto__sil" data-caught={caught}>
      <SpeciesSilhouette family={species.family} size="100%" title={t('common.a11y.silhouette')} />
    </span>
  )
}
