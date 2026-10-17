import { useRef, type KeyboardEvent, type PointerEvent } from 'react'
import { t } from '../../i18n'
import { cx } from '../../ui'
import { dragCrop, isFullCrop, isNudgeKey, minimumCropSize, nudgeCrop, type CropHandle, type CropRect } from './cropMath'

export interface CropBoxProps {
  rect: CropRect
  onChange: (rect: CropRect) => void
  disabled?: boolean
}

type CornerHandle = 'nw' | 'ne' | 'sw' | 'se'

const CORNERS: ReadonlyArray<{ handle: CornerHandle; label: 'scan.photo.cropCornerNw' | 'scan.photo.cropCornerNe' | 'scan.photo.cropCornerSw' | 'scan.photo.cropCornerSe' }> = [
  { handle: 'nw', label: 'scan.photo.cropCornerNw' },
  { handle: 'ne', label: 'scan.photo.cropCornerNe' },
  { handle: 'sw', label: 'scan.photo.cropCornerSw' },
  { handle: 'se', label: 'scan.photo.cropCornerSe' },
]

interface Drag {
  handle: CropHandle
  pointerId: number
  startX: number
  startY: number
  start: CropRect
  width: number
  height: number
}

const KEY_STEP = 0.02
const KEY_STEP_BIG = 0.1

/**
 * The optional crop on the photo preview: a box that is dragged by its body and resized by its four corners.
 * It sits on top of the picture (the parent has exactly the picture's shape) and keeps its position as fractions of the
 * picture. Pointer events with pointer capture, so a finger or a mouse that leaves the box keeps dragging it.
 * The arrow keys do the same for the keyboard: on the box they move it, on a corner they resize it (Shift = bigger steps).
 */
export function CropBox({ rect, onChange, disabled = false }: CropBoxProps) {
  const layer = useRef<HTMLDivElement>(null)
  const drag = useRef<Drag | null>(null)
  const full = isFullCrop(rect)

  const begin = (handle: CropHandle) => (event: PointerEvent<HTMLElement>) => {
    if (disabled || (event.pointerType === 'mouse' && event.button !== 0)) return
    const bounds = layer.current?.getBoundingClientRect()
    if (!bounds || bounds.width <= 0 || bounds.height <= 0) return
    event.stopPropagation()
    // A box that covers the whole picture cannot move, so a touch on it should keep scrolling the screen.
    if (handle === 'move' && full) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { handle, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, start: rect, width: bounds.width, height: bounds.height }
  }

  const move = (event: PointerEvent<HTMLElement>) => {
    const active = drag.current
    if (!active || active.pointerId !== event.pointerId) return
    const limits = minimumCropSize(active.width, active.height)
    onChange(dragCrop(active.start, active.handle, (event.clientX - active.startX) / active.width, (event.clientY - active.startY) / active.height, limits))
  }

  const end = (event: PointerEvent<HTMLElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return
    drag.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }

  const key = (handle: CropHandle) => (event: KeyboardEvent<HTMLElement>) => {
    if (disabled || !isNudgeKey(event.key)) return
    const bounds = layer.current?.getBoundingClientRect()
    if (!bounds) return
    event.preventDefault()
    event.stopPropagation()
    onChange(nudgeCrop(rect, handle, event.key, event.shiftKey ? KEY_STEP_BIG : KEY_STEP, minimumCropSize(bounds.width, bounds.height)))
  }

  const pointerProps = (handle: CropHandle) => ({ onPointerDown: begin(handle), onPointerMove: move, onPointerUp: end, onPointerCancel: end, onKeyDown: key(handle) })

  return (
    <div ref={layer} className="bd-crop" data-testid="crop-layer">
      <div
        className={cx('bd-crop__box', full && 'is-full', disabled && 'is-disabled')}
        style={{ left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.w * 100}%`, height: `${rect.h * 100}%` }}
        tabIndex={disabled ? -1 : 0}
        role="group"
        aria-label={t('scan.photo.cropGroup')}
        title={t('scan.photo.cropMove')}
        data-testid="crop-box"
        {...pointerProps('move')}
      >
        {CORNERS.map(({ handle, label }) => (
          <button
            key={handle}
            type="button"
            className={`bd-crop__handle bd-crop__handle--${handle}`}
            aria-label={t(label)}
            disabled={disabled}
            data-testid={`crop-${handle}`}
            {...pointerProps(handle)}
          />
        ))}
      </div>
    </div>
  )
}
