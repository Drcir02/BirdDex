import { useEffect, useState } from 'react'
import type { GeoPoint } from '../../domain/types'
import { lookupPlaceName, rememberedPlaceName, rememberPlaceName } from './placeName'

/**
 * The name of the place of a position, once it has been looked up (undefined until then, and when there is none).
 * Pass `enabled: false` to wait: nothing leaves the phone until a bird can actually be caught.
 */
export function usePlaceName(location: GeoPoint | undefined, enabled: boolean): string | undefined {
  const lat = location?.lat
  const lon = location?.lon
  const [found, setFound] = useState<{ key: string; name: string | undefined } | undefined>(undefined)
  const key = lat !== undefined && lon !== undefined ? `${lat.toFixed(2)},${lon.toFixed(2)}` : undefined

  useEffect(() => {
    if (!enabled || key === undefined || lat === undefined || lon === undefined) return undefined
    const remembered = rememberedPlaceName({ lat, lon })
    if (remembered !== undefined) {
      setFound({ key, name: remembered ?? undefined })
      return undefined
    }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return undefined
    const controller = new AbortController()
    void lookupPlaceName({ lat, lon }, { signal: controller.signal }).then((name) => {
      if (controller.signal.aborted) return
      rememberPlaceName({ lat, lon }, name)
      setFound({ key, name })
    })
    return () => controller.abort()
  }, [enabled, key, lat, lon])

  return found && found.key === key ? found.name : undefined
}
