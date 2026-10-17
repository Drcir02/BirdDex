// React hook around the reference photo service. It never blocks rendering: the first render already has what is known
// (a photo from an earlier lookup, or "loading"), and the answer arrives later.

import { useEffect, useMemo, useState } from 'react'
import { isAbortError, referencePhotos, type ReferencePhotoService } from './referencePhotos'
import type { ReferencePhoto } from './types'

export type ReferencePhotoStatus =
  /** Nothing to do: no species given, or the lookup is switched off with `enabled: false`. */
  | 'idle'
  | 'loading'
  | 'ready'
  /** The species has no usable photo (none on Wikipedia, or its licence is not allowed). */
  | 'none'
  /** The lookup could not be finished (offline, a server problem). The hook tries again when the phone comes back online. */
  | 'error'

export interface ReferencePhotoState {
  /** The photo when status is 'ready', otherwise undefined. */
  photo: ReferencePhoto | undefined
  status: ReferencePhotoStatus
}

export interface UseReferencePhotoOptions {
  /** Pass false to wait, for example until a card is near the screen. Default true. */
  enabled?: boolean
  /** For tests: another service instead of the shared one. */
  service?: ReferencePhotoService
}

interface Outcome {
  speciesId: string
  photo: ReferencePhoto | null | undefined
  failed: boolean
}

const IDLE: ReferencePhotoState = { photo: undefined, status: 'idle' }

export function useReferencePhoto(speciesId: string | undefined, options: UseReferencePhotoOptions = {}): ReferencePhotoState {
  const service = options.service ?? referencePhotos
  const enabled = options.enabled ?? true
  const [outcome, setOutcome] = useState<Outcome | undefined>()
  // Read on every render: it is a map lookup, and it makes a bird that was looked up before show at once.
  const known = speciesId ? service.peek(speciesId) : undefined

  useEffect(() => {
    if (!speciesId || !enabled) return undefined
    if (service.peek(speciesId) !== undefined) return undefined
    const controller = new AbortController()
    let alive = true
    const ask = (force: boolean) => {
      service.get(speciesId, { signal: controller.signal, force }).then(
        (photo) => {
          if (alive) setOutcome({ speciesId, photo, failed: false })
        },
        (error: unknown) => {
          if (alive && !isAbortError(error)) setOutcome({ speciesId, photo: undefined, failed: true })
        },
      )
    }
    ask(false)
    // A lookup that failed for lack of a connection is tried again as soon as the phone is back online.
    const onOnline = () => ask(true)
    window.addEventListener('online', onOnline)
    return () => {
      alive = false
      controller.abort()
      window.removeEventListener('online', onOnline)
    }
  }, [speciesId, enabled, service])

  const mine = outcome?.speciesId === speciesId ? outcome : undefined
  let status: ReferencePhotoStatus
  let photo: ReferencePhoto | undefined
  if (!speciesId) {
    status = 'idle'
  } else if (known !== undefined) {
    photo = known ?? undefined
    status = known ? 'ready' : 'none'
  } else if (mine && !mine.failed) {
    photo = mine.photo ?? undefined
    status = mine.photo ? 'ready' : 'none'
  } else if (mine?.failed) {
    status = 'error'
  } else {
    status = enabled ? 'loading' : 'idle'
  }

  return useMemo(() => (status === 'idle' ? IDLE : { photo, status }), [photo, status])
}
