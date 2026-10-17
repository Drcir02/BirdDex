// Pictures to pixels, and pixels to JPEG: everything the vision engines do with canvases. Needs a browser.
//
// The model wants the shorter side at 248 pixels, produced by Pillow's resampler (preprocess.ts). A phone photo has 12
// million pixels, and feeding all of them through that resampler would take seconds, so the browser first scales the picture
// down to a shorter side of about 512 (320 for the live camera) with a canvas, in halving steps so that Safari's plain
// bilinear scaling does not alias; the exact resize to 248 then starts from that. WingDex does the same with a cap of 500
// pixels on the long side and measured no loss of accuracy; docs/notes/photo-engine.md has our own measurements.

import type { FrameView, ImageSource } from '../../domain/engines'
import { FRAME, LIVE } from './constants'
import { CLIP_RESIZE } from './preprocess'
import type { VisionFrame } from './core'

export interface Size {
  width: number
  height: number
}

/** Pixel size of any picture the engines accept. A video gives the size of its current frame. */
export function sourceSize(source: ImageSource): Size {
  const video = source as HTMLVideoElement
  if (typeof video.videoWidth === 'number' && 'videoHeight' in video) return { width: video.videoWidth, height: video.videoHeight }
  const image = source as HTMLImageElement
  if (typeof image.naturalWidth === 'number' && image.naturalWidth > 0) return { width: image.naturalWidth, height: image.naturalHeight }
  return { width: source.width, height: source.height }
}

/** A rectangle of a picture, in whole pixels. */
export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** The smallest part of a picture worth looking at, in pixels. */
const MIN_CROP = 32

/**
 * The part of a picture, in whole pixels, that a view given as fractions selects (the zoomed part of the live camera). No view
 * gives the whole picture. A tiny or odd view is kept inside the picture and never smaller than MIN_CROP pixels.
 */
export function cropRect(size: Size, view?: FrameView): Rect {
  const whole: Rect = { x: 0, y: 0, width: size.width, height: size.height }
  if (!view || !(size.width > 0) || !(size.height > 0)) return whole
  if (![view.x, view.y, view.width, view.height].every(Number.isFinite)) return whole
  const width = Math.min(size.width, Math.max(Math.min(MIN_CROP, size.width), Math.round(view.width * size.width)))
  const height = Math.min(size.height, Math.max(Math.min(MIN_CROP, size.height), Math.round(view.height * size.height)))
  const x = Math.min(size.width - width, Math.max(0, Math.round(view.x * size.width)))
  const y = Math.min(size.height - height, Math.max(0, Math.round(view.y * size.height)))
  return { x, y, width, height }
}

/**
 * How big the picture should be before the exact resize: the shorter side `shortSide` (never enlarged), the longer side at
 * most `maxLongSide`, but the shorter side never below the 248 pixels the model needs.
 */
export function planDownscale(width: number, height: number, shortSide: number = FRAME.photoShortSide, maxLongSide: number = FRAME.maxLongSide): Size {
  const short = Math.min(width, height)
  const long = Math.max(width, height)
  let scale = Math.min(1, shortSide / short)
  if (long * scale > maxLongSide) scale = maxLongSide / long
  scale = Math.max(scale, Math.min(1, CLIP_RESIZE / short))
  if (scale >= 1) return { width, height }
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

/** The sizes of the halving steps from the picture down to the target, the last one being the target itself. */
export function planSteps(from: Size, target: Size): Size[] {
  const steps: Size[] = []
  let current = from
  while (current.width >= target.width * 2 && current.height >= target.height * 2) {
    current = { width: Math.ceil(current.width / 2), height: Math.ceil(current.height / 2) }
    steps.push(current)
  }
  if (current.width !== target.width || current.height !== target.height || steps.length === 0) steps.push(target)
  return steps
}

type Context = CanvasRenderingContext2D

function makeCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}

function context(canvas: HTMLCanvasElement, readsPixels: boolean): Context {
  const ctx = canvas.getContext('2d', readsPixels ? { willReadFrequently: true } : undefined)
  if (!ctx) throw new Error('The browser gave no canvas to draw on')
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  return ctx
}

function release(canvas: HTMLCanvasElement): void {
  // A canvas keeps its pixel memory until it is collected; shrinking it gives the memory back at once (it matters on iOS).
  canvas.width = 0
  canvas.height = 0
}

/**
 * Draws `source` into a new canvas of the target size, in halving steps. With `rect`, only that part of the source is drawn
 * (`from` is then the size of the part). The caller releases the canvas.
 */
function drawScaled(source: CanvasImageSource, from: Size, target: Size, readsPixels: boolean, rect?: Rect): HTMLCanvasElement {
  let current: CanvasImageSource = source
  let temporary: HTMLCanvasElement | undefined
  let result: HTMLCanvasElement | undefined
  let first = true
  for (const step of planSteps(from, target)) {
    const canvas = makeCanvas(step.width, step.height)
    const last = step.width === target.width && step.height === target.height
    const ctx = context(canvas, readsPixels && last)
    if (first && rect) ctx.drawImage(current, rect.x, rect.y, rect.width, rect.height, 0, 0, step.width, step.height)
    else ctx.drawImage(current, 0, 0, step.width, step.height)
    first = false
    if (temporary) release(temporary)
    temporary = canvas
    current = canvas
    result = canvas
  }
  if (!result) throw new Error('Nothing to draw')
  return result
}

export interface GrabOptions {
  /** Default FRAME.photoShortSide. */
  shortSide?: number
  maxLongSide?: number
  /** Only this part of the picture is read (the zoomed part of the live camera). */
  view?: FrameView
}

/** Reads a picture (or the current frame of a video) as RGBA pixels at about the size the exact resize starts from. */
export function grabFrame(source: ImageSource, options: GrabOptions = {}): VisionFrame {
  const size = sourceSize(source)
  if (!(size.width > 0) || !(size.height > 0)) throw new Error('The picture has no pixels yet')
  const rect = options.view ? cropRect(size, options.view) : undefined
  const from: Size = rect ? { width: rect.width, height: rect.height } : size
  const target = planDownscale(from.width, from.height, options.shortSide, options.maxLongSide)
  const canvas = drawScaled(source as CanvasImageSource, from, target, true, rect)
  try {
    const { data } = context(canvas, true).getImageData(0, 0, target.width, target.height)
    return { data, width: target.width, height: target.height, channels: 4 }
  } finally {
    release(canvas)
  }
}

/** The live camera's version of grabFrame: smaller, because there is a frame every 0.7 seconds. */
export function grabLiveFrame(video: HTMLVideoElement, view?: FrameView): VisionFrame {
  return grabFrame(video, { shortSide: FRAME.liveShortSide, ...(view ? { view } : {}) })
}

export interface SnapshotOptions {
  maxSide?: number
  quality?: number
  /** Only this part of the picture is kept (the zoomed part of the live camera). */
  view?: FrameView
}

function toJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('The browser could not make a JPEG'))),
      'image/jpeg',
      quality,
    )
  })
}

/**
 * Copies a picture (a video frame, a bitmap, ...) into a canvas no bigger than `maxSide` on the long side and returns that
 * canvas. Used to keep the last live frame after the camera is switched off.
 */
export function copyToCanvas(source: ImageSource, maxSide: number = LIVE.snapshotMaxSide, view?: FrameView): HTMLCanvasElement {
  const size = sourceSize(source)
  if (!(size.width > 0) || !(size.height > 0)) throw new Error('The picture has no pixels yet')
  const rect = view ? cropRect(size, view) : undefined
  const from: Size = rect ? { width: rect.width, height: rect.height } : size
  const scale = Math.min(1, maxSide / Math.max(from.width, from.height))
  const target = { width: Math.max(1, Math.round(from.width * scale)), height: Math.max(1, Math.round(from.height * scale)) }
  return drawScaled(source as CanvasImageSource, from, target, false, rect)
}

/** A JPEG of a picture, scaled to at most `maxSide` on the long side. */
export async function snapshotJpeg(source: ImageSource, options: SnapshotOptions = {}): Promise<Blob> {
  const canvas = copyToCanvas(source, options.maxSide, options.view)
  try {
    return await toJpeg(canvas, options.quality ?? LIVE.snapshotQuality)
  } finally {
    release(canvas)
  }
}

/** A JPEG of a canvas made by copyToCanvas. The canvas stays usable. */
export function canvasToJpeg(canvas: HTMLCanvasElement, quality: number = LIVE.snapshotQuality): Promise<Blob> {
  return toJpeg(canvas, quality)
}

export { release as releaseCanvas }

/**
 * Decodes a picture file (a photo from the gallery or the camera) into something the engines accept. The browser applies the
 * EXIF rotation. Falls back to an <img> element where createImageBitmap cannot read the file.
 */
export async function decodeImageFile(file: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' })
    } catch {
      // Fall through to the image element.
    }
  }
  const url = URL.createObjectURL(file)
  try {
    const image = new Image()
    image.decoding = 'async'
    image.src = url
    await image.decode()
    return image
  } finally {
    // The decoded image stays valid after the address is revoked.
    URL.revokeObjectURL(url)
  }
}
