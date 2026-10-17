// Putting the demo catches into the database and taking them out again. Only rows whose id starts with "demo-" are ever
// touched, so a real catch is never added to, changed or deleted by this code.

import { loadSpecies } from '../../../data/species'
import { addCatch, deleteCatch, getCatch, getDb, type NewMedia } from '../../../db'
import type { Species } from '../../../domain/types'
import { t } from '../../../i18n'
import { makeDemoClip, makeDemoImage } from './demoMedia'
import { buildDemoPlan, DEMO_ID_PREFIX, type DemoCatchPlan, type DemoNoteKey } from './demoPlan'

export interface DemoMediaMaker {
  image(seed: number, tag: string): Promise<Blob | undefined>
  clip(seed: number): { blob: Blob; durationS: number }
}

export interface SeedOptions {
  /** The list of birds. Default: the Dex data. */
  species?: readonly Species[]
  now?: number
  media?: DemoMediaMaker
  onProgress?: (done: number, total: number) => void
}

export interface SeedResult {
  /** Catches written now. */
  added: number
  /** Demo catches that were there already and were left alone. */
  kept: number
}

const defaultMedia: DemoMediaMaker = { image: makeDemoImage, clip: makeDemoClip }

const noteText = (key: DemoNoteKey) => t(`dex.demo.notes.${key}` as const)

async function mediaFor(plan: DemoCatchPlan, maker: DemoMediaMaker): Promise<NewMedia | undefined> {
  if (plan.media === 'audio') {
    const { blob, durationS } = maker.clip(plan.seed)
    return { kind: 'audio', blob, mime: 'audio/wav', durationS }
  }
  if (plan.media === 'image') {
    const blob = await maker.image(plan.seed, t('dex.demo.demoTag'))
    return blob ? { kind: 'image', blob, mime: blob.type || 'image/jpeg' } : undefined
  }
  return undefined
}

/** Adds the 30 demo catches that are not in the database yet. Running it twice does not double anything. */
export async function seedDemoData(options: SeedOptions = {}): Promise<SeedResult> {
  const list = options.species ?? (await loadSpecies())
  const plans = buildDemoPlan(list, options.now ?? Date.now())
  const maker = options.media ?? defaultMedia
  let added = 0
  let kept = 0
  for (const [index, plan] of plans.entries()) {
    if (await getCatch(plan.id)) {
      kept += 1
    } else {
      const media = await mediaFor(plan, maker)
      await addCatch(
        {
          id: plan.id,
          speciesId: plan.speciesId,
          method: plan.method,
          confidence: plan.confidence,
          caughtAt: plan.caughtAt,
          ...(plan.location ? { location: plan.location } : {}),
          ...(plan.placeName ? { placeName: plan.placeName } : {}),
          ...(plan.note ? { note: noteText(plan.note) } : {}),
        },
        media,
      )
      added += 1
    }
    options.onProgress?.(index + 1, plans.length)
  }
  return { added, kept }
}

/** The ids of the demo catches in the database. */
export async function demoCatchIds(): Promise<string[]> {
  return (await getDb().catches.where('id').startsWith(DEMO_ID_PREFIX).primaryKeys()) as string[]
}

export async function countDemoCatches(): Promise<number> {
  return getDb().catches.where('id').startsWith(DEMO_ID_PREFIX).count()
}

/** Deletes the demo catches and their pictures and recordings. Returns how many catches went. */
export async function clearDemoData(): Promise<number> {
  let removed = 0
  for (const id of await demoCatchIds()) {
    if (await deleteCatch(id)) removed += 1
  }
  return removed
}
