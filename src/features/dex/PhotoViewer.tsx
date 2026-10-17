import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useMediaUrl } from '../../db'
import { t } from '../../i18n'
import { Icon } from '../../ui/icons'
import { Spinner } from '../../ui/Spinner'

export interface PhotoViewerProps {
  /** The saved photo (a row of the media table). */
  mediaId: string
  onClose: () => void
}

/**
 * A saved photo at full size on a dark background. Tap anywhere, press Escape or use the close button to leave.
 * Mount it only while it is open: the full-size picture is read from the database when it appears and released when it goes.
 * The page behind is made inert and the focus returns to where it was.
 */
export function PhotoViewer({ mediaId, onClose }: PhotoViewerProps) {
  const media = useMediaUrl(mediaId)
  const closeButton = useRef<HTMLButtonElement>(null)
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  })

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const root = document.getElementById('root')
    if (root) root.inert = true
    closeButton.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        onCloseRef.current()
      } else if (event.key === 'Tab') {
        // The close button is the only thing to reach, so the focus stays on it.
        event.preventDefault()
        closeButton.current?.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      if (root) root.inert = false
      previous?.focus()
    }
  }, [])

  return createPortal(
    <div
      className="bd-viewer"
      role="dialog"
      aria-modal="true"
      aria-label={t('dex.photo.viewerTitle')}
      data-testid="photo-viewer"
      onClick={onClose}
    >
      {media.url ? (
        <img className="bd-viewer__img" src={media.url} alt={t('dex.photo.altMine')} draggable={false} />
      ) : media.loading ? (
        <Spinner size="lg" label={t('common.loading')} />
      ) : (
        <p className="bd-viewer__message">{t('dex.photo.missing')}</p>
      )}
      <button
        ref={closeButton}
        type="button"
        className="bd-iconbtn bd-iconbtn--solid bd-viewer__close"
        aria-label={t('dex.photo.closeViewer')}
        title={t('dex.photo.closeViewer')}
        onClick={(event) => {
          event.stopPropagation()
          onClose()
        }}
      >
        <Icon name="close" size={24} />
      </button>
    </div>,
    document.body,
  )
}
