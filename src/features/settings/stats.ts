// The numbers on the trainer card, worked out from the catches and the species list. Pure functions: no database, no React.

import type { CatchMethod, CatchRecord, Rarity, Species } from '../../domain/types'

export const RARITY_ORDER: readonly Rarity[] = ['common', 'uncommon', 'rare', 'epic', 'legendary']

const rarityRank = (rarity: Rarity): number => RARITY_ORDER.indexOf(rarity)

export interface RegionProgress {
  caught: number
  total: number
  /** 0 to 1; 0 when the region has no species. */
  fraction: number
}

export interface DayStreak {
  /** Consecutive days with a catch, up to today (or yesterday: today may still come). 0 when the chain is broken. */
  current: number
  /** The longest chain ever. */
  best: number
}

export interface TrainerStats {
  /** All catches, repeats included. */
  totalCatches: number
  /** Species caught at least once. */
  speciesCaught: number
  czechia: RegionProgress
  europe: RegionProgress
  /** The rarest species caught; of equal rarity the one caught first. */
  rarest?: { speciesId: string; rarity: Rarity; caughtAt: number }
  /** Milliseconds since 1970 of the oldest catch. */
  firstCatchAt?: number
  streak: DayStreak
  perMethod: Record<CatchMethod, number>
}

const MS_PER_DAY = 86_400_000

/** The calendar day (in the phone's time zone) as a whole number, so that consecutive days differ by exactly 1 even across a clock change. */
export function dayNumber(timestamp: number): number {
  const date = new Date(timestamp)
  return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / MS_PER_DAY)
}

/** Current and best run of days with at least one catch. `now` decides whether the current run is still alive. */
export function dayStreak(timestamps: readonly number[], now: number): DayStreak {
  const days = [...new Set(timestamps.filter(Number.isFinite).map(dayNumber))].sort((a, b) => a - b)
  if (days.length === 0) return { current: 0, best: 0 }
  let best = 1
  let run = 1
  for (let index = 1; index < days.length; index += 1) {
    run = days[index] === days[index - 1] + 1 ? run + 1 : 1
    best = Math.max(best, run)
  }
  // `run` is now the length of the chain that ends on the newest day.
  const today = dayNumber(now)
  const newest = days[days.length - 1]
  const current = newest === today || newest === today - 1 ? run : 0
  return { current, best }
}

function progress(caught: number, total: number): RegionProgress {
  return { caught, total, fraction: total > 0 ? caught / total : 0 }
}

/** Everything the trainer card shows. Catches of birds that are not in the species list still count as catches. */
export function computeTrainerStats(catches: readonly CatchRecord[], species: readonly Species[], now: number = Date.now()): TrainerStats {
  const byId = new Map(species.map((entry) => [entry.id, entry] as const))
  const perMethod: Record<CatchMethod, number> = { sound: 0, photo: 0, live: 0 }
  const firstOfSpecies = new Map<string, number>()
  let firstCatchAt: number | undefined

  for (const record of catches) {
    if (record.method in perMethod) perMethod[record.method] += 1
    if (!Number.isFinite(record.caughtAt)) continue
    if (firstCatchAt === undefined || record.caughtAt < firstCatchAt) firstCatchAt = record.caughtAt
    const seen = firstOfSpecies.get(record.speciesId)
    if (seen === undefined || record.caughtAt < seen) firstOfSpecies.set(record.speciesId, record.caughtAt)
  }

  // Species caught, even when the timestamp was broken.
  const caughtIds = new Set(catches.map((record) => record.speciesId))
  let czechia = 0
  let europe = 0
  let rarest: TrainerStats['rarest']
  for (const id of caughtIds) {
    const entry = byId.get(id)
    if (!entry) continue
    if (entry.inCzechia) czechia += 1
    if (entry.inEurope) europe += 1
    const caughtAt = firstOfSpecies.get(id) ?? 0
    if (!rarest || rarityRank(entry.rarity) > rarityRank(rarest.rarity) || (rarityRank(entry.rarity) === rarityRank(rarest.rarity) && caughtAt < rarest.caughtAt)) {
      rarest = { speciesId: id, rarity: entry.rarity, caughtAt }
    }
  }

  return {
    totalCatches: catches.length,
    speciesCaught: caughtIds.size,
    czechia: progress(czechia, species.filter((entry) => entry.inCzechia).length),
    europe: progress(europe, species.filter((entry) => entry.inEurope).length),
    ...(rarest ? { rarest } : {}),
    ...(firstCatchAt !== undefined ? { firstCatchAt } : {}),
    streak: dayStreak(catches.map((record) => record.caughtAt), now),
    perMethod,
  }
}
