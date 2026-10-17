import { describe, expect, it } from 'vitest'
import { CATCH_RULES, catchRule, evaluateCandidates } from '../../src/domain/thresholds'
import type { Candidate, CatchMethod, Sensitivity } from '../../src/domain/types'

const guesses = (...scores: number[]): Candidate[] => scores.map((confidence, index) => ({ speciesId: `species-${index}`, confidence }))
const allowed = (candidates: Candidate[], method: CatchMethod, sensitivity: Sensitivity = 'normal') =>
  evaluateCandidates(candidates, method, sensitivity).map((verdict) => verdict.allowed)
const reasons = (candidates: Candidate[], method: CatchMethod, sensitivity: Sensitivity = 'normal') =>
  evaluateCandidates(candidates, method, sensitivity).map((verdict) => verdict.reason)

describe('catch rules', () => {
  it('uses the values measured with the real models', () => {
    expect(CATCH_RULES.sound.normal.minConfidence).toBe(0.7)
    expect(CATCH_RULES.sound.strict.minConfidence).toBe(0.85)
    expect(CATCH_RULES.sound.easy.minConfidence).toBe(0.6)
    expect(CATCH_RULES.photo.normal.minConfidence).toBe(0.7)
    expect(CATCH_RULES.photo.strict.minConfidence).toBe(0.85)
    expect(CATCH_RULES.photo.easy.minConfidence).toBe(0.55)
  })

  it('asks for a lead over the second guess for pictures but not for sound', () => {
    for (const sensitivity of ['strict', 'normal', 'easy'] as const) {
      expect(CATCH_RULES.sound[sensitivity].minMargin).toBe(0)
      expect(CATCH_RULES.photo[sensitivity].minMargin).toBeGreaterThan(0)
    }
  })

  it('gets stricter from easy to normal to strict, for every method', () => {
    for (const method of ['sound', 'photo', 'live'] as const) {
      const { easy, normal, strict } = CATCH_RULES[method]
      expect(easy.minConfidence).toBeLessThan(normal.minConfidence)
      expect(normal.minConfidence).toBeLessThan(strict.minConfidence)
      expect(easy.minMargin).toBeLessThanOrEqual(normal.minMargin)
      expect(normal.minMargin).toBeLessThanOrEqual(strict.minMargin)
    }
  })

  it('treats the live camera like a photo', () => {
    expect(CATCH_RULES.live).toEqual(CATCH_RULES.photo)
    expect(catchRule('live', 'easy')).toEqual(catchRule('photo', 'easy'))
  })
})

describe('evaluateCandidates for sound', () => {
  it('allows a guess exactly on the threshold and blocks one just below it', () => {
    expect(allowed(guesses(0.7), 'sound')).toEqual([true])
    expect(allowed(guesses(0.6999), 'sound')).toEqual([false])
    expect(reasons(guesses(0.6999), 'sound')).toEqual(['low-confidence'])
  })

  it('follows the sensitivity setting', () => {
    const score = guesses(0.6)
    expect(allowed(score, 'sound', 'easy')).toEqual([true])
    expect(allowed(score, 'sound', 'normal')).toEqual([false])
    expect(allowed(score, 'sound', 'strict')).toEqual([false])
    expect(allowed(guesses(0.9), 'sound', 'strict')).toEqual([true])
    expect(allowed(guesses(0.84), 'sound', 'strict')).toEqual([false])
  })

  it('lets two birds singing together both be caught, because sound scores do not compete', () => {
    expect(allowed(guesses(0.91, 0.9, 0.2), 'sound')).toEqual([true, true, false])
    expect(allowed(guesses(0.8, 0.8), 'sound')).toEqual([true, true])
  })
})

describe('evaluateCandidates for photos and the live camera', () => {
  it.each(['photo', 'live'] as const)('allows a clear winner and blocks the guesses behind it (%s)', (method) => {
    const verdicts = evaluateCandidates(guesses(0.8, 0.12, 0.05), method, 'normal')
    expect(verdicts.map((verdict) => verdict.allowed)).toEqual([true, false, false])
    expect(verdicts.map((verdict) => verdict.reason)).toEqual([undefined, 'low-confidence', 'low-confidence'])
  })

  it('blocks a confident top guess that is too close to the second one', () => {
    const verdicts = evaluateCandidates(guesses(0.78, 0.74), 'photo', 'normal')
    expect(verdicts[0]).toMatchObject({ allowed: false, reason: 'unclear-margin' })
    expect(verdicts[0].margin).toBeCloseTo(0.04, 10)
    // The second guess is confident enough too, but it trails the first one, so it is unclear as well.
    expect(verdicts[1]).toMatchObject({ allowed: false, reason: 'unclear-margin' })
    expect(verdicts[1].margin).toBeCloseTo(-0.04, 10)
  })

  it('names low confidence first when both rules fail', () => {
    expect(reasons(guesses(0.3, 0.29), 'photo')).toEqual(['low-confidence', 'low-confidence'])
  })

  it('works out the margin for easy and strict settings', () => {
    expect(allowed(guesses(0.55, 0.42), 'photo', 'easy')).toEqual([true, false])
    expect(allowed(guesses(0.5, 0.45), 'photo', 'easy')).toEqual([false, false])
    expect(allowed(guesses(0.8, 0.6), 'photo', 'strict')).toEqual([false, false])
    expect(allowed(guesses(0.9, 0.1), 'photo', 'strict')).toEqual([true, false])
  })

  it('does not refuse a guess because of floating point noise at the edge of a rule', () => {
    // 0.7 - 0.5 is 0.19999999999999996 in floating point, yet the lead is exactly the 0.2 that "normal" asks for.
    expect(0.7 - 0.5).toBeLessThan(0.2)
    expect(allowed(guesses(0.7, 0.5), 'photo', 'normal')).toEqual([true, false])
    // The same for the confidence itself: a hair below the threshold is noise, a visible gap is not.
    expect(allowed(guesses(0.7 - 1e-12), 'photo', 'normal')).toEqual([true])
    expect(allowed(guesses(0.7 - 1e-6), 'photo', 'normal')).toEqual([false])
  })
})

describe('evaluateCandidates edge cases', () => {
  it('returns nothing when there are no guesses', () => {
    expect(evaluateCandidates([], 'sound', 'normal')).toEqual([])
    expect(evaluateCandidates([], 'photo', 'strict')).toEqual([])
  })

  it('judges a single guess on its confidence alone, and reports its confidence as the lead', () => {
    const [verdict] = evaluateCandidates(guesses(0.72), 'photo', 'normal')
    expect(verdict).toMatchObject({ speciesId: 'species-0', confidence: 0.72, allowed: true })
    expect(verdict.margin).toBeCloseTo(0.72, 10)
    expect(verdict.reason).toBeUndefined()
    expect(allowed(guesses(0.69), 'photo')).toEqual([false])
    expect(reasons(guesses(0.69), 'photo')).toEqual(['low-confidence'])
  })

  it('treats equal scores as a tie: nobody leads, so pictures are blocked and sound is not', () => {
    expect(allowed(guesses(0.8, 0.8), 'photo')).toEqual([false, false])
    expect(reasons(guesses(0.8, 0.8), 'photo')).toEqual(['unclear-margin', 'unclear-margin'])
    expect(allowed(guesses(0.9, 0.9, 0.9), 'live')).toEqual([false, false, false])
    expect(evaluateCandidates(guesses(0.8, 0.8), 'photo', 'normal').map((verdict) => verdict.margin)).toEqual([0, 0])
  })

  it('does not need the guesses to be sorted, and keeps the input order', () => {
    const verdicts = evaluateCandidates(guesses(0.1, 0.85, 0.3), 'photo', 'normal')
    expect(verdicts.map((verdict) => verdict.speciesId)).toEqual(['species-0', 'species-1', 'species-2'])
    expect(verdicts.map((verdict) => verdict.allowed)).toEqual([false, true, false])
    expect(verdicts[1].margin).toBeCloseTo(0.55, 10)
    expect(verdicts[0].margin).toBeCloseTo(-0.75, 10)
  })

  it('compares each guess with the strongest of the others when the leader appears later in the list', () => {
    const verdicts = evaluateCandidates(guesses(0.5, 0.62, 0.9), 'photo', 'normal')
    expect(verdicts.map((verdict) => verdict.allowed)).toEqual([false, false, true])
    expect(verdicts[2].margin).toBeCloseTo(0.28, 10)
    expect(verdicts[1].margin).toBeCloseTo(-0.28, 10)
  })

  it('does not change its input', () => {
    const input = guesses(0.9, 0.2)
    const copy = structuredClone(input)
    evaluateCandidates(input, 'photo', 'normal')
    expect(input).toEqual(copy)
  })

  it('treats a missing number (NaN) as no confidence at all instead of throwing', () => {
    const verdicts = evaluateCandidates(guesses(Number.NaN, 0.9), 'photo', 'normal')
    expect(verdicts[0]).toMatchObject({ confidence: 0, allowed: false, reason: 'low-confidence' })
    expect(verdicts[1].allowed).toBe(true)
  })

  it('copes with a confidence of exactly 0 and exactly 1', () => {
    expect(allowed(guesses(1), 'photo', 'strict')).toEqual([true])
    expect(allowed(guesses(1, 0), 'photo', 'strict')).toEqual([true, false])
    expect(allowed(guesses(0), 'sound', 'easy')).toEqual([false])
  })

  it('is allowed exactly when no reason is given', () => {
    for (const method of ['sound', 'photo', 'live'] as const) {
      for (const sensitivity of ['strict', 'normal', 'easy'] as const) {
        for (const first of [0.1, 0.45, 0.55, 0.6, 0.7, 0.75, 0.85, 0.95]) {
          for (const second of [0, 0.2, 0.5, first]) {
            for (const verdict of evaluateCandidates(guesses(first, second), method, sensitivity)) {
              expect(verdict.allowed).toBe(verdict.reason === undefined)
            }
          }
        }
      }
    }
  })
})
