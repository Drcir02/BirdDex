import { useRef } from 'react'
import { Link } from 'react-router-dom'
import type { PendingIdentification, Rarity } from '../../domain/types'
import { RARITIES } from '../../data/species'
import { bpRangeOf } from '../../domain/birdPoints'
import { ROUTES, birdPath } from '../../app/routes'
import { t } from '../../i18n'
import { ButtonLink, Chip, LcdPanel, Page, PageHeader } from '../../ui'
import { BpMeter } from '../birds/BpMeter'
import { CatchCelebration } from '../fun/CatchCelebration'
import { ShareControl } from '../group/ShareControl'
import type { CaughtBird } from './caught'
import type { CandidateView } from './resultModel'
import { useObjectUrl } from './useObjectUrl'
import { useScrollToTopOnMount } from './useScroll'

export interface ManySuccessViewProps {
  /** The birds that were caught together, strongest first. */
  birds: readonly CaughtBird[]
  /** The photo or clip that was saved with them (the pending identification is gone by now). */
  media: PendingIdentification['media']
}

/** The rarest of the birds: the celebration is as big as the best catch of the lot. */
export function rarestOf(views: readonly CandidateView[]): Rarity {
  return views.reduce<Rarity>((best, view) => (RARITIES.indexOf(view.rarity) > RARITIES.indexOf(best) ? view.rarity : best), 'common')
}

/** After catching several birds at once: one celebration, the list of the birds (each opens its page) and the two ways on. */
export function ManySuccessView({ birds, media }: ManySuccessViewProps) {
  const views = birds.map((bird) => bird.view)
  const savedImage = useObjectUrl(media?.kind === 'image' ? media.blob : undefined)
  const marker = useRef<HTMLSpanElement>(null)
  useScrollToTopOnMount(marker)
  const anyNew = views.some((view) => view.timesCaught === 0)
  return (
    <Page className="bd-result">
      <span ref={marker} hidden />
      <PageHeader title={t('result.title')} />
      <LcdPanel className="bd-result-success" data-testid="catch-many-success">
        <div className="bd-result-success__picture">
          <CatchCelebration rarity={rarestOf(views)} isNew={anyNew} />
          {savedImage ? <img src={savedImage} alt="" className="bd-result-success__image" /> : null}
        </div>
        <p className="bd-result-success__caught" data-testid="catch-message">
          {t('result.many.caught', { count: views.length })}
        </p>
        <ul className="bd-result-many" aria-label={t('result.many.list')}>
          {birds.map(({ view, catchId, points }) => {
            const isNew = view.timesCaught === 0
            return (
              <li key={catchId} className="bd-result-many__item" data-testid="caught-bird" data-species={view.speciesId}>
                <Link className="bd-result-many__name" to={birdPath(catchId)}>
                  {view.name}
                </Link>
                {view.scientificName ? <span className="bd-result-card__sci">{view.scientificName}</span> : null}
                <span className="bd-result-card__chips bd-result-success__chips">
                  <Chip tone={view.rarity}>{t(`common.rarity.${view.rarity}` as const)}</Chip>
                  <Chip tone={isNew ? 'info' : 'success'} icon={isNew ? 'bird' : 'check'}>
                    {isNew ? t('result.card.newSpecies') : t('result.card.inDex')}
                  </Chip>
                </span>
                <BpMeter bp={points.bp} range={bpRangeOf(view.species)} base={points.base} compact />
              </li>
            )
          })}
        </ul>
      </LcdPanel>
      <ShareControl catchIds={birds.map((bird) => bird.catchId)} />
      <div className="bd-scan-actions">
        <ButtonLink to={ROUTES.birds} size="lg" icon="bird" fullWidth data-testid="to-birds">
          {t('result.many.toBirds')}
        </ButtonLink>
        <ButtonLink to={ROUTES.scan} variant="secondary" icon="scan" fullWidth data-testid="scan-next">
          {t('result.success.scanNext')}
        </ButtonLink>
      </div>
    </Page>
  )
}
