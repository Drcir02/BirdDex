import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import { parseSpecies } from '../../src/data/species'
import type { Candidate, CatchMethod, Sensitivity, Species } from '../../src/domain/types'
import { confirmTextKey, buildResultView, reasonKey, scanPathFor } from '../../src/features/scan/resultModel'

let species: Species[]
beforeAll(() => {
  species = parseSpecies(JSON.parse(readFileSync('public/data/species.json', 'utf8')))
})

const guess = (speciesId: string, confidence: number): Candidate => ({ speciesId, confidence })
const NONE: ReadonlyMap<string, number> = new Map()

function view(method: CatchMethod, candidates: Candidate[], sensitivity: Sensitivity = 'normal', caught: ReadonlyMap<string, number> = NONE) {
  return buildResultView({ pending: { method, candidates }, species, sensitivity, caughtCounts: caught })
}

describe('buildResultView', () => {
  it('shows each guess with its Czech name, scientific name, rarity and confidence, strongest first', () => {
    const result = view('sound', [guess('erithacus-rubecula', 0.09), guess('parus-major', 0.91), guess('turdus-merula', 0.22)])
    expect(result.candidates.map((c) => c.speciesId)).toEqual(['parus-major', 'turdus-merula', 'erithacus-rubecula'])
    const best = result.candidates[0]
    expect(best.name).toBe('Sýkora koňadra')
    expect(best.scientificName).toBe('Parus major')
    expect(best.rarity).toBe('common')
    expect(best.confidence).toBe(0.91)
    expect(best.species.id).toBe('parus-major')
  })

  it('lets the Catch button work only for the guesses that pass the rules of the method and sensitivity', () => {
    const result = view('sound', [guess('parus-major', 0.91), guess('turdus-merula', 0.22), guess('erithacus-rubecula', 0.09)])
    expect(result.candidates.map((c) => c.allowed)).toEqual([true, false, false])
    expect(result.anyAllowed).toBe(true)
    expect(result.empty).toBe(false)
  })

  it('names the reason for a blocked guess: too unsure, or too close to another bird', () => {
    const low = view('photo', [guess('erithacus-rubecula', 0.41), guess('parus-major', 0.23)])
    expect(low.candidates[0]).toMatchObject({ allowed: false, reason: 'low-confidence' })
    expect(low.anyAllowed).toBe(false)

    const close = view('photo', [guess('turdus-merula', 0.62), guess('parus-major', 0.58)])
    expect(close.candidates.map((c) => c.reason)).toEqual(['unclear-margin', 'low-confidence'])
    expect(close.candidates.map((c) => c.allowed)).toEqual([false, false])
  })

  it('follows the sensitivity setting', () => {
    const guesses = [guess('parus-major', 0.65), guess('turdus-merula', 0.1)]
    expect(view('photo', guesses, 'strict').anyAllowed).toBe(false)
    expect(view('photo', guesses, 'normal').anyAllowed).toBe(true)
    expect(view('photo', guesses, 'easy').anyAllowed).toBe(true)
  })

  it('does not ask for a lead over the second guess for sound (two birds can sing together)', () => {
    const result = view('sound', [guess('turdus-merula', 0.74), guess('parus-major', 0.71)])
    expect(result.candidates.map((c) => c.allowed)).toEqual([true, true])
  })

  it('tells how sure the Catch button needs the guess to be, for the notch on the bar', () => {
    expect(view('sound', [guess('parus-major', 0.9)], 'normal').neededConfidence).toBe(0.7)
    expect(view('sound', [guess('parus-major', 0.9)], 'strict').neededConfidence).toBe(0.85)
    expect(view('photo', [guess('parus-major', 0.9)], 'normal').neededConfidence).toBe(0.6)
    expect(view('live', [guess('parus-major', 0.9)], 'easy').neededConfidence).toBe(0.45)
  })

  it('counts how often a species is in the Dex already (zero means a new species)', () => {
    const result = view('sound', [guess('parus-major', 0.91), guess('turdus-merula', 0.8)], 'normal', new Map([['parus-major', 3]]))
    expect(result.candidates.map((c) => c.timesCaught)).toEqual([3, 0])
  })

  it('leaves out a guess that is not a bird of the Dex, but still compares the others with it', () => {
    const result = view('photo', [guess('not-a-bird', 0.8), guess('parus-major', 0.7)])
    expect(result.candidates.map((c) => c.speciesId)).toEqual(['parus-major'])
    // 0.7 trails the missing 0.8 by 0.1: not a clear lead, so the Catch button stays off.
    expect(result.candidates[0]).toMatchObject({ allowed: false, reason: 'unclear-margin' })
  })

  it('says "empty" when there is nothing to show', () => {
    const none = view('sound', [])
    expect(none.empty).toBe(true)
    expect(none.anyAllowed).toBe(false)
    expect(none.candidates).toEqual([])
    expect(view('photo', [guess('not-a-bird', 0.9)]).empty).toBe(true)
  })

  it('shows at most three guesses, each species once', () => {
    const result = view('sound', [
      guess('parus-major', 0.9),
      guess('parus-major', 0.5),
      guess('turdus-merula', 0.4),
      guess('erithacus-rubecula', 0.3),
      guess('anas-platyrhynchos', 0.2),
    ])
    expect(result.candidates.map((c) => c.speciesId)).toEqual(['parus-major', 'turdus-merula', 'erithacus-rubecula'])
  })
})

describe('texts and routes of the result', () => {
  it('picks the Czech sentence for a blocked guess', () => {
    expect(reasonKey('low-confidence')).toBe('result.reason.lowConfidence')
    expect(reasonKey('unclear-margin')).toBe('result.reason.unclear')
  })

  it('sends "try again" back to the screen that made the scan', () => {
    expect(scanPathFor('sound')).toBe('/scan/sound')
    expect(scanPathFor('photo')).toBe('/scan/photo')
    expect(scanPathFor('live')).toBe('/scan/live')
  })

  it('says in the question what is saved with the bird: photo, recording, or neither', () => {
    const blob = new Blob(['x'])
    expect(confirmTextKey({ kind: 'image', blob, mime: 'image/jpeg' })).toBe('result.confirm.withPhoto')
    expect(confirmTextKey({ kind: 'audio', blob, mime: 'audio/wav' })).toBe('result.confirm.withSound')
    expect(confirmTextKey(undefined)).toBe('result.confirm.withoutMedia')
  })
})
