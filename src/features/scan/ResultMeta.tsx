import type { GeoPoint, PendingIdentification } from '../../domain/types'
import { formatDate, formatTime, t } from '../../i18n'
import { Icon, LcdPanel } from '../../ui'
import { describePlace } from './format'
import { useObjectUrl } from './useObjectUrl'

export interface ResultMetaProps {
  createdAt: number
  location: GeoPoint | undefined
  placeName?: string
  media: PendingIdentification['media']
}

/** What will be saved with the catch: the picture or the clip, the date and time, and the place. */
export function ResultMeta({ createdAt, location, placeName, media }: ResultMetaProps) {
  const url = useObjectUrl(media?.blob)
  const place = describePlace(location, placeName)
  return (
    <LcdPanel title={t('result.meta.title')} className="bd-result-meta" data-testid="result-meta">
      {media?.kind === 'image' && url ? <img className="bd-result-meta__image" src={url} alt={t('result.meta.photoAlt')} data-testid="result-image" /> : null}
      {media?.kind === 'audio' && url ? (
        <div className="bd-result-meta__audio">
          <audio controls preload="metadata" src={url} aria-label={t('result.meta.clipLabel')} data-testid="result-audio" />
        </div>
      ) : null}
      <dl className="bd-result-meta__list">
        <div>
          <dt>
            <Icon name="calendar" size={20} />
            {t('result.meta.when')}
          </dt>
          <dd data-testid="result-when">
            {formatDate(createdAt)} · {formatTime(createdAt)}
          </dd>
        </div>
        <div>
          <dt>
            <Icon name="location" size={20} />
            {t('result.meta.where')}
          </dt>
          <dd data-testid="result-where" data-kind={place.kind}>
            {place.text}
          </dd>
        </div>
      </dl>
      {place.kind === 'unknown' ? <p className="bd-result-meta__hint">{t('result.meta.noLocation')}</p> : null}
    </LcdPanel>
  )
}
