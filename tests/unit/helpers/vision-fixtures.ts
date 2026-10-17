// Small stand-ins for the WingCLIP files, so the unit tests need no model files.

import type { Species } from '../../../src/domain/types'

/** Packs rows of floats the way text_classifier_int8.bin does: int8 values per row, then one float32 scale per row. */
export function makeClassifierBytes(rows: number[][]): Uint8Array {
  const dim = rows[0].length
  const bytes = new Uint8Array(rows.length * (dim + 4))
  const view = new DataView(bytes.buffer)
  rows.forEach((row, r) => {
    const peak = Math.max(...row.map(Math.abs)) || 1
    const scale = peak / 127
    row.forEach((value, i) => {
      bytes[r * dim + i] = Math.round(value / scale) & 0xff
    })
    view.setFloat32(rows.length * dim + r * 4, scale, true)
  })
  return bytes
}

/** What a row reads back as after the int8 round trip. */
export function roundTrip(row: number[]): number[] {
  const peak = Math.max(...row.map(Math.abs)) || 1
  const scale = Math.fround(peak / 127)
  return row.map((value) => Math.round(value / (peak / 127)) * scale)
}

/** A reproducible pseudo-random number generator (mulberry32). */
export function random(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function randomUnitRow(dim: number, next: () => number): number[] {
  const row = Array.from({ length: dim }, () => next() * 2 - 1)
  const length = Math.hypot(...row)
  return row.map((v) => v / length)
}

/** A species list for the tests: ids sp-0, sp-1, ... with WingCLIP rows given by `rows` (null for none). */
export function makeSpecies(rows: (number | null)[], flags: { inCzechia?: (index: number) => boolean } = {}): Species[] {
  return rows.map((row, index) => ({
    id: `sp-${index}`,
    dexNumber: index + 1,
    scientificName: `Genus species${index}`,
    czechName: `Pták ${index}`,
    englishName: `Bird ${index}`,
    family: 'Paridae',
    inCzechia: flags.inCzechia ? flags.inCzechia(index) : true,
    inEurope: true,
    rarity: 'common',
    birdnetIndex: index,
    wingclipIndex: row,
    wikiTitle: null,
  }))
}
