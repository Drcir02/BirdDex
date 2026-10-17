// A plan for 30 pretend catches, used by the hidden demo page to fill the Dex so the "caught" screens can be inspected.
// Pure and deterministic: the same bird list and the same "now" always give the same plan.

import type { CatchMethod, GeoPoint, Species } from '../../../domain/types'

/** Every demo catch has an id that starts with this, which is how "delete the demo catches" finds exactly those. */
export const DEMO_ID_PREFIX = 'demo-'
export const DEMO_CATCH_COUNT = 30

export function isDemoId(id: string): boolean {
  return id.startsWith(DEMO_ID_PREFIX)
}

export type DemoMedia = 'image' | 'audio' | 'none'

/** Which Czech text (a key of `dex.demo.notes`) goes with a catch as its note. */
export type DemoNoteKey = 'feeder' | 'river' | 'early' | 'field'

export interface DemoCatchPlan {
  id: string
  speciesId: string
  method: CatchMethod
  confidence: number
  caughtAt: number
  location?: GeoPoint
  placeName?: string
  note?: DemoNoteKey
  /** What picture or recording to make for the catch. */
  media: DemoMedia
  /** A number to seed the drawing or the tones, so each catch looks and sounds different. */
  seed: number
}

/** 24 birds with a mix of common ones, rarities, owls (heard) and birds that are not in Czechia. */
const DEMO_SPECIES: readonly string[] = [
  'parus-major',
  'erithacus-rubecula',
  'turdus-merula',
  'passer-domesticus',
  'fringilla-coelebs',
  'carduelis-carduelis',
  'cyanistes-caeruleus',
  'sitta-europaea',
  'dendrocopos-major',
  'troglodytes-troglodytes',
  'columba-palumbus',
  'pica-pica',
  'motacilla-alba',
  'alcedo-atthis',
  'bubo-bubo',
  'strix-aluco',
  'buteo-buteo',
  'anas-platyrhynchos',
  'cygnus-olor',
  'ciconia-ciconia',
  'grus-grus',
  'tichodroma-muraria',
  'morus-bassanus',
  'phoenicopterus-roseus',
]

/** Birds that were caught more than once (6 more catches in all). */
const EXTRA_CATCHES: Readonly<Record<string, number>> = {
  'parus-major': 2,
  'erithacus-rubecula': 1,
  'turdus-merula': 1,
  'alcedo-atthis': 1,
  'strix-aluco': 1,
}

/** Owls are heard rather than seen; the kingfisher is a photograph. */
const FIXED_METHOD: Readonly<Record<string, CatchMethod>> = { 'bubo-bubo': 'sound', 'strix-aluco': 'sound', 'alcedo-atthis': 'photo' }

const METHOD_CYCLE: readonly CatchMethod[] = ['sound', 'photo', 'sound', 'live', 'photo']

interface Place {
  name: string
  lat: number
  lon: number
}

const CZECH_PLACES: readonly Place[] = [
  { name: 'Praha, Stromovka', lat: 50.106, lon: 14.4247 },
  { name: 'Brno', lat: 49.1951, lon: 16.6068 },
  { name: 'Ostrava', lat: 49.8209, lon: 18.2625 },
  { name: 'Plzeň', lat: 49.7384, lon: 13.3736 },
  { name: 'Liberec', lat: 50.7663, lon: 15.0543 },
  { name: 'Olomouc', lat: 49.5938, lon: 17.2509 },
  { name: 'České Budějovice', lat: 48.9745, lon: 14.4743 },
  { name: 'Hradec Králové', lat: 50.2104, lon: 15.8327 },
  { name: 'Třeboň', lat: 49.0036, lon: 14.7703 },
  { name: 'Lednice', lat: 48.7996, lon: 16.8037 },
  { name: 'Kvilda, Šumava', lat: 49.0262, lon: 13.5762 },
  { name: 'Špindlerův Mlýn', lat: 50.7267, lon: 15.6094 },
]

const EUROPE_PLACES: readonly Place[] = [
  { name: 'Valencia', lat: 39.4699, lon: -0.3763 },
  { name: 'Bergen', lat: 60.3913, lon: 5.3221 },
  { name: 'Tarifa', lat: 36.0143, lon: -5.6044 },
]

/** A small deterministic random number generator (mulberry32), so the plan never changes between runs. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const NOTE_AT: ReadonlySet<number> = new Set([2, 7, 13, 21])
const NOTE_KEYS: readonly DemoNoteKey[] = ['feeder', 'river', 'early', 'field']
/** Catches (by position) that have a recording or a picture missing, so the layout without them can be inspected. */
const NO_MEDIA_AT: ReadonlySet<number> = new Set([5, 19])

const HOUR = 3_600_000

/** The birds of the plan: the chosen ones that exist in the list, topped up from the list when some are missing. */
function pickSpecies(list: readonly Species[]): string[] {
  const known = new Set(list.map((species) => species.id))
  const chosen = DEMO_SPECIES.filter((id) => known.has(id))
  if (chosen.length >= DEMO_SPECIES.length) return chosen
  // A list that does not have the usual birds (a test list): take evenly spaced ones instead.
  const missing = DEMO_SPECIES.length - chosen.length
  const rest = list.filter((species) => !chosen.includes(species.id))
  const step = Math.max(1, Math.floor(rest.length / Math.max(1, missing)))
  for (let index = 0; chosen.length < DEMO_SPECIES.length && index < rest.length; index += step) chosen.push(rest[index].id)
  return chosen
}

/**
 * 30 catches over the last weeks. Each bird once, six of them again; sounds, photos and live catches; most with a place
 * name, some with coordinates only, some with no place; two without a picture or recording; four with a note.
 */
export function buildDemoPlan(list: readonly Species[], now: number): DemoCatchPlan[] {
  const birds = pickSpecies(list)
  if (birds.length === 0) return []
  const sequence: string[] = [...birds]
  for (const [id, more] of Object.entries(EXTRA_CATCHES)) {
    if (!birds.includes(id)) continue
    for (let count = 0; count < more; count += 1) sequence.push(id)
  }
  // Short lists (tests) are filled up by going round again.
  for (let index = 0; sequence.length < DEMO_CATCH_COUNT; index += 1) sequence.push(birds[index % birds.length])
  sequence.length = DEMO_CATCH_COUNT

  const europeOnly = new Set(list.filter((species) => !species.inCzechia).map((species) => species.id))
  const random = seededRandom(20261017)
  let hoursAgo = 3
  return sequence.map((speciesId, index) => {
    const method = FIXED_METHOD[speciesId] ?? METHOD_CYCLE[index % METHOD_CYCLE.length]
    hoursAgo += 6 + Math.floor(random() * 40)
    const places = europeOnly.has(speciesId) ? EUROPE_PLACES : CZECH_PLACES
    const place = places[(index * 5 + Math.floor(random() * 3)) % places.length]
    // Jitter the position a little so two catches at one place are not on the very same spot.
    const point: GeoPoint = {
      lat: Number((place.lat + (random() - 0.5) * 0.02).toFixed(5)),
      lon: Number((place.lon + (random() - 0.5) * 0.03).toFixed(5)),
      accuracyM: 20 + Math.round(random() * 60),
    }
    const kind = index % 4 // three of four have a place name, one of four only coordinates; every seventh has no place at all
    const plan: DemoCatchPlan = {
      id: `${DEMO_ID_PREFIX}${String(index + 1).padStart(2, '0')}`,
      speciesId,
      method,
      confidence: Number((method === 'sound' ? 0.72 + random() * 0.25 : 0.62 + random() * 0.3).toFixed(2)),
      caughtAt: Math.round(now - hoursAgo * HOUR),
      media: NO_MEDIA_AT.has(index) ? 'none' : method === 'sound' ? 'audio' : 'image',
      seed: 1000 + index * 37,
    }
    if (index % 7 !== 6) {
      plan.location = point
      if (kind !== 3) plan.placeName = place.name
    }
    if (NOTE_AT.has(index)) plan.note = NOTE_KEYS[[...NOTE_AT].indexOf(index) % NOTE_KEYS.length]
    return plan
  })
}
