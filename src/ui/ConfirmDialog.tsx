import { useEffect, useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { t } from '../i18n'
import { Button } from './Button'
import { focusableWithin, nextFocusIndex } from './logic'
import './ConfirmDialog.css'

export interface ConfirmDialogProps {
  open: boolean
  title: string
  message?: ReactNode
  /** Default "Potvrdit". */
  confirmLabel?: string
  /** Default "Zrušit". */
  cancelLabel?: string
  /** danger makes the confirm button red and puts the first focus on Cancel, so a slip does no harm. */
  tone?: 'default' | 'danger'
  /** While the confirmed work runs: the buttons wait and Escape is ignored. */
  busy?: boolean
  onConfirm: () => void
  /** Called for the Cancel button, Escape and a tap outside the box. */
  onCancel: () => void
}

// Several dialogs can be open at once; the page behind stays inert until the last one closes.
let openDialogs = 0

/** A modal question with two answers. Focus stays inside, Escape cancels, focus returns to where it was. */
export function ConfirmDialog({ open, title, message, confirmLabel, cancelLabel, tone = 'default', busy = false, onConfirm, onCancel }: ConfirmDialogProps) {
  const titleId = useId()
  const messageId = useId()
  const boxRef = useRef<HTMLDivElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)
  // The effects below live as long as the dialog is open, so they read the newest values through refs.
  const busyRef = useRef(busy)
  const toneRef = useRef(tone)
  const onCancelRef = useRef(onCancel)
  useEffect(() => {
    busyRef.current = busy
    toneRef.current = tone
    onCancelRef.current = onCancel
  })

  // Focus the safe button, keep the page behind inert, and give focus back afterwards.
  useEffect(() => {
    if (!open) return
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const root = document.getElementById('root')
    openDialogs += 1
    if (root) root.inert = true
    ;(toneRef.current === 'danger' ? cancelRef : confirmRef).current?.focus()
    return () => {
      openDialogs -= 1
      if (root && openDialogs === 0) root.inert = false
      previous?.focus()
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        if (!busyRef.current) onCancelRef.current()
        return
      }
      if (event.key !== 'Tab') return
      const box = boxRef.current
      if (!box) return
      const items = focusableWithin(box)
      event.preventDefault()
      const target = nextFocusIndex(items.length, items.indexOf(document.activeElement as HTMLElement), event.shiftKey)
      items[target]?.focus()
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [open])

  if (!open) return null
  return createPortal(
    <div
      className="bd-dialog-scrim"
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy) onCancel()
      }}
    >
      <div ref={boxRef} className="bd-dialog bd-text" role="alertdialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={message ? messageId : undefined}>
        <h2 id={titleId} className="bd-dialog__title">
          {title}
        </h2>
        {message ? (
          <div id={messageId} className="bd-dialog__message">
            {message}
          </div>
        ) : null}
        <div className="bd-dialog__actions">
          <Button ref={cancelRef} variant="secondary" disabled={busy} onClick={onCancel}>
            {cancelLabel ?? t('common.cancel')}
          </Button>
          <Button ref={confirmRef} variant={tone === 'danger' ? 'danger' : 'primary'} busy={busy} onClick={onConfirm}>
            {confirmLabel ?? t('common.confirm')}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
