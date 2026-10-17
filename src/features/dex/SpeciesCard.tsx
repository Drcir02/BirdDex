import { memo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { displayName, formatDexNumber, secondaryName } from '../../data/species'
import type { SpeciesCaughtSummary } from '../../db'
import type { Species } from '../../domain/types'
import { t } from '../../i18n'
import { Icon } from '../../ui/icons'
import { SpeciesSilhouette } from '../../ui/SpeciesSilhouette'
import { useReferencePhoto } from '../photos'
import { FROM_DEX } from './filters'
import { RarityStars } from './RarityStars'
import { ReferenceImage } from './ReferenceImage'
import { useThumbnail } from './thumbnails'
import { useNearScreen } from './useNearScreen'

export interface SpeciesCardProps {
  species: Species
  /** Present when the bird is caught. */
  summary: SpeciesCaughtSummary | undefined
  /** The detail screen of this bird (it also carries the state of the list). */
  href: string
  /** Called before the link is followed, to save what is still being typed. */
  onNavigate?: () => void
}

/** One bird in the Dex grid: the picture (silhouette until it is caught), the number, the name and the rarity. */
export const SpeciesCard = memo(function SpeciesCard({ species, summary, href, onNavigate }: SpeciesCardProps) {
  const ref = useRef<HTMLLIElement>(null)
  const near = useNearScreen(ref)
  const caught = summary !== undefined
  const hasOwnPhoto = caught && summary.mediaKind === 'image' && !!summary.mediaId
  // A bird that is caught but has no photo of its own (a sound catch) borrows the reference photo.
  const ownPhoto = useThumbnail(hasOwnPhoto ? summary.mediaId : undefined, near)
  const reference = useReferencePhoto(species.id, { enabled: near && caught && !hasOwnPhoto })
  const [ownPhotoBroken, setOwnPhotoBroken] = useState(false)

  const name = displayName(species)
  const latin = secondaryName(species)
  const number = formatDexNumber(species.dexNumber)
  const state = t(caught ? 'dex.card.caught' : 'dex.card.notCaught')
  // A screen reader says "číslo 1", not "hash nula nula jedna".
  const label = t('dex.card.aria', { name, number: species.dexNumber, state, rarity: t(`common.rarity.${species.rarity}` as const) })

  const silhouette = <SpeciesSilhouette family={species.family} size="100%" className="bd-dexcard__sil" />
  let picture = silhouette
  if (hasOwnPhoto && ownPhoto && !ownPhotoBroken) {
    picture = <img className="bd-dexcard__img is-loaded" src={ownPhoto} alt="" loading="lazy" decoding="async" draggable={false} onError={() => setOwnPhotoBroken(true)} />
  } else if (caught && !hasOwnPhoto && reference.photo) {
    picture = <ReferenceImage src={reference.photo.thumbnailUrl} alt="" className="bd-dexcard__img" placeholder={silhouette} />
  }

  return (
    <li ref={ref} className="bd-dexcard" data-testid="species-card" data-species-id={species.id} data-caught={caught} data-rarity={species.rarity}>
      <Link to={href} state={FROM_DEX} className="bd-dexcard__link" aria-label={label} onClick={onNavigate}>
        <span className="bd-dexcard__pic" aria-hidden="true">
          {picture}
          {caught ? (
            <span className="bd-dexcard__badge">
              <Icon name="check" size={16} />
              {summary.count > 1 ? <span className="bd-dexcard__times">{t('dex.card.times', { count: summary.count })}</span> : null}
            </span>
          ) : null}
        </span>
        <span className="bd-dexcard__names" aria-hidden="true">
          <span className="bd-dexcard__name">{name}</span>
          {latin ? <span className="bd-dexcard__latin">{latin}</span> : null}
        </span>
        <span className="bd-dexcard__meta" aria-hidden="true">
          <span className="bd-dexcard__num">{number}</span>
          <RarityStars rarity={species.rarity} size={11} />
        </span>
      </Link>
    </li>
  )
})
