// The one place where the scan screens get a reference photo of a species (to help the person compare it with the
// guess). It is a thin boundary on purpose: the screens only know this small shape, and the photo service behind it
// (src/features/photos, task S1: Wikipedia lookup, licence rules, cache) can change without touching them.
//
//   const { photo } = useReferencePhoto(species.id)    // photo is undefined while loading and when there is none: show the silhouette
//
// If the photo service is ever removed or renamed, this file is the only one to change: return `{ status: 'none' }`
// and every card shows the silhouette of the bird instead.

import { useReferencePhoto as useServicePhoto } from '../photos'

export interface ReferencePhotoInfo {
  /** The small picture, for the card. */
  url: string
  /** Who took it, and under which licence: the credit that has to be shown wherever the picture is shown. */
  author: string
  licence: string
  /** The page of the picture on Wikimedia Commons. */
  link: string
}

export interface ReferencePhotoResult {
  photo?: ReferencePhotoInfo
  status: 'loading' | 'ready' | 'none'
}

export function useReferencePhoto(speciesId: string | undefined): ReferencePhotoResult {
  const { photo, status } = useServicePhoto(speciesId)
  if (photo && status === 'ready') {
    return { status: 'ready', photo: { url: photo.thumbnailUrl, author: photo.author, licence: photo.licence, link: photo.link } }
  }
  return { status: status === 'loading' ? 'loading' : 'none' }
}
