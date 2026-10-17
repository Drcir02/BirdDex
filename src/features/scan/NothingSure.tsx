import { Link } from 'react-router-dom'
import { ROUTES } from '../../app/routes'
import type { CatchMethod } from '../../domain/types'
import { t } from '../../i18n'
import { Button, Icon, LcdPanel, SpeciesSilhouette } from '../../ui'

export interface NothingSureProps {
  method: CatchMethod
  /** The scan had no guesses at all (nothing heard, no bird in the picture), not just weak ones. */
  empty: boolean
  onRetry: () => void
}

const TIPS = {
  sound: ['result.nothing.tipSound1', 'result.nothing.tipSound2', 'result.nothing.tipSound3'],
  photo: ['result.nothing.tipPhoto1', 'result.nothing.tipPhoto2', 'result.nothing.tipPhoto3'],
  live: ['result.nothing.tipLive1', 'result.nothing.tipLive2', 'result.nothing.tipLive3'],
} as const

/** "Nic jistého": friendly instead of blunt when no guess is sure enough, with tips for the next try. */
export function NothingSure({ method, empty, onRetry }: NothingSureProps) {
  return (
    <LcdPanel title={t('result.nothing.title')} className="bd-result-nothing" data-testid="nothing-sure">
      <div className="bd-result-nothing__head">
        <SpeciesSilhouette size={64} />
        <p>{empty ? t('result.nothing.empty') : t('result.nothing.text')}</p>
      </div>
      <h3 className="bd-result-nothing__tips-title">{t('result.nothing.tipsTitle')}</h3>
      <ul className="bd-result-nothing__tips">
        {TIPS[method].map((key) => (
          <li key={key}>{t(key)}</li>
        ))}
      </ul>
      <Button fullWidth icon="refresh" onClick={onRetry} data-testid="retry-scan">
        {t('result.nothing.retry')}
      </Button>
      <p className="bd-result-nothing__settings">
        <Icon name="settings" size={18} />
        <Link to={ROUTES.settings} className="bd-scan-link">
          {t('result.nothing.settings')}
        </Link>
      </p>
    </LcdPanel>
  )
}
