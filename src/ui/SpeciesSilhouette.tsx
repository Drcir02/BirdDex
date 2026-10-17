import type { ReactNode } from 'react'
import { SONGBIRD_PATH, silhouetteShapeFor, type SilhouetteShape } from './silhouette'
import './SpeciesSilhouette.css'

// Generic bird outlines for species that are not caught yet. Drawn for this app on a 64 x 64 grid.
// They use the text colour (or `color`), so they can be tinted from CSS. The eye follows --sil-eye.

const SHAPES: Record<SilhouetteShape, ReactNode> = {
  songbird: (
    <>
      <path d={SONGBIRD_PATH} />
      <path className="bd-sil__line" d="M31 50v7M38 49v8" strokeWidth="2.4" />
      <path className="bd-sil__line" d="M22 58.5L60 55.5" strokeWidth="3" />
      <circle className="bd-sil__eye" cx="45.5" cy="19.5" r="1.9" />
    </>
  ),
  duck: (
    <>
      <path d="M3 32C12 38 28 37 38 33C41 28 42 22 43.5 17C44 10 48 7.5 51.5 8C55.5 8.5 58 12 57.5 15.5L63.5 16.6L63.8 20.2L57.2 20.8C55 23.5 54.5 27 55.8 30.2C59 34.5 58.5 44.5 49 49C38 52 18 51 10 46C6 43 4 38 3 32Z" />
      <path className="bd-sil__line" d="M2 56q6-3.5 12 0t12 0t12 0t12 0t12 0" strokeWidth="2.4" />
      <circle className="bd-sil__eye" cx="52" cy="14" r="1.8" />
    </>
  ),
  owl: (
    <>
      <ellipse cx="32" cy="40" rx="16.5" ry="18.5" />
      <ellipse cx="32" cy="23" rx="16" ry="14" />
      <path d="M16.5 22L14.5 5L28 13.5Z" />
      <path d="M47.5 22L49.5 5L36 13.5Z" />
      <circle className="bd-sil__eye" cx="25" cy="23" r="6.5" />
      <circle className="bd-sil__eye" cx="39" cy="23" r="6.5" />
      <circle cx="25.8" cy="23.4" r="3" />
      <circle cx="38.2" cy="23.4" r="3" />
      <path className="bd-sil__eye" d="M32 25.5L29 31.5H35Z" />
      <path className="bd-sil__line" d="M25 57.5v3.5M32 58v3.5M39 57.5v3.5" strokeWidth="2.4" />
      <path className="bd-sil__line" d="M14 61.5H50" strokeWidth="3" />
    </>
  ),
  raptor: (
    <>
      <path d="M43 6.5C48.5 6.5 52.5 9.6 53.4 14.4L53.8 15.2C55.4 17 56 19.4 55.4 22.8C54 21.4 52.2 20.8 50 20.8C51 24 51.4 28 51 32C50.4 40 46 46.4 40 51L28.5 55L14 60.5L11.5 56.2L21.5 40C24 31 27 19 32 12.5C34.8 8.6 38.4 6.5 43 6.5Z" />
      <path className="bd-sil__line" d="M36 51v6M42 49v8" strokeWidth="3" />
      <path className="bd-sil__line" d="M24 59L58 56.5" strokeWidth="3" />
      <circle className="bd-sil__eye" cx="47.2" cy="13.6" r="1.8" />
    </>
  ),
  wader: (
    <>
      <path d="M12 30C12 24 22 22 32 24C38 25 41 27 41 31C41 36 34 40 25 40C17 40 12 36 12 30Z" />
      <path d="M13 28L3 25.5L12.5 33.5Z" />
      <path className="bd-sil__line" d="M38 27C47 26 49 17 46 11" strokeWidth="4.4" />
      <circle cx="46" cy="9.5" r="4.2" />
      <path d="M49 8L63 10.8L49 12.6Z" />
      <path className="bd-sil__line" d="M27 40L26 58M32 39L34.5 58" strokeWidth="2.2" />
      <path className="bd-sil__line" d="M22.5 58.5h5M31 58.5h6" strokeWidth="2.2" />
      <circle className="bd-sil__eye" cx="46.8" cy="9" r="1.2" />
    </>
  ),
}

export interface SpeciesSilhouetteProps {
  /** Which outline to draw. When left out it is chosen from `family`. */
  shape?: SilhouetteShape
  /** Bird family (Latin, English or Czech name); picks a fitting outline. Unknown families get a songbird. */
  family?: string | null
  /** Pixel size, or any CSS length such as '100%'. Default 96. */
  size?: number | string
  /** Fill colour. Without it the outline takes the surrounding text colour. */
  color?: string
  /** Accessible name. Leave it out when the outline is only decoration. */
  title?: string
  className?: string
}

export function SpeciesSilhouette({ shape, family, size = 96, color, title, className }: SpeciesSilhouetteProps) {
  const resolved = shape ?? silhouetteShapeFor(family)
  return (
    <svg
      className={className ? `bd-sil ${className}` : 'bd-sil'}
      viewBox="0 0 64 64"
      width={size}
      height={size}
      fill="currentColor"
      focusable="false"
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      data-shape={resolved}
      style={color ? { color } : undefined}
    >
      {SHAPES[resolved]}
    </svg>
  )
}
