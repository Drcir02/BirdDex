import { useId } from 'react'
import { formatPercent, t } from '../../i18n'
import { Button, Chip, ConfidenceBar } from '../../ui'
import { ReferencePhotoBox } from './ReferencePhotoBox'
import { reasonKey, type CandidateView } from './resultModel'
import { useReferencePhoto } from './useReferencePhoto'

export interface ResultCardProps {
  view: CandidateView
  /** The least confidence the Catch button asks for. Drawn as a notch on the bar. */
  neededConfidence: number
  /** Works on the Catch button of this card (false while something is being saved). */
  enabled: boolean
  onCatch: (view: CandidateView) => void
}

/** One guess as an LCD card: reference photo, names, rarity, how sure, and the Catch button or the reason it is off. */
export function ResultCard({ view, neededConfidence, enabled, onCatch }: ResultCardProps) {
  const headingId = useId()
  const reasonId = useId()
  const { photo } = useReferencePhoto(view.speciesId)
  const credit = photo ? (photo.author ? t('result.card.photoCredit', { author: photo.author, licence: photo.licence }) : t('result.card.photoCreditNoAuthor', { licence: photo.licence })) : undefined

  return (
    <article className="bd-result-card" aria-labelledby={headingId} data-testid="result-card" data-species={view.speciesId} data-allowed={view.allowed ? 'true' : 'false'}>
      <div className="bd-result-card__top">
        <div className="bd-result-card__photo">
          <ReferencePhotoBox species={view.species} photo={photo} size={72} />
        </div>
        <div className="bd-result-card__text">
          <h2 id={headingId} className="bd-result-card__name" data-testid="candidate-name">
            {view.name}
          </h2>
          {view.scientificName ? <p className="bd-result-card__sci">{view.scientificName}</p> : null}
          <div className="bd-result-card__chips">
            <Chip tone={view.rarity}>{t(`common.rarity.${view.rarity}` as const)}</Chip>
            {view.timesCaught > 0 ? (
              <Chip tone="success" icon="check">
                {view.timesCaught > 1 ? t('result.card.inDexCount', { count: view.timesCaught }) : t('result.card.inDex')}
              </Chip>
            ) : (
              <Chip tone="info" icon="bird">
                {t('result.card.newSpecies')}
              </Chip>
            )}
          </div>
        </div>
      </div>

      <ConfidenceBar value={view.confidence} threshold={neededConfidence} label={`${view.name}: ${formatPercent(view.confidence)}`} />

      {view.allowed ? (
        <Button fullWidth icon="check" disabled={!enabled} onClick={() => onCatch(view)} data-testid="catch-button">
          {t('result.catch')}
        </Button>
      ) : (
        <div className="bd-result-card__blocked">
          {/* Not sure enough, but the person decides: the button works, and the confirmation says the app is unsure. */}
          <Button icon="check" variant="secondary" disabled={!enabled} aria-describedby={reasonId} onClick={() => onCatch(view)} data-testid="catch-button">
            {t('result.catch')}
          </Button>
          <p id={reasonId} className="bd-result-card__reason" data-testid="catch-reason">
            {view.reason ? t(reasonKey(view.reason), { needed: formatPercent(neededConfidence) }) : null}
          </p>
        </div>
      )}

      {credit && photo ? (
        <p className="bd-result-card__credit">
          <a href={photo.link} target="_blank" rel="noopener noreferrer">
            {credit}
          </a>
        </p>
      ) : null}
    </article>
  )
}
