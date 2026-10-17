import { useState } from 'react'
import { deleteCatch } from '../../db'
import type { CatchRecord } from '../../domain/types'
import { formatDateTime, t } from '../../i18n'
import { ConfidenceBar } from '../../ui/ConfidenceBar'
import { ConfirmDialog } from '../../ui/ConfirmDialog'
import { Icon } from '../../ui/icons'
import { IconButton } from '../../ui/IconButton'
import { useToast } from '../../ui/Toast'
import { AudioPlayer } from './AudioPlayer'
import { METHOD_ICON, mapUrl, placeOf, savesImage } from './format'
import { PhotoViewer } from './PhotoViewer'
import { forgetThumbnail, useThumbnail } from './thumbnails'

export interface CatchListProps {
  catches: readonly CatchRecord[]
}

/** Every catch of one bird, newest first: when, where, how, how sure, with the saved photo or recording and a delete button. */
export function CatchList({ catches }: CatchListProps) {
  const toast = useToast()
  const [viewing, setViewing] = useState<string | undefined>()
  const [removing, setRemoving] = useState<CatchRecord | undefined>()
  const [busy, setBusy] = useState(false)

  const confirmDelete = async () => {
    if (!removing || busy) return
    setBusy(true)
    try {
      await deleteCatch(removing.id)
      if (removing.mediaId) forgetThumbnail(removing.mediaId)
      toast.show(t('dex.deleted'), { tone: 'success' })
      setRemoving(undefined)
    } catch {
      toast.show(t('dex.deleteFailed'), { tone: 'error' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <ul className="bd-catches" data-testid="catch-list">
        {catches.map((record, index) => (
          <CatchItem key={record.id} record={record} index={catches.length - index} onOpenPhoto={setViewing} onDelete={setRemoving} />
        ))}
      </ul>
      {viewing ? <PhotoViewer mediaId={viewing} onClose={() => setViewing(undefined)} /> : null}
      <ConfirmDialog
        open={removing !== undefined}
        tone="danger"
        busy={busy}
        title={t('dex.deleteDialog.title')}
        message={<p>{t('dex.deleteDialog.message')}</p>}
        confirmLabel={t('dex.deleteDialog.confirm')}
        cancelLabel={t('dex.deleteDialog.cancel')}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setRemoving(undefined)}
      />
    </>
  )
}

interface CatchItemProps {
  record: CatchRecord
  /** 1 for the oldest catch of the bird. Only used to name the entry for screen readers. */
  index: number
  onOpenPhoto: (mediaId: string) => void
  onDelete: (record: CatchRecord) => void
}

function CatchItem({ record, index, onOpenPhoto, onDelete }: CatchItemProps) {
  const place = placeOf(record)
  const point = place.kind === 'none' ? undefined : place.point
  const hasPhoto = savesImage(record.method) && !!record.mediaId
  const hasClip = record.method === 'sound' && !!record.mediaId
  const thumbnail = useThumbnail(hasPhoto ? record.mediaId : undefined)
  const demo = record.id.startsWith('demo-')

  return (
    <li className="bd-catch" data-testid="catch-item" data-method={record.method} data-demo={demo || undefined} aria-label={t('dex.catches.entry', { index })}>
      <div className="bd-catch__head">
        <span className="bd-catch__method">
          <Icon name={METHOD_ICON[record.method]} size={22} />
          {t(`common.methods.${record.method}` as const)}
        </span>
        <IconButton variant="ghost" icon="trash" label={t('dex.catches.delete')} onClick={() => onDelete(record)} data-testid="catch-delete" />
      </div>

      <p className="bd-catch__when">
        <Icon name="calendar" size={20} />
        <time dateTime={new Date(record.caughtAt).toISOString()}>{formatDateTime(record.caughtAt)}</time>
        {demo ? <span className="bd-catch__demo">{t('dex.demo.demoTag')}</span> : null}
      </p>

      <p className="bd-catch__where">
        <Icon name="location" size={20} />
        {place.kind === 'none' ? <span className="bd-catch__muted">{t('dex.catches.noPlace')}</span> : <span>{place.text}</span>}
        {point ? (
          <a className="bd-catch__map" href={mapUrl(point)} target="_blank" rel="noopener noreferrer">
            {t('dex.catches.openMap')}
          </a>
        ) : null}
      </p>

      <ConfidenceBar value={record.confidence} className="bd-catch__confidence" />

      {record.note ? <p className="bd-catch__note">{record.note}</p> : null}

      {hasClip && record.mediaId ? <AudioPlayer mediaId={record.mediaId} className="bd-catch__audio" /> : null}
      {hasPhoto && record.mediaId ? (
        <button type="button" className="bd-catch__photo" onClick={() => onOpenPhoto(record.mediaId as string)} aria-label={t('dex.photo.enlarge')} data-testid="catch-photo">
          {thumbnail ? <img src={thumbnail} alt="" draggable={false} /> : <span className="bd-catch__photo-wait" />}
        </button>
      ) : null}
    </li>
  )
}
