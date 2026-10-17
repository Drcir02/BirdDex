import { useEffect, useState } from 'react'
import { getMedia } from './repository'

export interface MediaUrl {
  /** An address the page can show or play (an object URL). Undefined until it is ready, or when there is nothing to show. */
  url?: string
  kind?: 'image' | 'audio'
  durationS?: number
  /** True while the media is being read from the database. */
  loading: boolean
  /** True when an id was given but the database has no such photo or clip. */
  missing: boolean
}

interface Loaded {
  id: string
  url?: string
  kind?: 'image' | 'audio'
  durationS?: number
}

/**
 * Turns a saved photo or clip into an address for <img> or <audio>, and releases it again when the screen goes away
 * or the id changes. Pass undefined when there is nothing to show.
 */
export function useMediaUrl(mediaId: string | undefined): MediaUrl {
  const [loaded, setLoaded] = useState<Loaded | undefined>()

  useEffect(() => {
    if (!mediaId) return
    let cancelled = false
    let objectUrl: string | undefined
    getMedia(mediaId)
      .then((media) => {
        if (cancelled) return
        if (!media) {
          setLoaded({ id: mediaId })
          return
        }
        objectUrl = URL.createObjectURL(media.blob)
        setLoaded({ id: mediaId, url: objectUrl, kind: media.kind, durationS: media.durationS })
      })
      .catch(() => {
        if (!cancelled) setLoaded({ id: mediaId })
      })
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [mediaId])

  if (!mediaId) return { loading: false, missing: false }
  if (loaded?.id !== mediaId) return { loading: true, missing: false }
  return { url: loaded.url, kind: loaded.kind, durationS: loaded.durationS, loading: false, missing: loaded.url === undefined }
}
