// Zoom for the live camera: the arithmetic of a zoomed and moved view, and which part of the camera picture it shows.
// Pure functions, so they are unit-tested without a camera. ZoomController (zoomController.ts) applies them.
//
// The picture is shown with object-fit: cover in a box (the whole screen). Zooming scales that box content about its middle
// and moves it, so the view is described by a zoom factor and a "pan": where the middle of the view sits, measured from the
// middle of the box in fractions of the box width and height (so it survives a turn of the phone).

import type { FrameView } from '../../domain/engines'

export interface Size {
  width: number
  height: number
}

/** Where the middle of the view is, from the middle of the box, as a fraction of the box width and height. */
export interface Pan {
  x: number
  y: number
}

export const NO_PAN: Pan = { x: 0, y: 0 }

/** The smallest and largest digital zoom. Beyond 6 times the picture is only bigger pixels. */
export const MIN_ZOOM = 1
export const MAX_DIGITAL_ZOOM = 6

/** The buttons offered for quick zooming (those the camera can reach are shown). */
const QUICK_ZOOMS = [1, 2, 3, 5, 8] as const

export const clamp = (value: number, low: number, high: number): number => Math.min(high, Math.max(low, value))

/** How far the middle of the view may be from the middle of the box before the edge of the picture shows. */
export function maxPan(zoom: number): number {
  return Math.max(0, 1 - 1 / Math.max(1, zoom)) / 2
}

export function clampPan(zoom: number, pan: Pan): Pan {
  const limit = maxPan(zoom)
  return { x: clamp(pan.x, -limit, limit), y: clamp(pan.y, -limit, limit) }
}

/**
 * The CSS transform that shows the view: the content is scaled about the middle of the box and moved so that the middle of the
 * view lands in the middle of the box. Percentages are of the element itself, so no pixel sizes are needed.
 */
export function cssTransform(zoom: number, pan: Pan): string {
  if (!(zoom > 1)) return 'none'
  const round = (value: number) => Math.round(value * 1000) / 1000
  return `translate(${round(-zoom * pan.x * 100)}%, ${round(-zoom * pan.y * 100)}%) scale(${round(zoom)})`
}

/** The zoom after a pinch: the distance between the fingers now, against the distance when they went down. */
export function pinchZoom(startZoom: number, startDistance: number, distance: number, low: number, high: number): number {
  if (!(startDistance > 0) || !(distance > 0)) return clamp(startZoom, low, high)
  return clamp((startZoom * distance) / startDistance, low, high)
}

/** The pan after dragging the picture by (dx, dy) screen pixels: the picture follows the finger, so the view moves the other way. */
export function dragPan(start: Pan, dx: number, dy: number, zoom: number, box: Size): Pan {
  if (!(box.width > 0) || !(box.height > 0) || !(zoom > 1)) return clampPan(zoom, start)
  return clampPan(zoom, { x: start.x - dx / (zoom * box.width), y: start.y - dy / (zoom * box.height) })
}

/** How many frame pixels one box pixel is when the frame is scaled to cover the box. */
function coverScale(frame: Size, box: Size): number {
  return Math.max(box.width / frame.width, box.height / frame.height)
}

/**
 * The part of the camera picture the view shows, as fractions of the frame: this is what the scanner analyses and what is
 * saved with a catch, so it is exactly what the person sees. Undefined when there is nothing to cut (no zoom, or the sizes
 * are not known yet).
 */
export function viewOfFrame(zoom: number, pan: Pan, frame: Size, box: Size): FrameView | undefined {
  if (!(zoom > 1) || !(frame.width > 0) || !(frame.height > 0) || !(box.width > 0) || !(box.height > 0)) return undefined
  const scale = coverScale(frame, box)
  const width = box.width / (scale * zoom)
  const height = box.height / (scale * zoom)
  const centreX = frame.width / 2 + (pan.x * box.width) / scale
  const centreY = frame.height / 2 + (pan.y * box.height) / scale
  const w = Math.min(1, width / frame.width)
  const h = Math.min(1, height / frame.height)
  return {
    x: clamp(centreX / frame.width - w / 2, 0, 1 - w),
    y: clamp(centreY / frame.height - h / 2, 0, 1 - h),
    width: w,
    height: h,
  }
}

/** The quick-zoom buttons for a camera that reaches from `low` to `high`; none when there is nothing to choose from. */
export function zoomSteps(low: number, high: number): number[] {
  const steps = QUICK_ZOOMS.filter((step) => step >= low - 1e-6 && step <= high + 1e-6)
  return steps.length > 1 ? steps : []
}
