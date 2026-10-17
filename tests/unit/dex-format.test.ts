import { describe, expect, it } from 'vitest'
import { computeEnvelope, envelopeOfWav } from '../../src/features/dex/audioEnvelope'
import { formatClock, formatCoordinates, isValidPoint, mapUrl, placeOf, savesImage, starsFor } from '../../src/features/dex/format'
import { fitWithin } from '../../src/features/dex/thumbnails'
import { encodeWav } from '../../src/ml/audio/wav'

describe('formatCoordinates', () => {
  it('writes rounded Czech coordinates with the hemisphere', () => {
    expect(formatCoordinates({ lat: 50.0755, lon: 14.4378 })).toBe('50,08° s. š., 14,44° v. d.')
    expect(formatCoordinates({ lat: 49.1, lon: 16 })).toBe('49,10° s. š., 16,00° v. d.')
  })

  it('knows south and west', () => {
    expect(formatCoordinates({ lat: -33.8688, lon: -70.6693 })).toBe('33,87° j. š., 70,67° z. d.')
    expect(formatCoordinates({ lat: 36.0143, lon: -5.6044 })).toBe('36,01° s. š., 5,60° z. d.')
  })
})

describe('mapUrl', () => {
  it('opens the place on OpenStreetMap', () => {
    const url = new URL(mapUrl({ lat: 50.0755, lon: 14.4378 }))
    expect(url.origin).toBe('https://www.openstreetmap.org')
    expect(url.searchParams.get('mlat')).toBe('50.07550')
    expect(url.searchParams.get('mlon')).toBe('14.43780')
    expect(url.hash).toBe('#map=15/50.07550/14.43780')
  })
})

describe('placeOf', () => {
  const point = { lat: 50.08, lon: 14.43 }

  it('prefers the place name and keeps the point for the map link', () => {
    expect(placeOf({ placeName: 'Praha', location: point })).toEqual({ kind: 'name', text: 'Praha', point })
    expect(placeOf({ placeName: '  Brno ' })).toEqual({ kind: 'name', text: 'Brno' })
  })

  it('falls back to rounded coordinates', () => {
    expect(placeOf({ location: point })).toEqual({ kind: 'coordinates', text: '50,08° s. š., 14,43° v. d.', point })
    expect(placeOf({ placeName: '   ', location: point })).toMatchObject({ kind: 'coordinates' })
  })

  it('has nothing to show without a name or a usable point', () => {
    expect(placeOf({})).toEqual({ kind: 'none' })
    expect(placeOf({ location: { lat: Number.NaN, lon: 1 } })).toEqual({ kind: 'none' })
    expect(placeOf({ location: { lat: 123, lon: 1 } })).toEqual({ kind: 'none' })
  })

  it('validates points', () => {
    expect(isValidPoint({ lat: 0, lon: 0 })).toBe(true)
    expect(isValidPoint({ lat: 91, lon: 0 })).toBe(false)
    expect(isValidPoint({ lat: 0, lon: 181 })).toBe(false)
    expect(isValidPoint({ lat: Number.POSITIVE_INFINITY, lon: 0 })).toBe(false)
    expect(isValidPoint(undefined)).toBe(false)
  })
})

describe('small helpers', () => {
  it('writes a clock', () => {
    expect(formatClock(0)).toBe('0:00')
    expect(formatClock(4.9)).toBe('0:04')
    expect(formatClock(65)).toBe('1:05')
    expect(formatClock(600)).toBe('10:00')
    expect(formatClock(Number.NaN)).toBe('0:00')
    expect(formatClock(Number.POSITIVE_INFINITY)).toBe('0:00')
    expect(formatClock(-3)).toBe('0:00')
  })

  it('gives one star for common up to five for legendary', () => {
    expect(['common', 'uncommon', 'rare', 'epic', 'legendary'].map((rarity) => starsFor(rarity as 'common'))).toEqual([1, 2, 3, 4, 5])
  })

  it('knows which methods save a picture', () => {
    expect(savesImage('photo')).toBe(true)
    expect(savesImage('live')).toBe(true)
    expect(savesImage('sound')).toBe(false)
  })

  it('shrinks a picture to a longer side and never enlarges it', () => {
    expect(fitWithin(4000, 3000, 400)).toEqual({ width: 400, height: 300 })
    expect(fitWithin(3000, 4000, 400)).toEqual({ width: 300, height: 400 })
    expect(fitWithin(200, 100, 400)).toEqual({ width: 200, height: 100 })
    expect(fitWithin(10000, 1, 400)).toEqual({ width: 400, height: 1 })
    expect(fitWithin(0, 0, 400)).toEqual({ width: 1, height: 1 })
  })
})

describe('the level bar of a recording', () => {
  it('measures the loudness of equal slices, scaled to the loudest', () => {
    const samples = new Float32Array(400)
    samples.fill(0.5, 100, 200) // the second quarter is loud
    samples.fill(0.25, 200, 300) // the third quarter is half as loud
    const bars = computeEnvelope(samples, 4)
    expect(bars[0]).toBe(0)
    expect(bars[1]).toBeCloseTo(1, 6)
    expect(bars[2]).toBeCloseTo(0.5, 6)
    expect(bars[3]).toBe(0)
  })

  it('shows silence as flat bars and an empty clip as zeros', () => {
    expect(computeEnvelope(new Float32Array(100), 5)).toEqual([0, 0, 0, 0, 0])
    expect(computeEnvelope(new Float32Array(0), 3)).toEqual([0, 0, 0])
  })

  it('has more bars than samples without breaking', () => {
    expect(computeEnvelope(Float32Array.from([1, -1]), 8)).toHaveLength(8)
  })

  it('reads the loudness from a WAV file and gives up quietly on anything else', () => {
    const rate = 8000
    const samples = new Float32Array(rate)
    for (let index = 0; index < samples.length; index += 1) samples[index] = index < rate / 2 ? 0 : 0.8 * Math.sin(index / 5)
    const bars = envelopeOfWav(encodeWav(samples, rate), 10)
    expect(bars).toHaveLength(10)
    expect(Math.max(...(bars ?? [0]).slice(0, 4))).toBeLessThan(0.05)
    expect(Math.min(...(bars ?? [0]).slice(6))).toBeGreaterThan(0.5)
    expect(envelopeOfWav(new Uint8Array([1, 2, 3]))).toBeUndefined()
    expect(envelopeOfWav(new TextEncoder().encode('not audio at all, just some text'))).toBeUndefined()
  })
})
