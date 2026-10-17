// Scan with the live camera. While the camera is off this is a normal screen with a start button; once it is on, the
// camera takes the whole phone (LiveOverlay): a big picture with a reticle that locks on a bird, zoom, and a Catch button.
import { useRef } from 'react'
import { useDeviceActivity } from '../app/deviceStatus'
import { ROUTES } from '../app/routes'
import { isPermissionError, scanErrorText, type ScanErrorKind } from '../features/scan/errors'
import { LiveOverlay } from '../features/scan/LiveOverlay'
import { ModelBanner } from '../features/scan/ModelBanner'
import { PermissionHelp } from '../features/scan/PermissionHelp'
import { useLiveScan } from '../features/scan/useLiveScan'
import { useModelReadiness } from '../features/scan/useModelReadiness'
import '../features/scan/scan.css'
import { t } from '../i18n'
import { Button, ButtonLink, Icon, Notice, Page, PageHeader } from '../ui'

export default function ScanLivePage() {
  const readiness = useModelReadiness('live')
  const video = useRef<HTMLVideoElement>(null)
  const box = useRef<HTMLDivElement>(null)
  const scan = useLiveScan(video, box)
  const { state } = scan

  const cameraOn = state.phase === 'starting' || state.phase === 'running'
  const ready = readiness.view.phase === 'ready'

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

      {!cameraOn ? (
        <>
          <div className="bd-scan-cam" data-testid="live-idle">
            <div className="bd-scan-cam__idle">
              <Icon name="live" size={56} />
              <p>{t('scan.live.hint')}</p>
            </div>
          </div>
          <div className="bd-scan-actions">
            <Button size="lg" icon="live" fullWidth disabled={!ready} onClick={scan.start} data-testid="live-start">
              {t('scan.live.start')}
            </Button>
          </div>
        </>
      ) : null}

      <LiveOverlay scan={scan} video={video} box={box} />
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
