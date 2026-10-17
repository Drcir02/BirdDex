import type { ReactNode } from 'react'
import { t } from '../../i18n'
import { Button, Icon, Spinner, cx, type IconName } from '../../ui'
import { scanErrorText } from './errors'
import { approxMegabytes, wholeMegabytes } from './format'
import type { ReadinessKind } from './modelReadiness'
import { ProgressBar } from './ProgressBar'
import type { ModelReadiness } from './useModelReadiness'

export interface ModelBannerProps {
  readiness: ModelReadiness
  kind: ReadinessKind
  /**
   * hub: always shown, also says that all is well.
   * gate: a scan screen's "the engine is not ready yet" message; shows nothing once the engine is ready.
   */
  variant: 'hub' | 'gate'
}

const NEEDED_TEXT = {
  all: 'scan.models.neededAll',
  sound: 'scan.models.neededSound',
  photo: 'scan.models.neededPhoto',
  live: 'scan.models.neededPhoto',
} as const

interface BannerProps {
  tone: 'info' | 'error'
  icon: IconName
  title: string
  children?: ReactNode
}

/** A framed message in the colour of its kind, with the full width for what is inside (a bar, a wide button). */
function Banner({ tone, icon, title, children }: BannerProps) {
  return (
    <section className={cx('bd-scan-banner', `bd-scan-banner--${tone}`)} role={tone === 'error' ? 'alert' : 'status'} data-testid="model-banner" data-tone={tone}>
      <h2 className="bd-scan-banner__title">
        <Icon name={icon} size={24} />
        <span>{title}</span>
      </h2>
      {children}
    </section>
  )
}

/**
 * The "bird brain" message: the first time it offers the download (about 90 MB, best on Wi-Fi), then shows the progress,
 * and it offers "try again" when the download fails. Once everything is on the phone, the app works without internet.
 */
export function ModelBanner({ readiness, kind, variant }: ModelBannerProps) {
  const { view, start } = readiness

  switch (view.phase) {
    case 'checking':
      return (
        <p className="bd-scan-quiet" role="status">
          <Spinner size="sm" label={null} />
          <span>{t('scan.models.checking')}</span>
        </p>
      )

    case 'needed': {
      const size = approxMegabytes(view.needBytes || view.totalBytes)
      return (
        <Banner tone="info" icon="download" title={t('scan.models.title')}>
          <p>{t(NEEDED_TEXT[kind])}</p>
          <Button fullWidth icon="download" onClick={start} data-testid="model-download">
            {t('scan.models.download')}
          </Button>
          {size > 0 ? <p className="bd-scan-banner__size">{t('scan.models.downloadSize', { size })}</p> : null}
        </Banner>
      )
    }

    case 'working':
      if (view.stage === 'downloading' && view.totalBytes > 0 && view.loadedBytes < view.totalBytes) {
        return (
          <Banner tone="info" icon="download" title={t('scan.models.downloading')}>
            <ProgressBar value={view.fraction} label={t('scan.models.progressLabel')} />
            <p className="bd-scan-banner__size" aria-hidden="true">
              {t('scan.models.progress', { loaded: wholeMegabytes(view.loadedBytes), total: wholeMegabytes(view.totalBytes) })}
            </p>
            <p className="bd-scan-banner__size">{t('scan.models.keepOpen')}</p>
          </Banner>
        )
      }
      return (
        <p className="bd-scan-quiet" role="status">
          <Spinner size="sm" label={null} />
          <span>{t('scan.models.preparing')}</span>
        </p>
      )

    case 'error':
      return (
        <Banner tone="error" icon="warning" title={t('common.errors.title')}>
          <p>{scanErrorText(view.error ?? 'generic')}</p>
          <Button fullWidth icon="refresh" onClick={start} data-testid="model-retry">
            {t('common.retry')}
          </Button>
        </Banner>
      )

    case 'ready':
      if (variant === 'gate') return null
      return (
        <p className="bd-scan-ready" role="status" data-testid="model-ready">
          <Icon name="check" size={20} />
          <span>{t('scan.models.ready')}</span>
        </p>
      )
  }
}
