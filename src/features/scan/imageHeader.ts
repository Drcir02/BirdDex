// Reads the size and the EXIF orientation of a JPEG or PNG from its first bytes, without decoding anything.
//
// Why: a phone photo has 12 million pixels or more. If the browser is told the size it should decode to
// (createImageBitmap with resizeWidth and resizeHeight), the full-size bitmap (48 MB for 12 megapixels, 190 MB for 48) never
// has to exist. To pick that size the shape of the picture *as it will be shown* is needed: a portrait photo is stored
// sideways with an EXIF orientation flag, and 5 to 8 swap width and height. Pure functions, tested on real phone files.

import type { Size } from './imageSizing'

export interface ImageHeader {
  /** The stored width and height, before the orientation is applied. */
  width: number
  height: number
  /** EXIF orientation, 1 to 8 (1 is upright, 6 and 8 are quarter turns). 1 when the file says nothing. */
  orientation: number
}

/** How many bytes from the start of the file are enough: EXIF sits first, and the frame header follows it. */
export const HEADER_BYTES = 256 * 1024

/** The size the picture has once it is upright. */
export function orientedSize(header: ImageHeader): Size {
  return header.orientation >= 5 && header.orientation <= 8 ? { width: header.height, height: header.width } : { width: header.width, height: header.height }
}

/** Reads the orientation from an EXIF block (the bytes after "Exif\0\0": a TIFF header). 1 when absent or odd. */
function orientationFromTiff(view: DataView, start: number, end: number): number {
  if (end - start < 8) return 1
  const order = view.getUint16(start)
  const little = order === 0x4949
  if (!little && order !== 0x4d4d) return 1
  if (view.getUint16(start + 2, little) !== 42) return 1
  const ifd = start + view.getUint32(start + 4, little)
  if (ifd < start || ifd + 2 > end) return 1
  const count = view.getUint16(ifd, little)
  for (let i = 0; i < count; i++) {
    const entry = ifd + 2 + i * 12
    if (entry + 12 > end) break
    if (view.getUint16(entry, little) === 0x0112) {
      const value = view.getUint16(entry + 8, little)
      return value >= 1 && value <= 8 ? value : 1
    }
  }
  return 1
}

function parseJpeg(bytes: Uint8Array): ImageHeader | undefined {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let orientation = 1
  let at = 2
  while (at + 4 <= bytes.length) {
    if (bytes[at] !== 0xff) {
      at++ // junk between segments: look for the next marker
      continue
    }
    const marker = bytes[at + 1]
    if (marker === 0xff) {
      at++ // fill byte
      continue
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      at += 2 // markers without a length
      continue
    }
    const length = view.getUint16(at + 2)
    if (length < 2) return undefined
    const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
    if (isFrame) {
      if (at + 9 > bytes.length) return undefined
      const height = view.getUint16(at + 5)
      const width = view.getUint16(at + 7)
      return width > 0 && height > 0 ? { width, height, orientation } : undefined
    }
    if (marker === 0xe1 && at + 10 <= bytes.length && bytes[at + 4] === 0x45 && bytes[at + 5] === 0x78 && bytes[at + 6] === 0x69 && bytes[at + 7] === 0x66) {
      // "Exif\0\0" and then the TIFF block; the first Exif block wins.
      if (orientation === 1) orientation = orientationFromTiff(view, at + 10, Math.min(bytes.length, at + 2 + length))
    }
    if (marker === 0xda) return undefined // image data starts and no frame header was seen
    at += 2 + length
  }
  return undefined
}

function parsePng(bytes: Uint8Array): ImageHeader | undefined {
  if (bytes.length < 24) return undefined
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (view.getUint32(12) !== 0x49484452) return undefined // "IHDR"
  const width = view.getUint32(16)
  const height = view.getUint32(20)
  return width > 0 && height > 0 ? { width, height, orientation: 1 } : undefined
}

/** The size and orientation of a JPEG or PNG, or undefined for anything else (WebP, HEIC, a damaged file): then nobody knows. */
export function parseImageHeader(bytes: Uint8Array): ImageHeader | undefined {
  try {
    if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) return parseJpeg(bytes)
    if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return parsePng(bytes)
  } catch {
    // A DataView read past the end: the file is cut short.
  }
  return undefined
}

/** Reads the header of a file or blob. Never throws. */
export async function readImageHeader(file: Blob): Promise<ImageHeader | undefined> {
  try {
    const buffer = await file.slice(0, HEADER_BYTES).arrayBuffer()
    return parseImageHeader(new Uint8Array(buffer))
  } catch {
    return undefined
  }
}
