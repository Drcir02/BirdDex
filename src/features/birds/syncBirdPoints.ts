// Keeps the BirdPoints of the saved catches up to date. Runs once when the app starts with the Dex data loaded:
//   * a catch from before BP existed (no `bp`) gets one now, worked out from what was saved (confidence, way of catching, date and
//     the bird's own season and hour), with its luck rolled once and kept; its clarity was not saved, so a middle value is used;
//   * a catch whose bird has a new range in data/bp-ranges.csv since the BP was worked out gets the same quality and the same luck
//     recalculated against the new range, so rebalancing the table never re-rolls anything.
// A catch whose BP is there and whose range is unchanged is not touched.

import { bpRangeOf, calculateBirdPoints, recalculateStored, toStored } from '../../domain/birdPoints'
import { getDb } from '../../db'
import type { Species } from '../../domain/types'

export interface SyncReport {
  /** Catches that got a BP for the first time. */
  added: number
  /** Catches whose BP followed a changed range. */
  recalculated: number
}

export async function syncBirdPoints(species: readonly Species[], random: () => number = Math.random): Promise<SyncReport> {
  const db = getDb()
  const byId = new Map(species.map((bird) => [bird.id, bird] as const))
  const report: SyncReport = { added: 0, recalculated: 0 }
  await db.transaction('rw', db.catches, async () => {
    for (const record of await db.catches.toArray()) {
      const bird = byId.get(record.speciesId)
      if (!bird) continue
      const range = bpRangeOf(bird)
      if (record.bp === undefined || record.bpQ === undefined || record.bpLuck === undefined) {
        const points = calculateBirdPoints({
          species: bird,
          method: record.method,
          confidence: record.confidence,
          caughtAt: record.caughtAt,
          // The catch was made at its own date: a photo is not "old" for that reason.
          now: record.caughtAt,
          unknownClarity: true,
          random,
        })
        await db.catches.put({ ...record, ...toStored(points, true) })
        report.added += 1
      } else if (!record.bpRange || record.bpRange[0] !== range[0] || record.bpRange[1] !== range[1]) {
        const { bp, bpBase } = recalculateStored({ bpQ: record.bpQ, bpLuck: record.bpLuck }, range)
        await db.catches.put({ ...record, bp, bpBase, bpRange: [range[0], range[1]] })
        report.recalculated += 1
      }
    }
  })
  return report
}

let running: Promise<SyncReport> | undefined

/** One run at a time: the app may ask twice (development re-runs effects), and the second ask waits for the first. */
export function syncBirdPointsOnce(species: readonly Species[]): Promise<SyncReport> {
  running ??= syncBirdPoints(species).finally(() => {
    running = undefined
  })
  return running
}
