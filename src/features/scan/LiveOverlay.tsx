// The live camera in full screen: the picture fills the whole phone, with the Catch button, the guess and the zoom on top of
// it. It lives in its own layer over the device frame (a portal into <body>), because inside the small green screen the
// picture was too small to see a bird in. The video element is always here (hidden while the camera is off), so the scan hook
// has it ready when the camera question has been answered.

import { createPortal } from 'react-dom'
import type { RefObject } from 'react'
import { displayName, getSpeciesById } from '../../data/species'
import { useSpecies } from '../../data/useSpecies'
import { formatPercent, t } from '../../i18n'
import { Button, IconButton, Spinner, cx } from '../../ui'
import { MIN_SHOWN_CONFIDENCE } from './pendingBuilders'
import type { LiveScan } from './useLiveScan'
import { formatZoom } from './format'
import { zoomSteps } from './zoomMath'
import './live.css'

export interface LiveOverlayProps {
  scan: LiveScan
  video: RefObject<HTMLVideoElement | null>
  box: RefObject<HTMLDivElement | null>
}

/** "2,5×" with the multiplication sign drawn bigger: the pixel font has a tiny one that looks like a raised x. */
function ZoomLabel({ zoom }: { zoom: number }) {
  const text = formatZoom(zoom)
  return (
    <>
      {text.slice(0, -1)}
      <span className="bd-live__times">×</span>
    </>
  )
}

export function LiveOverlay({ scan, video, box }: LiveOverlayProps) {
  const { species } = useSpecies()
  const { state, zoom } = scan
  const starting = state.phase === 'starting'
  const cameraOn = starting || state.phase === 'running'
  const first = state.update?.candidates[0]
  const top = first && first.confidence >= MIN_SHOWN_CONFIDENCE ? first : undefined
  const topBird = top && species ? getSpeciesById(top.speciesId, species) : undefined
  const steps = zoom.state.ready ? zoomSteps(zoom.state.min, zoom.state.max) : []
  const zoomed = zoom.state.zoom > zoom.state.min + 0.05

  const layer = (
    <div
      ref={box}
      className={cx('bd-live', cameraOn && 'is-on')}
      data-testid="live-view"
      data-phase={state.phase}
      data-locked={scan.canCatch ? 'true' : undefined}
      data-zoom={zoom.state.zoom.toFixed(2)}
      data-zoom-mode={zoom.state.mode}
    >
      <video ref={video} className="bd-live__video" playsInline muted aria-label={t('scan.live.previewLabel')} data-testid="live-video" />

      {cameraOn ? (
        <>
          {/* The layer that takes the fingers: pinch to zoom, drag to move the zoomed picture. The buttons are above it. */}
          <div className="bd-live__touch" data-testid="live-touch" aria-hidden="true" {...zoom.gestures} />

          <div className="bd-scan-reticle" aria-hidden="true" data-testid="reticle">
            <i />
            <i />
            <i />
            <i />
          </div>

          <div className="bd-live__top">
            <IconButton icon="close" label={t('scan.live.stop')} onClick={scan.stop} />
            <span className={cx('bd-live__readout', zoomed && 'is-zoomed')} data-testid="zoom-readout" aria-label={t('scan.live.zoom.step', { zoom: formatZoom(zoom.state.zoom) })}>
              <ZoomLabel zoom={zoom.state.zoom} />
            </span>
          </div>

          <div className="bd-live__bottom">
            <div className="bd-scan-cam__info" role="status" data-testid="live-info">
              <span className={cx('bd-scan-cam__status', scan.canCatch && 'is-locked')} data-testid="live-status">
                {scan.canCatch ? t('scan.live.locked') : scan.lockedUnsure ? t('scan.live.lockedUnsure') : starting ? t('scan.live.starting') : t('scan.live.searching')}
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

            {steps.length > 0 ? (
              <div className="bd-live__zoom" role="group" aria-label={t('scan.live.zoom.label')} data-testid="zoom-controls">
                {steps.map((step) => (
                  <button
                    key={step}
                    type="button"
                    className={cx('bd-live__zoomstep', Math.abs(zoom.state.zoom - step) < 0.05 && 'is-active')}
                    aria-label={t('scan.live.zoom.step', { zoom: formatZoom(step) })}
                    aria-pressed={Math.abs(zoom.state.zoom - step) < 0.05}
                    data-testid={`zoom-step-${step}`}
                    onClick={() => zoom.setZoom(step)}
                  >
                    <ZoomLabel zoom={step} />
                  </button>
                ))}
              </div>
            ) : null}
            {zoom.state.ready && !zoomed ? <p className="bd-live__hint">{t('scan.live.zoom.hint')}</p> : null}

            <Button size="lg" icon="check" fullWidth disabled={!scan.canCatch} busy={state.catching} onClick={scan.catchNow} data-testid="live-catch">
              {t('scan.live.catch')}
            </Button>
            {!scan.canCatch ? <p className="bd-live__hint">{scan.lockedUnsure ? t('scan.live.unsureHint') : t('scan.live.catchWait')}</p> : null}
          </div>
        </>
      ) : null}
    </div>
  )

  return typeof document === 'undefined' ? null : createPortal(layer, document.body)
}
