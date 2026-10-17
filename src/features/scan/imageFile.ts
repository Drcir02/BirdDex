// Opening a photo for the photo screen, and cutting the part that is identified and saved. Needs a browser (canvas).
//
//   const working = await openImageFile(file)        // decoded, turned upright, scaled to at most WORKING_SIDE pixels
//   const picture = cropToCanvas(working, crop)      // the part to identify, at most SAVED_SIDE pixels
//   const jpeg = await canvasToJpeg(picture)         // the file that is saved with the catch
//
// The EXIF rotation of a phone photo is applied while decoding (createImageBitmap with "from-image", or the <img>
// element, which turns the picture by itself in every current browser), so a photo taken upright is upright here.
// The original, full-size bitmap lives only for the moment of drawing it small: a 48 megapixel photo would otherwise
// sit in memory as 190 MB.

import { cropToPixels, type CropRect } from './cropMath'
import { fitWithin, looksLikeHeic, planHalvingSteps, SAVED_JPEG_QUALITY, SAVED_SIDE, WORKING_SIDE, type Size } from './imageSizing'

export type ImageFileProblem = 'heic' | 'unreadable'

/** The photo could not be opened. `problem` picks the Czech message. */
export class ImageFileError extends Error {
  readonly problem: ImageFileProblem
  constructor(problem: ImageFileProblem, options?: { cause?: unknown }) {
    super(problem === 'heic' ? 'This browser cannot open HEIC photos' : 'The photo could not be opened', options)
    this.name = 'ImageFileError'
    this.problem = problem
  }
}

type Decoded = { source: CanvasImageSource; width: number; height: number; close: () => void }

async function decode(file: Blob): Promise<Decoded> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
      return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() }
    } catch {
      // Some browsers do not know the option or the format: the <img> element below is the second way.
    }
  }
  const url = URL.createObjectURL(file)
  try {
    const image = new Image()
    image.decoding = 'async'
    image.src = url
    await image.decode()
    return { source: image, width: image.naturalWidth, height: image.naturalHeight, close: () => undefined }
  } finally {
    // A decoded image stays valid after its address is revoked.
    URL.revokeObjectURL(url)
  }
}

function makeCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}

function context2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = canvas.getContext('2d')
  if (!context) throw new Error('The browser gave no canvas to draw on')
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  return context
}

/** A canvas keeps its pixels until it is collected; shrinking it gives the memory back at once, which matters on iPhones. */
export function releaseCanvas(canvas: HTMLCanvasElement | undefined): void {
  if (!canvas) return
  canvas.width = 0
  canvas.height = 0
}

/** Draws a part of `source` into a new canvas of size `to`, in halving steps. The source is not touched. */
function drawScaled(source: CanvasImageSource, region: { sx: number; sy: number; sw: number; sh: number }, to: Size): HTMLCanvasElement {
  const steps = planHalvingSteps({ width: region.sw, height: region.sh }, to)
  let current: CanvasImageSource = source
  let currentRegion = region
  let previous: HTMLCanvasElement | undefined
  let canvas!: HTMLCanvasElement
  for (const step of steps) {
    canvas = makeCanvas(step.width, step.height)
    context2d(canvas).drawImage(current, currentRegion.sx, currentRegion.sy, currentRegion.sw, currentRegion.sh, 0, 0, step.width, step.height)
    releaseCanvas(previous)
    previous = canvas
    current = canvas
    currentRegion = { sx: 0, sy: 0, sw: step.width, sh: step.height }
  }
  return canvas
}

/**
 * Opens a photo: decodes it, turns it upright and scales it down to at most WORKING_SIDE pixels on the long side.
 * Throws ImageFileError('heic') for a HEIC file this browser cannot read, ImageFileError('unreadable') for anything else.
 */
export async function openImageFile(file: Blob & { name?: string }): Promise<HTMLCanvasElement> {
  let decoded: Decoded
  try {
    decoded = await decode(file)
  } catch (error) {
    throw new ImageFileError(looksLikeHeic({ type: file.type, name: file.name ?? '' }) ? 'heic' : 'unreadable', { cause: error })
  }
  try {
    if (!(decoded.width > 0) || !(decoded.height > 0)) throw new ImageFileError('unreadable')
    const size = fitWithin(decoded.width, decoded.height, WORKING_SIDE)
    return drawScaled(decoded.source, { sx: 0, sy: 0, sw: decoded.width, sh: decoded.height }, size)
  } catch (error) {
    throw error instanceof ImageFileError ? error : new ImageFileError('unreadable', { cause: error })
  } finally {
    decoded.close()
  }
}

/** The part of the working picture inside `crop`, scaled to at most `maxSide` pixels on the long side (a new canvas). */
export function cropToCanvas(source: HTMLCanvasElement, crop: CropRect, maxSide: number = SAVED_SIDE): HTMLCanvasElement {
  const region = cropToPixels(crop, source.width, source.height)
  const size = fitWithin(region.sw, region.sh, maxSide)
  return drawScaled(source, region, size)
}

export function canvasToJpeg(canvas: HTMLCanvasElement, quality: number = SAVED_JPEG_QUALITY): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('The browser could not make a JPEG'))), 'image/jpeg', quality)
  })
}
