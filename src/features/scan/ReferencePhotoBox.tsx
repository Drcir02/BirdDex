import type { Species } from '../../domain/types'
import { SpeciesSilhouette } from '../../ui'
import type { ReferencePhotoInfo } from './useReferencePhoto'

export interface ReferencePhotoBoxProps {
  species: Species
  /** The reference photo, once it is known. Without one the box shows the silhouette of the bird. */
  photo?: ReferencePhotoInfo
  size?: number
}

/** The square picture on a result card: a reference photo of the species, or its silhouette while there is none. */
export function ReferencePhotoBox({ species, photo, size = 88 }: ReferencePhotoBoxProps) {
  return (
    <div className="bd-result-photo" style={{ width: size, height: size }} data-has-photo={photo ? 'true' : 'false'}>
      {photo ? (
        // Wikimedia asks for the credit wherever a picture is shown: the card prints it under the picture.
        <img src={photo.url} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" crossOrigin="anonymous" />
      ) : (
        <SpeciesSilhouette family={species.family} size="78%" />
      )}
    </div>
  )
}
