import { useRef } from 'react'
import type { PendingIdentification } from '../../domain/types'
import { ROUTES, birdPath } from '../../app/routes'
import { bpRangeOf, type BirdPoints } from '../../domain/birdPoints'
import { t } from '../../i18n'
import { ButtonLink, Chip, LcdPanel, Page, PageHeader } from '../../ui'
import { BpMeter } from '../birds/BpMeter'
import { CatchCelebration } from '../fun/CatchCelebration'
import { ReferencePhotoBox } from './ReferencePhotoBox'
import type { CandidateView } from './resultModel'
import { useObjectUrl } from './useObjectUrl'
import { useReferencePhoto } from './useReferencePhoto'
import { useScrollToTopOnMount } from './useScroll'

export interface SuccessViewProps {
  view: CandidateView
  /** The species was not in the Dex before this catch. */
  wasNew: boolean
  /** The photo or clip that was saved with the catch (the pending identification is gone by now). */
  media: PendingIdentification['media']
  /** The BirdPoints the bird got. */
  points: BirdPoints
  /** The id of the saved catch: "Zobrazit ptáka" opens its page. */
  catchId: string
}

/** After the catch: the bird, the celebration, its BirdPoints and the two ways on. */
export function SuccessView({ view, wasNew, media, points, catchId }: SuccessViewProps) {
  const savedImage = useObjectUrl(media?.kind === 'image' ? media.blob : undefined)
  const { photo } = useReferencePhoto(view.speciesId)
  // The result screen was probably scrolled down to its Catch button: the success screen starts at the top.
  const marker = useRef<HTMLSpanElement>(null)
  useScrollToTopOnMount(marker)
  return (
    <Page className="bd-result">
      <span ref={marker} hidden />
      <PageHeader title={t('result.title')} />
      <LcdPanel className="bd-result-success" data-testid="catch-success">
        <div className="bd-result-success__picture">
          <CatchCelebration rarity={view.rarity} isNew={wasNew} />
          {savedImage ? <img src={savedImage} alt="" className="bd-result-success__image" /> : <ReferencePhotoBox species={view.species} photo={photo} size={132} />}
        </div>
        <p className="bd-result-success__caught" data-testid="catch-message">
          {t('result.caught', { name: view.name })}
        </p>
        {view.scientificName ? <p className="bd-result-card__sci">{view.scientificName}</p> : null}
        <div className="bd-result-card__chips bd-result-success__chips">
          <Chip tone={view.rarity}>{t(`common.rarity.${view.rarity}` as const)}</Chip>
          <Chip tone={wasNew ? 'info' : 'success'} icon={wasNew ? 'bird' : 'check'}>
            {wasNew ? t('result.success.newSpecies') : t('result.success.again')}
          </Chip>
        </div>
        <BpMeter bp={points.bp} range={bpRangeOf(view.species)} base={points.base} />
      </LcdPanel>
      <div className="bd-scan-actions">
        <ButtonLink to={birdPath(catchId)} size="lg" icon="bird" fullWidth data-testid="to-bird">
          {t('result.success.toBird')}
        </ButtonLink>
        <ButtonLink to={ROUTES.scan} variant="secondary" icon="scan" fullWidth data-testid="scan-next">
          {t('result.success.scanNext')}
        </ButtonLink>
      </div>
    </Page>
  )
}
