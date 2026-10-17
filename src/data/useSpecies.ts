// React hook around loadSpecies(): screens get the list as soon as it is there, or an error with a retry button.

import { useCallback, useEffect, useState } from 'react'
import type { Species } from '../domain/types'
import { getLoadedSpecies, loadSpecies } from './species'

export interface SpeciesState {
  /** Undefined while the file is loading (and after a failure). */
  species: readonly Species[] | undefined
  error: Error | undefined
  /** Tries again after a failure. */
  retry: () => void
}

export function useSpecies(): SpeciesState {
  const [species, setSpecies] = useState<readonly Species[] | undefined>(getLoadedSpecies)
  const [error, setError] = useState<Error | undefined>(undefined)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (species) return undefined
    let cancelled = false
    loadSpecies().then(
      (list) => {
        if (cancelled) return
        setSpecies(list)
        setError(undefined)
      },
      (failure: unknown) => {
        if (!cancelled) setError(failure instanceof Error ? failure : new Error(String(failure)))
      },
    )
    return () => {
      cancelled = true
    }
  }, [attempt, species])

  const retry = useCallback(() => {
    setError(undefined)
    setAttempt((count) => count + 1)
  }, [])

  return { species, error, retry }
}
