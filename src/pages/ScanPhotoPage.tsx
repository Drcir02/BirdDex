// Scan by photo: take a picture or pick one from the gallery, optionally drag a box around the bird, and let the app decide.
import { useRef, type CSSProperties } from 'react'
import { useDeviceActivity } from '../app/deviceStatus'
import { ROUTES } from '../app/routes'
import { CropBox } from '../features/scan/CropBox'
import { isFullCrop } from '../features/scan/cropMath'
import { scanErrorText } from '../features/scan/errors'
import { ModelBanner } from '../features/scan/ModelBanner'
import { PickButton } from '../features/scan/PickButton'
import { photoProblemKey } from '../features/scan/photoScan'
import { useModelReadiness } from '../features/scan/useModelReadiness'
import { usePhotoScan } from '../features/scan/usePhotoScan'
import { useScrollIntoViewWhen } from '../features/scan/useScroll'
import '../features/scan/scan.css'
import { t } from '../i18n'
import { Button, LcdPanel, Notice, Page, PageHeader, Spinner, cx } from '../ui'

export default function ScanPhotoPage() {
  const readiness = useModelReadiness('photo')
  const scan = usePhotoScan()
  const { state } = scan
  const ready = readiness.view.phase === 'ready'
  const busy = state.phase === 'identifying'
  const hasPicture = state.preview !== undefined && (state.phase === 'preview' || state.phase === 'identifying')
  const problemNotice = state.problem ? (
    <Notice tone="warning" title={t('common.errors.title')}>
      {t(photoProblemKey(state.problem))}
    </Notice>
  ) : null

  useDeviceActivity(busy ? 'busy' : null)

  // "Určit" is pressed in the bar at the bottom while the picture fills the screen: a failure is shown where the person can see it.
  const failureBox = useRef<HTMLDivElement>(null)
  useScrollIntoViewWhen(failureBox, state.failure !== undefined)

  return (
    <Page className="bd-scan bd-scan-photo-page">
      <PageHeader title={t('scan.photo.title')} subtitle={t('scan.photo.hint')} backTo={ROUTES.scan} />

      <ModelBanner readiness={readiness} kind="photo" variant="gate" />

      {/* Next to the buttons that were just pressed: at the top while the two buttons are all there is, below the picture otherwise. */}
      {!hasPicture ? problemNotice : null}

      {state.phase === 'choose' ? (
        <>
          <div className="bd-scan-choose">
            <PickButton icon="camera" label={t('scan.photo.take')} variant="primary" camera onFile={scan.open} testId="photo-take" />
            <PickButton icon="photo" label={t('scan.photo.pick')} onFile={scan.open} testId="photo-pick" />
          </div>
          <LcdPanel>
            <p className="bd-scan-note">{t('scan.photo.chooseHint')}</p>
          </LcdPanel>
        </>
      ) : null}

      {state.phase === 'opening' ? (
        <p className="bd-scan-quiet" role="status">
          <Spinner size="sm" label={null} />
          <span>{t('scan.photo.opening')}</span>
        </p>
      ) : null}

      {state.preview && hasPicture ? (
        <>
          <LcdPanel title={t('scan.photo.previewTitle')} className="bd-scan-previewpanel">
            <div className="bd-scan-photo" style={{ '--ar': state.preview.width / state.preview.height } as CSSProperties} data-testid="photo-preview" data-width={state.preview.width} data-height={state.preview.height}>
              <img className="bd-scan-photo__img" src={state.preview.url} alt={t('scan.photo.previewAlt')} draggable={false} />
              <CropBox rect={state.crop} onChange={scan.setCrop} disabled={busy} />
              {busy ? (
                <div className="bd-scan-photo__busy" role="status">
                  <Spinner size="lg" label={null} />
                  <span>{t('scan.photo.analysing')}</span>
                </div>
              ) : null}
            </div>
            <p className="bd-scan-note">{t('scan.photo.cropHint')}</p>
            <div className="bd-scan-actions">
              <Button variant="secondary" icon="refresh" onClick={scan.resetCrop} disabled={busy || isFullCrop(state.crop)}>
                {t('scan.photo.cropReset')}
              </Button>
              <PickButton icon="photo" label={t('scan.photo.other')} size="md" disabled={busy} onFile={scan.open} testId="photo-other" />
            </div>
            {problemNotice}
          </LcdPanel>

          {state.failure ? (
            <div ref={failureBox} className="bd-scan-scrollto">
              <Notice tone="error" title={t('common.errors.title')}>
                {scanErrorText(state.failure)}
              </Notice>
            </div>
          ) : null}

          {/* The main button stays at the bottom of the screen while the picture and its buttons scroll. */}
          <div className={cx('bd-scan-controls', 'bd-scan-controls--wide', !ready && 'is-static')}>
            <Button size="lg" icon="check" fullWidth busy={busy} disabled={!ready} onClick={scan.identify} data-testid="photo-identify">
              {t('scan.photo.identify')}
            </Button>
          </div>
        </>
      ) : null}
    </Page>
  )
}
