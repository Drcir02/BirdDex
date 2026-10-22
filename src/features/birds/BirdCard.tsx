import { memo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { displayName } from '../../data/species'
import type { CatchRecord, Species } from '../../domain/types'
import { t } from '../../i18n'
import { Icon } from '../../ui/icons'
import { SpeciesSilhouette } from '../../ui/SpeciesSilhouette'
import { RarityStars } from '../dex/RarityStars'
import { ReferenceImage } from '../dex/ReferenceImage'
import { useThumbnail } from '../dex/thumbnails'
import { useNearScreen } from '../dex/useNearScreen'
import { useReferencePhoto } from '../photos'
import './birds.css'

/** The state a link from the list carries, so that "back" on the bird's page returns to the list as it was left. */
export const FROM_BIRDS = { fromBirds: true } as const

export interface BirdCardProps {
  record: CatchRecord
  species: Species
  /** The page of this bird (it also carries the state of the list). */
  href: string
}

/** One caught bird in the list: its BP big on top, the picture (its own photo, or the reference photo for a sound catch), the name. */
export const BirdCard = memo(function BirdCard({ record, species, href }: BirdCardProps) {
  const ref = useRef<HTMLLIElement>(null)
  const near = useNearScreen(ref)
  const hasOwnPhoto = record.method !== 'sound' && !!record.mediaId
  const ownPhoto = useThumbnail(hasOwnPhoto ? record.mediaId : undefined, near)
  const reference = useReferencePhoto(species.id, { enabled: near && !(hasOwnPhoto && ownPhoto) })
  const [ownPhotoBroken, setOwnPhotoBroken] = useState(false)

  const name = displayName(species)
  const bp = record.bp
  const silhouette = <SpeciesSilhouette family={species.family} size="100%" className="bd-bcard__sil" />
  let picture = silhouette
  if (hasOwnPhoto && ownPhoto && !ownPhotoBroken) {
    picture = <img className="bd-bcard__img" src={ownPhoto} alt="" loading="lazy" decoding="async" draggable={false} onError={() => setOwnPhotoBroken(true)} />
  } else if (reference.photo) {
    picture = <ReferenceImage src={reference.photo.thumbnailUrl} alt="" className="bd-bcard__img" placeholder={silhouette} />
  }
  const label = bp === undefined ? name : `${name}, ${t('birds.bp.label')} ${bp}`

  return (
    <li ref={ref} className="bd-bcard" data-testid="bird-card" data-catch-id={record.id} data-species-id={species.id} data-rarity={species.rarity} data-bp={bp}>
      <Link to={href} state={FROM_BIRDS} className="bd-bcard__link" aria-label={label}>
        <span className="bd-bcard__bp" aria-hidden="true">
          <small>{t('birds.bp.label')}</small>
          <strong data-testid="bird-card-bp">{bp ?? '–'}</strong>
        </span>
        <span className="bd-bcard__pic" aria-hidden="true">
          {picture}
          {record.method === 'sound' ? (
            <span className="bd-bcard__badge" title={t('birds.card.sound')}>
              <Icon name="speaker" size={13} />
            </span>
          ) : null}
        </span>
        <span className="bd-bcard__name" aria-hidden="true">
          {name}
        </span>
        <span className="bd-bcard__stars" aria-hidden="true">
          <RarityStars rarity={species.rarity} size={10} />
        </span>
      </Link>
    </li>
  )
})
