// The maths of the optional crop on the photo screen: a box that is dragged and resized on top of the preview.
//
// The box is kept as fractions of the picture (0 to 1), so it does not depend on how big the preview is drawn. A drag
// arrives in pixels of the preview; the screen divides by the preview size and passes fractions here.
// The shape of this module (pure functions for drag, clamping and mapping to source pixels, tested apart from the DOM)
// follows WingDex's crop-math.ts (MIT licence); the rules are written for a box that can be dragged by its corners.

export interface CropRect {
  /** Left edge, 0 to 1. */
  x: number
  /** Top edge, 0 to 1. */
  y: number
  /** Width, 0 to 1. */
  w: number
  /** Height, 0 to 1. */
  h: number
}

export type CropHandle = 'move' | 'nw' | 'ne' | 'sw' | 'se' | 'n' | 'e' | 's' | 'w'

export interface CropLimits {
  /** The smallest width and height, as fractions of the picture. */
  minW: number
  minH: number
}

export const FULL_CROP: Readonly<CropRect> = Object.freeze({ x: 0, y: 0, w: 1, h: 1 })

const clamp = (value: number, low: number, high: number): number => Math.min(high, Math.max(low, value))

/**
 * The smallest box, as fractions, so that it is never smaller than `minPixels` on the screen and never larger than
 * half of the picture (a picture shown tiny must still allow a box that can be grabbed).
 */
export function minimumCropSize(displayWidth: number, displayHeight: number, minPixels = 72): CropLimits {
  const fraction = (pixels: number) => (pixels > 0 ? clamp(minPixels / pixels, 0.05, 0.5) : 0.5)
  return { minW: fraction(displayWidth), minH: fraction(displayHeight) }
}

/** Keeps a box inside the picture and at least as big as the limits. */
export function clampCrop(rect: CropRect, limits: CropLimits): CropRect {
  const w = clamp(Number.isFinite(rect.w) ? rect.w : 1, Math.min(limits.minW, 1), 1)
  const h = clamp(Number.isFinite(rect.h) ? rect.h : 1, Math.min(limits.minH, 1), 1)
  const x = clamp(Number.isFinite(rect.x) ? rect.x : 0, 0, 1 - w)
  const y = clamp(Number.isFinite(rect.y) ? rect.y : 0, 0, 1 - h)
  return { x, y, w, h }
}

/**
 * The box after dragging `handle` by (dx, dy), where the drag is given as fractions of the picture and measured from
 * where the drag began (`start`). Dragging a corner or an edge moves only the edges it touches; the opposite edges stay.
 * Dragging 'move' slides the whole box and stops at the border.
 */
export function dragCrop(start: CropRect, handle: CropHandle, dx: number, dy: number, limits: CropLimits): CropRect {
  const box = clampCrop(start, limits)
  if (handle === 'move') {
    return { x: clamp(box.x + dx, 0, 1 - box.w), y: clamp(box.y + dy, 0, 1 - box.h), w: box.w, h: box.h }
  }
  let left = box.x
  let top = box.y
  let right = box.x + box.w
  let bottom = box.y + box.h
  if (handle.includes('w')) left = clamp(left + dx, 0, right - limits.minW)
  if (handle.includes('e')) right = clamp(right + dx, left + limits.minW, 1)
  if (handle.includes('n')) top = clamp(top + dy, 0, bottom - limits.minH)
  if (handle.includes('s')) bottom = clamp(bottom + dy, top + limits.minH, 1)
  return { x: left, y: top, w: right - left, h: bottom - top }
}

/** True when the box covers (nearly) the whole picture, which means "no crop". */
export function isFullCrop(rect: CropRect, tolerance = 0.01): boolean {
  return rect.x <= tolerance && rect.y <= tolerance && rect.x + rect.w >= 1 - tolerance && rect.y + rect.h >= 1 - tolerance
}

export interface PixelRect {
  sx: number
  sy: number
  sw: number
  sh: number
}

/** The box as whole pixels of a picture of the given size: inside the picture, at least one pixel in each direction. */
export function cropToPixels(rect: CropRect, width: number, height: number): PixelRect {
  const full = isFullCrop(rect, 0.002)
  if (full) return { sx: 0, sy: 0, sw: Math.max(1, Math.round(width)), sh: Math.max(1, Math.round(height)) }
  const sx = clamp(Math.round(rect.x * width), 0, Math.max(0, Math.round(width) - 1))
  const sy = clamp(Math.round(rect.y * height), 0, Math.max(0, Math.round(height) - 1))
  const sw = clamp(Math.round(rect.w * width), 1, Math.max(1, Math.round(width) - sx))
  const sh = clamp(Math.round(rect.h * height), 1, Math.max(1, Math.round(height) - sy))
  return { sx, sy, sw, sh }
}

/** A pointer position (page coordinates) to a point in the picture as fractions, held inside the picture. */
export function pointToFraction(clientX: number, clientY: number, box: { left: number; top: number; width: number; height: number }): { x: number; y: number } {
  if (!(box.width > 0) || !(box.height > 0)) return { x: 0, y: 0 }
  return { x: clamp((clientX - box.left) / box.width, 0, 1), y: clamp((clientY - box.top) / box.height, 0, 1) }
}

export type NudgeKey = 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown'

const NUDGE_DIRECTIONS: Record<NudgeKey, readonly [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
}

export const isNudgeKey = (key: string): key is NudgeKey => key in NUDGE_DIRECTIONS

/** The keyboard way to drag: an arrow key moves the handle by `step` (a fraction of the picture). */
export function nudgeCrop(rect: CropRect, handle: CropHandle, key: NudgeKey, step: number, limits: CropLimits): CropRect {
  const [dx, dy] = NUDGE_DIRECTIONS[key]
  return dragCrop(rect, handle, dx * step, dy * step, limits)
}
