import { useMemo, useState, type ReactNode } from 'react'
import { cx } from '../../ui/logic'
import './ReferenceImage.css'

export interface ReferenceImageProps {
  /** The address to show first. */
  src: string
  /** Shown instead when `src` does not load (a size that Wikimedia refuses, for example): usually the small version. */
  fallbackSrc?: string
  alt: string
  className?: string
  /** What to show when nothing loads at all, for example the silhouette. */
  placeholder?: ReactNode
  eager?: boolean
}

interface Attempt {
  url: string
  /** Ask with CORS (a readable answer the service worker can keep without counting it as huge) or the plain way. */
  cors: boolean
}

/** The order of tries: the wanted picture, then the small one; and if the server did not allow CORS, both again the plain way. */
export function attemptsFor(src: string, fallbackSrc?: string): Attempt[] {
  const urls = fallbackSrc && fallbackSrc !== src ? [src, fallbackSrc] : [src]
  return [...urls.map((url) => ({ url, cors: true })), ...urls.map((url) => ({ url, cors: false }))]
}

/**
 * A picture from the web (Wikimedia) that never leaves a broken-image icon: it fades in when it has loaded, tries the
 * next address when one fails, and shows the placeholder when everything fails.
 *
 * It asks with `crossOrigin="anonymous"` first: the service worker then keeps the picture as a normal, readable response
 * instead of an opaque one (browsers count each opaque response as several megabytes against the storage quota). Wikimedia
 * allows this, and if it ever stopped, the last try is the plain request, which always works for a picture on a page.
 * `referrerPolicy="no-referrer"` keeps the address of the app out of the request.
 */
export function ReferenceImage({ src, fallbackSrc, alt, className, placeholder, eager = false }: ReferenceImageProps) {
  const attempts = useMemo(() => attemptsFor(src, fallbackSrc), [src, fallbackSrc])
  const [state, setState] = useState({ key: src, index: 0 })
  const [loaded, setLoaded] = useState(false)
  // Another bird (another address) starts over.
  if (state.key !== src) {
    setState({ key: src, index: 0 })
    setLoaded(false)
  }
  const current = attempts[state.index]
  if (!current) return <>{placeholder ?? null}</>
  return (
    <img
      key={`${state.index}:${current.url}`}
      className={cx('bd-refimg', loaded && 'is-loaded', className)}
      src={current.url}
      alt={alt}
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      crossOrigin={current.cors ? 'anonymous' : undefined}
      referrerPolicy="no-referrer"
      draggable={false}
      onLoad={() => setLoaded(true)}
      onError={() => {
        setLoaded(false)
        setState((previous) => ({ key: previous.key, index: previous.index + 1 }))
      }}
    />
  )
}
