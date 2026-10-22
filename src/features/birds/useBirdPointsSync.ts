import { useEffect } from 'react'
import type { CatchRecord, Species } from '../../domain/types'
import { syncBirdPointsOnce } from './syncBirdPoints'

/**
 * Works out the BP of a catch that has none, when a Ptáci screen shows it. The app does this once at the start too
 * (Layout), but a backup restored since then, or the hidden demo catches, bring catches without BP into an app that is
 * already open.
 */
export function useBirdPointsSync(species: readonly Species[] | undefined, catches: { ready: boolean; value: readonly CatchRecord[] }): void {
  const missing = catches.ready && catches.value.some((record) => record.bp === undefined)
  useEffect(() => {
    if (species && missing) void syncBirdPointsOnce(species).catch(() => undefined)
  }, [species, missing])
}
