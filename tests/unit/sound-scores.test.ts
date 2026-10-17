import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { Species } from '../../src/domain/types'
import {
  allLabelsLookup,
  BIRDNET_OUTPUTS,
  dexLookup,
  idFromLabel,
  OFF_LIST_FACTOR,
  scoresFromLogits,
  sigmoid,
  topScores,
  weightByLocation,
} from '../../src/ml/sound/scores'

const species = JSON.parse(readFileSync('public/data/species.json', 'utf8')) as Species[]
const labels = readFileSync('data/birdnet-v2.4/labels_en.txt', 'utf8').split('\n')

describe('sigmoid: BirdNET Analyzer\'s flat_sigmoid with sensitivity 1', () => {
  it('turns a logit into a score between 0 and 1', () => {
    expect(sigmoid(0)).toBe(0.5)
    expect(sigmoid(2)).toBeCloseTo(0.8807970779778823, 12)
    expect(sigmoid(-2)).toBeCloseTo(0.11920292202211755, 12)
  })
  it('clips the logit to -15..15 like the reference, so the score never reaches 0 or 1 exactly', () => {
    expect(sigmoid(15)).toBe(sigmoid(40))
    expect(sigmoid(-15)).toBe(sigmoid(-1e9))
    expect(sigmoid(15)).toBeCloseTo(0.999999694097773, 12)
    expect(sigmoid(-15)).toBeGreaterThan(0)
    expect(sigmoid(Number.POSITIVE_INFINITY)).toBe(sigmoid(15))
  })
})

describe('scoresFromLogits', () => {
  it('converts all of them and can work in place', () => {
    const logits = Float32Array.of(-3, 0, 3)
    const scores = scoresFromLogits(logits)
    expect(scores[1]).toBe(0.5)
    expect(scores[0]).toBeCloseTo(1 - scores[2], 6)
    expect(logits[1]).toBe(0) // the input is not touched
    const inPlace = scoresFromLogits(logits, logits)
    expect(inPlace).toBe(logits)
    expect(logits[1]).toBe(0.5)
  })
})

describe('topScores', () => {
  const scores = Float32Array.of(0.1, 0.9, 0.5, 0.9, 0.2, 0, 0.7)

  it('returns the best ones, strongest first, ties by position', () => {
    expect(topScores(scores, null, 3)).toEqual([
      { index: 1, score: expect.closeTo(0.9, 6) },
      { index: 3, score: expect.closeTo(0.9, 6) },
      { index: 6, score: expect.closeTo(0.7, 6) },
    ])
  })
  it('only looks at the allowed positions', () => {
    expect(topScores(scores, Int32Array.of(0, 2, 4), 5).map((r) => r.index)).toEqual([2, 4, 0])
  })
  it('leaves out zero scores and returns fewer when there are fewer', () => {
    expect(topScores(Float32Array.of(0, 0, 0.3), null, 5).map((r) => r.index)).toEqual([2])
    expect(topScores(new Float32Array(10), null, 3)).toEqual([])
  })
  it('weighs scores before it ranks them', () => {
    const weights = new Float32Array(scores.length).fill(1)
    weights[1] = 0.5 // 0.9 becomes 0.45
    weights[3] = 0.5
    const ranked = topScores(scores, null, 3, weights)
    expect(ranked.map((r) => r.index)).toEqual([6, 2, 1])
    expect(ranked[0].score).toBeCloseTo(0.7, 6)
    expect(ranked[2].score).toBeCloseTo(0.45, 6)
  })
  it('handles count 0 and empty input', () => {
    expect(topScores(scores, null, 0)).toEqual([])
    expect(topScores(new Float32Array(0), null, 3)).toEqual([])
  })
})

describe('the Dex lookup (the real species list)', () => {
  const lookup = dexLookup(species)

  it('knows exactly the birds of the Dex, in order of position', () => {
    expect(lookup.indices.length).toBe(species.length)
    for (let i = 1; i < lookup.indices.length; i++) expect(lookup.indices[i]).toBeGreaterThan(lookup.indices[i - 1])
  })
  it('names the Lesser Redpoll and the Great Tit by their Dex ids', () => {
    expect(lookup.idOf(6)).toBe('acanthis-cabaret')
    const greatTit = species.find((s) => s.id === 'parus-major')!
    expect(lookup.idOf(greatTit.birdnetIndex)).toBe('parus-major')
  })
  it('never reports a non-bird class or a bird that is not in the Dex', () => {
    const sounds = ['Dog_Dog', 'Engine_Engine', 'Environmental_Environmental', 'Fireworks_Fireworks', 'Gun_Gun', 'Human non-vocal_Human non-vocal', 'Human vocal_Human vocal', 'Human whistle_Human whistle', 'Noise_Noise', 'Power tools_Power tools', 'Siren_Siren']
    for (const sound of sounds) {
      const index = labels.indexOf(sound)
      expect(index, sound).toBeGreaterThanOrEqual(0)
      expect(lookup.idOf(index), sound).toBeUndefined()
      expect(Array.from(lookup.indices)).not.toContain(index)
    }
    expect(lookup.idOf(labels.findIndex((l) => l.startsWith('Poecile atricapillus')))).toBeUndefined() // Black-capped Chickadee: North America
  })
  it('stays inside the 6522 outputs', () => {
    for (const index of lookup.indices) {
      expect(index).toBeGreaterThanOrEqual(0)
      expect(index).toBeLessThan(BIRDNET_OUTPUTS)
    }
  })
})

describe('idFromLabel and the all-labels debug lookup', () => {
  it('turns a BirdNET label into the id style of the Dex', () => {
    expect(idFromLabel('Poecile atricapillus_Black-capped Chickadee')).toBe('poecile-atricapillus')
    expect(idFromLabel('Parus major_Great Tit')).toBe('parus-major')
    expect(idFromLabel('Dog_Dog')).toBe('dog')
  })
  it('agrees with the ids of the Dex for every bird in it', () => {
    for (const bird of species) expect(idFromLabel(labels[bird.birdnetIndex]), bird.id).toBe(bird.id)
  })
  it('allows every output and names the ones outside the Dex from their labels', () => {
    const all = allLabelsLookup(labels, species)
    expect(all.indices.length).toBe(labels.length)
    expect(all.idOf(4771)).toBe('poecile-atricapillus')
    expect(all.idOf(6)).toBe('acanthis-cabaret')
    expect(all.idOf(labels.length + 5)).toBeUndefined()
  })
})

describe('the location prior', () => {
  interface Place {
    name: string
    countAboveThreshold: number
    dexCountAboveThreshold: number
  }
  const golden = JSON.parse(readFileSync('tests/fixtures/audio/golden.json', 'utf8')) as { geo: { places: Place[] } }
  const dex = dexLookup(species)
  const prague = JSON.parse(readFileSync('tests/fixtures/audio/golden-geo-full.json', 'utf8')) as { scores: number[] }

  it('keeps the birds expected at the place fully and weighs the others down to 0.8', () => {
    expect(OFF_LIST_FACTOR).toBe(0.8)
    const weighted = weightByLocation(dex, prague.scores, 0.03, 10)
    expect(weighted.weights).toBeDefined()
    let expected = 0
    for (const index of dex.indices) {
      const listed = prague.scores[index] >= 0.03
      expect(weighted.weights![index]).toBeCloseTo(listed ? 1 : 0.8, 6)
      if (listed) expected++
    }
    // Python's count of Dex birds on the species list for Prague in week 20.
    expect(expected).toBe(golden.geo.places.find((p) => p.name === 'Prague, week 20')!.dexCountAboveThreshold)
    expect(weighted.indices).toBe(dex.indices)
    expect(weighted.idOf(6)).toBe('acanthis-cabaret')
  })

  it('puts the Lesser Redpoll (0.001 in Prague) below its threshold and a Prague regular above', () => {
    const weighted = weightByLocation(dex, prague.scores, 0.03, 10)
    expect(weighted.weights![6]).toBeCloseTo(0.8, 6)
    const blackbird = species.find((s) => s.id === 'turdus-merula')!
    expect(weighted.weights![blackbird.birdnetIndex]).toBe(1)
  })

  it('does nothing when the place expects almost none of the Dex (open sea, a bad position)', () => {
    const nothing = new Float32Array(BIRDNET_OUTPUTS) // a place where the model expects no bird
    expect(weightByLocation(dex, nothing, 0.03, 10)).toBe(dex)
    const few = new Float32Array(BIRDNET_OUTPUTS)
    for (const index of Array.from(dex.indices).slice(0, 9)) few[index] = 0.5 // 9 birds: under the minimum of 10
    expect(weightByLocation(dex, few, 0.03, 10)).toBe(dex)
    few[dex.indices[9]] = 0.5 // 10 birds: now it counts
    expect(weightByLocation(dex, few, 0.03, 10).weights).toBeDefined()
  })

  it('treats a score exactly at the threshold as expected, like BirdNET Analyzer (>=)', () => {
    const scores = new Float32Array(BIRDNET_OUTPUTS)
    for (const index of dex.indices) scores[index] = 0.03
    expect(weightByLocation(dex, scores, Math.fround(0.03), 1).weights![dex.indices[0]]).toBe(1)
  })
})
