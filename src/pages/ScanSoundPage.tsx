// Scan by sound: a big key starts the microphone, the level and the top guesses move while it listens, Done opens the result.
import { Link } from 'react-router-dom'
import { useDeviceActivity } from '../app/deviceStatus'
import { ROUTES } from '../app/routes'
import { useSpecies } from '../data/useSpecies'
import { catchRule } from '../domain/thresholds'
import { classifyScanError, isPermissionError, scanErrorText } from '../features/scan/errors'
import { formatElapsed } from '../features/scan/format'
import { GuessList } from '../features/scan/GuessList'
import { ModelBanner } from '../features/scan/ModelBanner'
import { PermissionHelp } from '../features/scan/PermissionHelp'
import { RecordButton } from '../features/scan/RecordButton'
import { isScanning, SOUND_LIMIT_MS } from '../features/scan/soundScan'
import { useModelReadiness } from '../features/scan/useModelReadiness'
import { useSoundScan } from '../features/scan/useSoundScan'
import { useTicker } from '../features/scan/useTicker'
import '../features/scan/scan.css'
import { t } from '../i18n'
import { Button, ButtonLink, LcdPanel, LevelMeter, Notice, Page, PageHeader, cx } from '../ui'
import { useSettings } from '../state/settings'

export default function ScanSoundPage() {
  const readiness = useModelReadiness('sound')
  const scan = useSoundScan()
  const { species } = useSpecies()
  const { settings } = useSettings()
  const { state } = scan

  const scanning = isScanning(state)
  const now = useTicker(scanning)
  const elapsedMs = state.startedAt !== undefined && scanning ? Math.min(SOUND_LIMIT_MS, Math.max(0, now - state.startedAt)) : 0

  useDeviceActivity(state.phase === 'listening' ? 'listening' : state.phase === 'starting' || state.phase === 'stopping' ? 'busy' : null)

  const ready = readiness.view.phase === 'ready'
  const threshold = catchRule('sound', settings.sensitivity).minConfidence
  const failed = state.phase === 'error'
  const paused = state.phase === 'paused'

  return (
    <Page className="bd-scan bd-scan-sound">
      <PageHeader title={t('scan.sound.title')} backTo={ROUTES.scan} />

      <ModelBanner readiness={readiness} kind="sound" variant="gate" />

      {failed ? <SoundFailure kind={state.error ?? 'generic'} onRetry={scan.start} /> : null}

      {paused ? (
        <Notice
          tone="warning"
          title={t('scan.sound.paused.title')}
          action={
            <div className="bd-scan-actions bd-scan-actions--row">
              {state.hasResult ? (
                <Button icon="check" onClick={scan.showPartial}>
                  {t('scan.sound.paused.showResult')}
                </Button>
              ) : null}
              <Button variant={state.hasResult ? 'secondary' : 'primary'} icon="microphone" onClick={scan.start}>
                {t('scan.sound.paused.again')}
              </Button>
            </div>
          }
        >
          {t(state.pauseReason === 'microphone' ? 'scan.sound.paused.microphone' : 'scan.sound.paused.hidden')}
        </Notice>
      ) : null}

      <LcdPanel tone="dark" className="bd-scan-display" aria-label={t('scan.sound.listening')}>
        <div className="bd-scan-display__row">
          {scanning || state.phase === 'stopping' ? (
            <span className={cx('bd-scan-bird', state.hearingBird && 'is-on')} role="status" data-testid="hearing-bird" data-on={state.hearingBird}>
              <i className="bd-scan-bird__led" aria-hidden="true" />
              {state.hearingBird ? t('scan.sound.heardBird') : t('scan.sound.noBird')}
            </span>
          ) : (
            <span className="bd-scan-bird">
              <i className="bd-scan-bird__led" aria-hidden="true" />
              {t('common.device.idle')}
            </span>
          )}
          <span className="bd-scan-time" role="timer" aria-label={t('scan.sound.elapsed')}>
            <span data-testid="elapsed">{formatElapsed(elapsedMs)}</span>
            <span className="bd-scan-time__limit" aria-hidden="true">
              {' / '}
              {formatElapsed(SOUND_LIMIT_MS)}
            </span>
          </span>
        </div>
        <LevelMeter level={state.level} segments={24} label={t('scan.sound.levelLabel')} />
      </LcdPanel>

      <LcdPanel title={t('scan.sound.topTitle')} className="bd-scan-guesses-panel">
        <GuessList candidates={state.candidates} species={species} threshold={threshold} empty={scanning ? t('scan.sound.nothingYet') : t('scan.sound.idleHint')} />
      </LcdPanel>

      {!failed && !paused ? (
        <div className={cx('bd-scan-controls', !ready && 'is-static')}>
          {state.phase === 'listening' ? (
            <RecordButton mode="stop" label={t('scan.sound.stop')} onClick={scan.stop} />
          ) : state.phase === 'starting' ? (
            <RecordButton mode="start" label={t('scan.sound.starting')} onClick={scan.start} busy />
          ) : state.phase === 'stopping' ? (
            <RecordButton mode="stop" label={t('scan.sound.stopping')} onClick={scan.stop} busy />
          ) : (
            <RecordButton mode="start" label={t('scan.sound.start')} onClick={scan.start} disabled={!ready} />
          )}
        </div>
      ) : null}
    </Page>
  )
}

function SoundFailure({ kind, onRetry }: { kind: ReturnType<typeof classifyScanError>; onRetry: () => void }) {
  const retry = (
    <Button icon="refresh" onClick={onRetry}>
      {t('common.retry')}
    </Button>
  )
  if (isPermissionError(kind)) {
    return (
      <PermissionHelp
        device="microphone"
        actions={
          <div className="bd-scan-actions bd-scan-actions--row">
            {retry}
            <ButtonLink to={ROUTES.scan} variant="secondary">
              {t('common.back')}
            </ButtonLink>
          </div>
        }
      />
    )
  }
  // Without a working microphone the photo screen is the way on.
  const photoInstead = kind === 'micMissing' || kind === 'unsupported'
  return (
    <Notice tone="error" title={t('common.errors.title')} action={retry}>
      <p>{scanErrorText(kind)}</p>
      {photoInstead ? (
        <p>
          <Link to={ROUTES.scanPhoto} className="bd-scan-link">
            {t('scan.toPhoto')}
          </Link>
        </p>
      ) : null}
    </Notice>
  )
}
