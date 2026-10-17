// Reference photos of the birds, from Wikipedia and Wikimedia Commons, with the credit that goes with each.
//
//   const { photo, status } = useReferencePhoto(species.id)          // in a component
//   const photo = await getReferencePhoto('parus-major')             // anywhere else; ReferencePhoto or null
//
// A ReferencePhoto has thumbnailUrl and imageUrl (show them with crossOrigin="anonymous"), author, licence and link:
// the screen must show the author, the licence and the link wherever it shows the picture.

export { getReferencePhoto, isAbortError, peekReferencePhoto, referencePhotos, createReferencePhotoService } from './referencePhotos'
export type { GetOptions, PhotoCache, ReferencePhotoService, ReferencePhotoServiceOptions } from './referencePhotos'
export { useReferencePhoto } from './useReferencePhoto'
export type { ReferencePhotoState, ReferencePhotoStatus, UseReferencePhotoOptions } from './useReferencePhoto'
export { PhotoLookupError } from './types'
export type { PhotoLookupFailure, ReferencePhoto } from './types'
export { acceptLicence, cleanAuthor } from './licences'
export type { AcceptedLicence, LicenceKind } from './licences'
