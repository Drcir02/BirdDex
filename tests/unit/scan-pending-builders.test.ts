import { describe, expect, it } from 'vitest'
import type { Candidate } from '../../src/domain/types'
import { buildLivePending, buildPhotoPending, buildSoundPending, MAX_CANDIDATES, MIN_SHOWN_CONFIDENCE, normalizeCandidates } from '../../src/features/scan/pendingBuilders'

const guess = (speciesId: string, confidence: number): Candidate => ({ speciesId, confidence })
const WHERE = { lat: 50.08, lon: 14.43, accuracyM: 30 }

describe('normalizeCandidates', () => {
  it('sorts the strongest first and keeps three', () => {
    const out = normalizeCandidates([guess('a', 0.2), guess('b', 0.9), guess('c', 0.5), guess('d', 0.7)])
    expect(out.map((c) => c.speciesId)).toEqual(['b', 'd', 'c'])
    expect(MAX_CANDIDATES).toBe(3)
  })

  it('keeps the best entry of a species that appears twice', () => {
    expect(normalizeCandidates([guess('a', 0.3), guess('a', 0.8), guess('b', 0.5)])).toEqual([guess('a', 0.8), guess('b', 0.5)])
  })

  it('drops entries with a broken number or no species, and clamps the rest to 0..1', () => {
    const out = normalizeCandidates([guess('a', Number.NaN), guess('', 0.9), guess('b', 1.7), guess('c', -0.2), guess('d', Number.POSITIVE_INFINITY)])
    expect(out).toEqual([guess('b', 1)])
  })

  it('leaves out guesses that would be shown as 0 %, but keeps small ones that show as 1 % or more', () => {
    expect(MIN_SHOWN_CONFIDENCE).toBe(0.005)
    expect(normalizeCandidates([guess('a', 1), guess('b', 0.004), guess('c', 0), guess('d', 0.005), guess('e', 0.02)])).toEqual([guess('a', 1), guess('e', 0.02), guess('d', 0.005)])
    expect(normalizeCandidates([guess('a', 0.001), guess('b', 0)])).toEqual([])
  })

  it('gives an empty list for nothing, and does not change its input', () => {
    expect(normalizeCandidates(undefined)).toEqual([])
    expect(normalizeCandidates([])).toEqual([])
    const input = [guess('a', 0.2), guess('b', 0.9)]
    normalizeCandidates(input)
    expect(input.map((c) => c.speciesId)).toEqual(['a', 'b'])
  })

  it('honours another limit', () => {
    expect(normalizeCandidates([guess('a', 0.2), guess('b', 0.9)], 1)).toEqual([guess('b', 0.9)])
    expect(normalizeCandidates([guess('a', 0.2)], 0)).toEqual([])
  })
})

describe('buildSoundPending', () => {
  it('puts the clip in as audio media, with its length', () => {
    const clip = new Blob(['RIFF'], { type: 'audio/wav' })
    const pending = buildSoundPending({ candidates: [guess('parus-major', 0.9)], clip, clipSeconds: 2.5 }, WHERE, 1234)
    expect(pending.method).toBe('sound')
    expect(pending.createdAt).toBe(1234)
    expect(pending.location).toEqual(WHERE)
    expect(pending.media).toEqual({ kind: 'audio', blob: clip, mime: 'audio/wav', durationS: 2.5 })
    expect(pending.candidates).toEqual([guess('parus-major', 0.9)])
  })

  it('has no media when the engine kept no clip, or an empty one', () => {
    expect(buildSoundPending({ candidates: [] }, undefined).media).toBeUndefined()
    expect(buildSoundPending({ candidates: [], clip: new Blob([]) }, undefined).media).toBeUndefined()
  })

  it('has no location when the phone gave none', () => {
    const pending = buildSoundPending({ candidates: [] }, undefined)
    expect('location' in pending).toBe(false)
  })

  it('falls back to audio/wav for a clip without a type and leaves out a length that is not a number', () => {
    const pending = buildSoundPending({ candidates: [], clip: new Blob(['x']), clipSeconds: Number.NaN }, undefined)
    expect(pending.media).toEqual({ kind: 'audio', blob: expect.any(Blob), mime: 'audio/wav' })
  })
})

describe('buildPhotoPending', () => {
  it('is a photo with the picture as image media', () => {
    const image = new Blob(['jpeg'], { type: 'image/jpeg' })
    const pending = buildPhotoPending({ candidates: [guess('anas-platyrhynchos', 0.99), guess('parus-major', 0.01)] }, image, WHERE, 99)
    expect(pending).toEqual({
      method: 'photo',
      candidates: [guess('anas-platyrhynchos', 0.99), guess('parus-major', 0.01)],
      media: { kind: 'image', blob: image, mime: 'image/jpeg' },
      location: WHERE,
      createdAt: 99,
    })
  })

  it('keeps an empty list of guesses (no bird in the picture) and the picture', () => {
    const pending = buildPhotoPending({ candidates: [] }, new Blob(['x']), undefined)
    expect(pending.candidates).toEqual([])
    expect(pending.media?.mime).toBe('image/jpeg')
  })
})

describe('buildLivePending', () => {
  it('is a live catch with the snapshot as image media, and keeps the order of the scanner', () => {
    const snapshot = new Blob(['jpeg'], { type: 'image/jpeg' })
    const pending = buildLivePending({ candidates: [guess('turdus-merula', 0.7), guess('parus-major', 0.2)] }, snapshot, WHERE, 5)
    expect(pending.method).toBe('live')
    expect(pending.candidates.map((c) => c.speciesId)).toEqual(['turdus-merula', 'parus-major'])
    expect(pending.media).toEqual({ kind: 'image', blob: snapshot, mime: 'image/jpeg' })
    expect(pending.location).toEqual(WHERE)
    expect(pending.createdAt).toBe(5)
  })

  it('stamps the time of now by default', () => {
    const before = Date.now()
    const pending = buildLivePending({ candidates: [] }, new Blob(['x']), undefined)
    expect(pending.createdAt).toBeGreaterThanOrEqual(before)
    expect(pending.createdAt).toBeLessThanOrEqual(Date.now())
  })
})

describe('the numbers about the picture', () => {
  it('copies pBird and outsideDexTop of a photo and of a live update onto the pending identification', () => {
    const photo = buildPhotoPending({ candidates: [guess('anas-platyrhynchos', 0.9)], pBird: 0.93, outsideDexTop: 0.31 }, new Blob(['x']), undefined)
    expect(photo).toMatchObject({ pBird: 0.93, outsideDexTop: 0.31 })
    const live = buildLivePending({ candidates: [guess('anas-platyrhynchos', 0.9)], pBird: 0.97, outsideDexTop: 0.02 }, new Blob(['x']), undefined)
    expect(live).toMatchObject({ pBird: 0.97, outsideDexTop: 0.02 })
  })

  it('leaves them out when the engine gave none or a broken number (fakes), and for sound', () => {
    const plain = buildPhotoPending({ candidates: [guess('anas-platyrhynchos', 0.9)], pBird: Number.NaN }, new Blob(['x']), undefined)
    expect('pBird' in plain).toBe(false)
    expect('outsideDexTop' in plain).toBe(false)
    expect('pBird' in buildSoundPending({ candidates: [guess('anas-platyrhynchos', 0.9)] }, undefined)).toBe(false)
  })
})
