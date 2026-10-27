import { memo, useState } from 'react'
import { Link } from 'react-router-dom'
import { groupMemberPath, speciesPath } from '../../app/routes'
import { displayName } from '../../data/species'
import { FACTOR_ORDER, bpRangeOf, factorsOf } from '../../domain/birdPoints'
import type { Species } from '../../domain/types'
import { formatDateTime, t } from '../../i18n'
import { Button, Chip, Icon } from '../../ui'
import { BpMeter } from '../birds/BpMeter'
import { FactorRow } from '../birds/FactorRow'
import { AudioPlayer } from '../dex/AudioPlayer'
import { METHOD_ICON, mapUrl, placeOf } from '../dex/format'
import { RarityStars } from '../dex/RarityStars'
import { ReferenceImage } from '../dex/ReferenceImage'
import { useReferencePhoto } from '../photos'
import { agoText } from './ago'
import { Avatar } from './Avatar'
import type { FeedPost } from './types'
import './group.css'

export interface FeedCardProps {
  post: FeedPost
  species: Species | undefined
  /** The address of the picture or the clip of the post, once the server has given it. */
  mediaUrl: string | undefined
  /** Whether the person has this species in their own Dex. */
  inMyDex: boolean
  isMine: boolean
  /** The admin may delete any post. */
  canDelete: boolean
  onReact: (postId: string, on: boolean) => void
  onDelete: (postId: string) => void
  /** Open the card details at the start (the member page shows a few). */
  compact?: boolean
}

/** One catch of a member in the feed: who, when, where, the picture, the bird with its BP, badges, a Super button and the details. */
export const FeedCard = memo(function FeedCard({
  post,
  species,
  mediaUrl,
  inMyDex,
  isMine,
  canDelete,
  onReact,
  onDelete,
  compact = false,
}: FeedCardProps) {
  const [open, setOpen] = useState(false)
  const ownPicture = post.mediaKind === 'image' && mediaUrl ? mediaUrl : undefined
  const reference = useReferencePhoto(species?.id, { enabled: !ownPicture })
  const place = placeOf({
    placeName: post.placeName,
    location: post.lat !== undefined && post.lon !== undefined ? { lat: post.lat, lon: post.lon } : undefined,
  })
  const point = place.kind === 'none' ? undefined : place.point
  const name = species ? displayName(species) : t('group.post.unknownSpecies')
  const range = post.bpRange ?? (species ? bpRangeOf(species) : undefined)
  const factors = factorsOf({ bpFactors: post.bpFactors })

  return (
    <li className="bd-post" data-testid="feed-post" data-post-id={post.id} data-species-id={post.speciesId} data-user-id={post.userId}>
      <header className="bd-post__head">
        <Link to={groupMemberPath(post.userId)} className="bd-post__who" data-testid="post-author">
          <Avatar nickname={post.nickname} color={post.color} />
          <span className="bd-post__nick">{post.nickname}</span>
        </Link>
        <time className="bd-post__ago" dateTime={new Date(post.caughtAt).toISOString()}>
          {agoText(post.caughtAt)}
        </time>
        {place.kind !== 'none' ? (
          <p className="bd-post__place" data-testid="post-place">
            <Icon name="location" size={16} />
            {point ? (
              <a href={mapUrl(point)} target="_blank" rel="noopener noreferrer" data-testid="post-map">
                {place.text}
              </a>
            ) : (
              <span>{place.text}</span>
            )}
          </p>
        ) : null}
      </header>

      <div className="bd-post__pic" data-kind={post.mediaKind ?? 'none'}>
        {ownPicture ? (
          <img src={ownPicture} alt={t('group.post.photo')} loading="lazy" decoding="async" draggable={false} data-testid="post-photo" />
        ) : reference.photo ? (
          <ReferenceImage src={reference.photo.thumbnailUrl} alt={t('group.post.reference')} className="bd-post__reference" />
        ) : (
          <div className="bd-post__nopic" aria-hidden="true" />
        )}
      </div>
      {post.mediaKind === 'audio' && mediaUrl ? <AudioPlayer url={mediaUrl} className="bd-post__audio" /> : null}

      <div className="bd-post__body">
        <h3 className="bd-post__name" data-testid="post-name">
          <Icon name={METHOD_ICON[post.method]} size={18} />
          {name}
          {species ? <RarityStars rarity={species.rarity} size={12} /> : null}
        </h3>
        {post.bp !== undefined && range ? <BpMeter bp={post.bp} range={range} base={post.bpBase} compact={compact} /> : null}
        {post.newForUser || post.firstInGroup ? (
          <div className="bd-post__badges">
            {post.firstInGroup ? (
              <Chip tone="warning" icon="bird" data-testid="badge-first">
                {t('group.post.firstInGroup')}
              </Chip>
            ) : null}
            {post.newForUser ? (
              <Chip tone="info" icon="check" data-testid="badge-new">
                {t('group.post.newSpecies')}
              </Chip>
            ) : null}
          </div>
        ) : null}
      </div>

      <footer className="bd-post__foot">
        <button
          type="button"
          className={post.iReacted ? 'bd-post__react is-on' : 'bd-post__react'}
          aria-pressed={post.iReacted}
          aria-label={post.iReacted ? t('group.post.reacted') : t('group.post.react')}
          onClick={() => onReact(post.id, !post.iReacted)}
          data-testid="post-react"
        >
          <Icon name="bird" size={22} />
          <span>{t('group.post.react')}</span>
          {post.reactions > 0 ? <strong data-testid="post-reactions">{post.reactions}</strong> : null}
        </button>
        <button type="button" className="bd-post__more" aria-expanded={open} onClick={() => setOpen((value) => !value)} data-testid="post-toggle">
          {open ? t('group.post.close') : t('group.post.open')}
          <Icon name="chevron" size={16} className={open ? 'bd-post__chev is-open' : 'bd-post__chev'} />
        </button>
      </footer>

      {open ? (
        <div className="bd-post__details" data-testid="post-details">
          {factors ? (
            <ul className="bd-factors">
              {FACTOR_ORDER.map((key) => (
                <FactorRow key={key} factorKey={key} factors={factors} />
              ))}
            </ul>
          ) : null}
          <p className="bd-post__fact">
            <Icon name="calendar" size={18} />
            {t('group.post.caughtOn', { date: formatDateTime(post.caughtAt) })}
          </p>
          {species ? (
            <p className="bd-post__fact">
              <Icon name={inMyDex ? 'check' : 'dex'} size={18} />
              <span data-testid="post-mydex">{inMyDex ? t('group.post.hasSpecies') : t('group.post.missingSpecies')}</span>
              <Link to={speciesPath(species.id)}>{t('group.post.toSpecies')}</Link>
            </p>
          ) : null}
          {canDelete && !isMine ? (
            <Button variant="danger" icon="trash" onClick={() => onDelete(post.id)} data-testid="post-delete">
              {t('group.post.delete')}
            </Button>
          ) : null}
        </div>
      ) : null}
    </li>
  )
})
