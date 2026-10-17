// Types of the reference photo service: a picture of a species from Wikipedia, with the credit the app has to show.

export interface ReferencePhoto {
  speciesId: string
  /** The small picture (about 330 px wide), for lists. */
  thumbnailUrl: string
  /** A larger picture for the detail screen. It is the thumbnail address asked for a wider size, or the thumbnail itself. */
  imageUrl: string
  /** Who took the picture. Empty when Wikimedia Commons does not say; the screen then shows "unknown author". */
  author: string
  /** "CC BY-SA 4.0", "CC BY 2.0", "CC0" or "Public domain". Only these kinds of licences are ever used. */
  licence: string
  /** The file page on Wikimedia Commons, where the credit and the licence text live. */
  link: string
}

export type PhotoLookupFailure = 'offline' | 'network' | 'paused' | 'bad-response'

/**
 * A lookup could not be finished (no network, a server problem, the service pausing after many failures).
 * It says nothing about the species: ask again later. "This bird has no usable photo" is a normal answer (null), not an error.
 */
export class PhotoLookupError extends Error {
  readonly reason: PhotoLookupFailure
  constructor(reason: PhotoLookupFailure, message?: string, options?: { cause?: unknown }) {
    super(message ?? `Reference photo lookup failed (${reason})`, options)
    this.name = 'PhotoLookupError'
    this.reason = reason
  }
}
