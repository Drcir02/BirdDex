// Small pictures of the photos the person caught, for the cards of the Dex.
//
// A photo from a phone camera is several megabytes and thousands of pixels wide. Showing a few dozen of them in a grid
// would use hundreds of megabytes of memory on a cheap phone, so the grid shows small copies (about 400 px, a few tens of
// kilobytes). They are made one at a time, the first time a card needs one, and kept for as long as the app is open.

import { useEffect, useState } from 'react'
import { getMedia } from '../../db'

/** The longer side of a thumbnail, in pixels. A card is about 160 px wide, so this is sharp on a 2.5x screen. */
export const THUMBNAIL_SIDE = 400
/** A picture smaller than this is already small enough to show as it is. */
export const SMALL_ENOUGH_BYTES = 70 * 1024
const JPEG_QUALITY = 0.78

/** The size of a picture shrunk so that its longer side is at most `max` (never enlarged). */
export function fitWithin(width: number, height: number, max: number): { width: number; height: number } {
  if (!(width > 0) || !(height > 0)) return { width: 1, height: 1 }
  const scale = Math.min(1, max / Math.max(width, height))
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

type Draw = (blob: Blob) => Promise<Blob>

/**
 * Shrinks a picture with the browser's own decoder. It goes through an <img> element, which every browser draws the right
 * way up (the camera's orientation note, EXIF, is applied), and gives the memory back straight afterwards.
 */
export async function shrinkImage(blob: Blob, side: number = THUMBNAIL_SIDE, quality: number = JPEG_QUALITY): Promise<Blob> {
  const address = URL.createObjectURL(blob)
  try {
    const image = new Image()
    image.decoding = 'async'
    image.src = address
    await image.decode()
    const { width, height } = fitWithin(image.naturalWidth, image.naturalHeight, side)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('No 2D canvas')
    context.imageSmoothingQuality = 'high'
    context.drawImage(image, 0, 0, width, height)
    image.src = ''
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((result) => (result ? resolve(result) : reject(new Error('No picture'))), 'image/jpeg', quality))
  } finally {
    URL.revokeObjectURL(address)
  }
}

const shrinkWithBrowser: Draw = (blob) => shrinkImage(blob)

const urls = new Map<string, string | undefined>()
const pending = new Map<string, Promise<string | undefined>>()
let queue: Promise<unknown> = Promise.resolve()

/** The address of the small picture if it has been made already, undefined otherwise. */
export function peekThumbnail(mediaId: string): string | undefined {
  return urls.get(mediaId)
}

async function make(mediaId: string, draw: Draw): Promise<string | undefined> {
  const media = await getMedia(mediaId)
  if (!media || media.kind !== 'image') return undefined
  let blob: Blob = media.blob
  if (blob.size > SMALL_ENOUGH_BYTES) {
    try {
      blob = await draw(blob)
    } catch {
      // The browser could not shrink it (a format it cannot decode here): use the original, the <img> will cope.
      blob = media.blob
    }
  }
  return URL.createObjectURL(blob)
}

/**
 * A small version of a saved photo as an address for <img>. Made one at a time, so a fast scroll over many photos does
 * not freeze the phone. Resolves to undefined when the photo is gone or cannot be read.
 */
export function getThumbnail(mediaId: string, draw: Draw = shrinkWithBrowser): Promise<string | undefined> {
  const known = urls.get(mediaId)
  if (known) return Promise.resolve(known)
  let promise = pending.get(mediaId)
  if (!promise) {
    promise = queue.then(
      () => make(mediaId, draw),
      () => make(mediaId, draw),
    )
    queue = promise.catch(() => undefined)
    pending.set(mediaId, promise)
    promise
      .then((url) => {
        if (url) urls.set(mediaId, url)
      })
      .catch(() => undefined)
      .finally(() => pending.delete(mediaId))
  }
  return promise.catch(() => undefined)
}

/** Call this when a photo is deleted: the small copy is released. */
export function forgetThumbnail(mediaId: string): void {
  const url = urls.get(mediaId)
  if (url) URL.revokeObjectURL(url)
  urls.delete(mediaId)
  pending.delete(mediaId)
}

/** For tests. */
export function forgetAllThumbnails(): void {
  for (const mediaId of [...urls.keys()]) forgetThumbnail(mediaId)
  pending.clear()
  queue = Promise.resolve()
}

/** The small picture of a saved photo, once it is ready. Pass `enabled` false to wait (until the card is near the screen). */
export function useThumbnail(mediaId: string | undefined, enabled = true): string | undefined {
  const [made, setMade] = useState<{ mediaId: string; url: string | undefined } | undefined>()

  useEffect(() => {
    if (!mediaId || !enabled || urls.has(mediaId)) return undefined
    let alive = true
    void getThumbnail(mediaId).then((url) => {
      if (alive) setMade({ mediaId, url })
    })
    return () => {
      alive = false
    }
  }, [mediaId, enabled])

  if (!mediaId) return undefined
  return urls.get(mediaId) ?? (made?.mediaId === mediaId ? made.url : undefined)
}
