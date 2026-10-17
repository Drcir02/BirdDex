// Sizes and file checks for the photo screen. Pure functions; the canvas work that uses them is in imageFile.ts.
//
// A phone photo has 12 million pixels or more. The photo is never kept whole: it is scaled down once when it is opened
// (the "working picture", at most WORKING_SIDE pixels on the long side, which is also what the crop is taken from), and
// the picture that is identified and saved is scaled down again to at most SAVED_SIDE pixels, as a JPEG.

export interface Size {
  width: number
  height: number
}

/** The picture that is identified and saved with the catch: at most this many pixels on the long side. */
export const SAVED_SIDE = 1280
export const SAVED_JPEG_QUALITY = 0.85
/** The opened photo is kept at most this big, so a crop of it still has enough pixels and the phone does not run out of memory. */
export const WORKING_SIDE = 2048
/** A bigger file than this is not even tried: decoding it could take all the memory of the phone. */
export const MAX_FILE_BYTES = 60 * 1024 * 1024

/** The size that fits within `maxSide` on the long side, keeping the shape. Never enlarges; never below one pixel. */
export function fitWithin(width: number, height: number, maxSide: number): Size {
  const w = Math.max(1, Math.round(width))
  const h = Math.max(1, Math.round(height))
  const long = Math.max(w, h)
  if (!(maxSide > 0) || long <= maxSide) return { width: w, height: h }
  const scale = maxSide / long
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) }
}

/**
 * The sizes to draw in when scaling `from` down to `to`: each step at most halves the picture, and the last one is
 * `to` itself. One big step would make Safari's plain bilinear scaling skip pixels and the picture would look jagged.
 */
export function planHalvingSteps(from: Size, to: Size): Size[] {
  const steps: Size[] = []
  let current = from
  while (current.width >= to.width * 2 && current.height >= to.height * 2) {
    current = { width: Math.ceil(current.width / 2), height: Math.ceil(current.height / 2) }
    steps.push(current)
  }
  if (steps.length === 0 || current.width !== to.width || current.height !== to.height) steps.push(to)
  return steps
}

// ---------- Which files can be tried ----------

export interface FileFacts {
  type: string
  name: string
  size: number
}

export type FileProblem = 'empty' | 'tooBig' | 'notImage'

const IMAGE_EXTENSIONS = /\.(jpe?g|png|webp|gif|bmp|avif|heic|heif|tiff?)$/i
const HEIC_EXTENSIONS = /\.(heic|heif)$/i

/** HEIC and HEIF: the format of iPhone photos. Safari opens it, other browsers cannot. */
export function looksLikeHeic(file: Pick<FileFacts, 'type' | 'name'>): boolean {
  return /^image\/(heic|heif)/i.test(file.type) || HEIC_EXTENSIONS.test(file.name)
}

/**
 * Whether a chosen file is worth trying to open. A file with no type at all is tried (some Android file pickers give
 * none); a file that says it is a video or a document is not.
 */
export function checkImageFile(file: FileFacts): FileProblem | undefined {
  if (file.size <= 0) return 'empty'
  if (file.size > MAX_FILE_BYTES) return 'tooBig'
  if (file.type !== '' && !file.type.toLowerCase().startsWith('image/')) return 'notImage'
  if (file.type === '' && !IMAGE_EXTENSIONS.test(file.name)) return 'notImage'
  return undefined
}
