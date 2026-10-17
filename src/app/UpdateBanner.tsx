import { useLocation } from 'react-router-dom'
import { t } from '../i18n'
import { usePending } from '../state/pending'
import { useModelStatus } from '../state/modelStatus'
import { Button } from '../ui/Button'
import { applyWaitingUpdate, isSafeToReload, useUpdateWaiting } from './appUpdate'
import './UpdateBanner.css'

/**
 * "There is a new version". Shown only when a reload would not lose anything: not during a scan, a download or
 * while a result waits for the decision.
 */
export function UpdateBanner() {
  const waiting = useUpdateWaiting()
  const { pathname } = useLocation()
  const pending = usePending()
  const models = useModelStatus()
  if (!waiting) return null
  const safe = isSafeToReload({ path: pathname, hasPending: pending !== undefined, downloading: models?.state === 'downloading' })
  if (!safe) return null
  return (
    <div className="bd-update" role="status" data-testid="update-banner">
      <p className="bd-update__text">{t('common.update.available')}</p>
      <Button size="md" onClick={applyWaitingUpdate}>
        {t('common.reload')}
      </Button>
    </div>
  )
}
