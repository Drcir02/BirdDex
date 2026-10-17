// Scan with the live camera: the camera picture with a reticle that locks on a bird, and a Catch button that wakes up then.
import { useRef } from 'react'
import { useDeviceActivity } from '../app/deviceStatus'
import { ROUTES } from '../app/routes'
import { displayName, getSpeciesById } from '../data/species'
import { useSpecies } from '../data/useSpecies'
import { isPermissionError, scanErrorText, type ScanErrorKind } from '../features/scan/errors'
import { ModelBanner } from '../features/scan/ModelBanner'
import { PermissionHelp } from '../features/scan/PermissionHelp'
import { MIN_SHOWN_CONFIDENCE } from '../features/scan/pendingBuilders'
import { useLiveScan } from '../features/scan/useLiveScan'
import { useModelReadiness } from '../features/scan/useModelReadiness'
import '../features/scan/scan.css'
import { formatPercent, t } from '../i18n'
import { Button, ButtonLink, Icon, Notice, Page, PageHeader, Spinner, cx } from '../ui'

export default function ScanLivePage() {
  const readiness = useModelReadiness('live')
  const video = useRef<HTMLVideoElement>(null)
  const scan = useLiveScan(video)
  const { species } = useSpecies()
  const { state } = scan

  const starting = state.phase === 'starting'
  const running = state.phase === 'running'
  const cameraOn = starting || running
  const ready = readiness.view.phase === 'ready'
  const lockedId = state.update?.lockedSpeciesId
  const first = state.update?.candidates[0]
  const top = first && first.confidence >= MIN_SHOWN_CONFIDENCE ? first : undefined
  const topBird = top && species ? getSpeciesById(top.speciesId, species) : undefined

  useDeviceActivity(cameraOn ? 'busy' : null)

  return (
    <Page className="bd-scan bd-scan-live">
      <PageHeader title={t('scan.live.title')} backTo={ROUTES.scan} />

      <ModelBanner readiness={readiness} kind="live" variant="gate" />

      {state.phase === 'stalled' ? (
        <Notice
          tone="warning"
          title={t('scan.live.stalled.title')}
          action={
            <div className="bd-scan-actions bd-scan-actions--row">
              <Button icon="refresh" onClick={scan.start}>
                {t('common.retry')}
              </Button>
              <ButtonLink to={ROUTES.scanPhoto} variant="secondary" icon="photo">
                {t('scan.toPhoto')}
              </ButtonLink>
            </div>
          }
        >
          {t('scan.live.stalled.text')}
        </Notice>
      ) : null}

      {state.phase === 'error' ? <LiveFailure kind={state.error ?? 'generic'} onRetry={scan.start} /> : null}

      {state.phase === 'paused' ? (
        <Notice tone="info" title={t('scan.live.stop')}>
          {t('scan.live.paused')}
        </Notice>
      ) : null}

      {state.snapshotFailed ? (
        <Notice tone="warning" title={t('common.errors.title')}>
          {t('scan.live.snapshotFailed')}
        </Notice>
      ) : null}

      <div className={cx('bd-scan-cam', cameraOn && 'is-on')} data-locked={lockedId ? 'true' : undefined} data-testid="live-view" data-phase={state.phase}>
        <video ref={video} className="bd-scan-cam__video" playsInline muted aria-label={t('scan.live.previewLabel')} data-testid="live-video" />

        {!cameraOn ? (
          <div className="bd-scan-cam__idle">
            <Icon name="live" size={56} />
            <p>{t('scan.live.hint')}</p>
          </div>
        ) : (
          <>
            <div className="bd-scan-reticle" aria-hidden="true" data-testid="reticle">
              <i />
              <i />
              <i />
              <i />
            </div>
            <div className="bd-scan-cam__info" role="status" data-testid="live-info">
              <span className={cx('bd-scan-cam__status', lockedId && 'is-locked')} data-testid="live-status">
                {lockedId ? t('scan.live.locked') : starting ? t('scan.live.starting') : t('scan.live.searching')}
              </span>
              {top ? (
                <span className="bd-scan-cam__guess" data-testid="live-guess">
                  <span className="bd-scan-cam__name">{topBird ? displayName(topBird) : '…'}</span>
                  <span className="bd-scan-cam__percent">{formatPercent(top.confidence)}</span>
                </span>
              ) : (
                <span className="bd-scan-cam__aim">{starting ? <Spinner size="sm" label={null} /> : t('scan.live.aim')}</span>
              )}
            </div>
          </>
        )}
      </div>

      <div className="bd-scan-actions">
        {cameraOn ? (
          <>
            <Button size="lg" icon="check" fullWidth disabled={!scan.canCatch} busy={state.catching} onClick={scan.catchNow} data-testid="live-catch">
              {t('scan.live.catch')}
            </Button>
            {!lockedId ? <p className="bd-scan-note bd-scan-note--center">{t('scan.live.catchWait')}</p> : null}
            <Button variant="secondary" icon="close" onClick={scan.stop}>
              {t('scan.live.stop')}
            </Button>
          </>
        ) : (
          <Button size="lg" icon="live" fullWidth disabled={!ready} onClick={scan.start} data-testid="live-start">
            {t('scan.live.start')}
          </Button>
        )}
      </div>
    </Page>
  )
}

function LiveFailure({ kind, onRetry }: { kind: ScanErrorKind; onRetry: () => void }) {
  const actions = (
    <div className="bd-scan-actions bd-scan-actions--row">
      <Button icon="refresh" onClick={onRetry}>
        {t('common.retry')}
      </Button>
      <ButtonLink to={ROUTES.scanPhoto} variant="secondary" icon="photo">
        {t('scan.toPhoto')}
      </ButtonLink>
    </div>
  )
  if (isPermissionError(kind)) return <PermissionHelp device="camera" actions={actions} />
  return (
    <Notice tone="error" title={t('common.errors.title')} action={actions}>
      {scanErrorText(kind)}
    </Notice>
  )
}
