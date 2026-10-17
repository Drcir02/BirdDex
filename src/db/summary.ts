// What the Dex needs to know about each caught species, kept up to date as catches come and go.

import type { CatchRecord } from '../domain/types'
import { getDb } from './database'
import { createLiveStore, useLiveQuery } from './live'
import { useSyncExternalStore } from 'react'

export interface SpeciesCaughtSummary {
  speciesId: string
  /** How many times this species was caught. */
  count: number
  /** Milliseconds since 1970. */
  firstCaughtAt: number
  lastCaughtAt: number
  /**
   * The saved photo or clip that stands for the species: the newest photo if there is one, otherwise the newest clip.
   * Missing when no catch of the species saved any media.
   */
  mediaId?: string
  /** What `mediaId` holds, so the Dex knows whether it can draw it. */
  mediaKind?: 'image' | 'audio'
}

export interface CaughtSummary {
  /** False until the first answer from the database has arrived. */
  ready: boolean
  bySpecies: ReadonlyMap<string, SpeciesCaughtSummary>
  /** Species caught at least once. */
  speciesCount: number
  /** All catches, repeats included. */
  catchCount: number
  error?: Error
}

const newestFirst = (a: CatchRecord, b: CatchRecord) => b.caughtAt - a.caughtAt || (a.id < b.id ? -1 : 1)

/** Sound clips are audio; photos and live camera catches save a picture. */
const mediaKindOf = (record: CatchRecord): 'image' | 'audio' => (record.method === 'sound' ? 'audio' : 'image')

/** Pure: turns a list of catches into one summary per species. */
export function summarizeCatches(catches: readonly CatchRecord[]): ReadonlyMap<string, SpeciesCaughtSummary> {
  const groups = new Map<string, CatchRecord[]>()
  for (const record of catches) {
    const group = groups.get(record.speciesId)
    if (group) group.push(record)
    else groups.set(record.speciesId, [record])
  }

  const result = new Map<string, SpeciesCaughtSummary>()
  for (const [speciesId, group] of groups) {
    group.sort(newestFirst)
    const withMedia = group.filter((record) => record.mediaId)
    const representative = withMedia.find((record) => mediaKindOf(record) === 'image') ?? withMedia[0]
    const summary: SpeciesCaughtSummary = {
      speciesId,
      count: group.length,
      firstCaughtAt: group[group.length - 1].caughtAt,
      lastCaughtAt: group[0].caughtAt,
    }
    if (representative?.mediaId) {
      summary.mediaId = representative.mediaId
      summary.mediaKind = mediaKindOf(representative)
    }
    result.set(speciesId, summary)
  }
  return result
}

const EMPTY: ReadonlyMap<string, SpeciesCaughtSummary> = new Map()

interface SummaryValue {
  bySpecies: ReadonlyMap<string, SpeciesCaughtSummary>
  catchCount: number
}

const summaryStore = createLiveStore<SummaryValue>(async () => {
  const catches = await getDb().catches.toArray()
  return { bySpecies: summarizeCatches(catches), catchCount: catches.length }
}, { bySpecies: EMPTY, catchCount: 0 })

// useSyncExternalStore needs the very same object for the same data, so the public shape is cached per snapshot.
let lastSnapshot: ReturnType<typeof summaryStore.getSnapshot> | undefined
let lastSummary: CaughtSummary | undefined

function getCaughtSummary(): CaughtSummary {
  const snapshot = summaryStore.getSnapshot()
  if (snapshot !== lastSnapshot || !lastSummary) {
    lastSnapshot = snapshot
    lastSummary = {
      ready: snapshot.ready,
      bySpecies: snapshot.value.bySpecies,
      speciesCount: snapshot.value.bySpecies.size,
      catchCount: snapshot.value.catchCount,
      ...(snapshot.error ? { error: snapshot.error } : {}),
    }
  }
  return lastSummary
}

/** Live: which species are caught, how often, when, and with which picture. Updates when a catch is added or deleted. */
export function useCaughtSummary(): CaughtSummary {
  return useSyncExternalStore(summaryStore.subscribe, getCaughtSummary)
}

// ---------- More live lists ----------

/** Live: the catches of one species, newest first. */
export function useSpeciesCatches(speciesId: string): { ready: boolean; catches: CatchRecord[]; error?: Error } {
  const { ready, value, error } = useLiveQuery(
    () => getDb().catches.where('[speciesId+caughtAt]').between([speciesId, -Infinity], [speciesId, Infinity]).reverse().toArray(),
    [speciesId],
    [] as CatchRecord[],
  )
  return { ready, catches: value, ...(error ? { error } : {}) }
}

/** Live: the newest catches of all species. */
export function useRecentCatches(limit = 20): { ready: boolean; catches: CatchRecord[]; error?: Error } {
  const { ready, value, error } = useLiveQuery(
    () => getDb().catches.orderBy('caughtAt').reverse().limit(limit).toArray(),
    [limit],
    [] as CatchRecord[],
  )
  return { ready, catches: value, ...(error ? { error } : {}) }
}
