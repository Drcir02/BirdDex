import { describe, expect, it } from 'vitest'
import { FRESH_PHOTO_MS, parseExifDate, parseExifMeta, photoContext } from '../../src/features/scan/exifMeta'
import { buildJpeg } from './helpers/exif-jpeg'

describe('parseExifDate', () => {
  it('reads the camera format as local time', () => {
    expect(parseExifDate('2026:10:17 09:15:30')).toBe(new Date(2026, 9, 17, 9, 15, 30).getTime())
  })

  it('refuses anything that is not a date', () => {
    for (const text of [undefined, '', '0000:00:00 00:00:00', 'yesterday', '2026:13:01 00:00:00', '1980:01:01 00:00:00']) expect(parseExifDate(text)).toBeUndefined()
  })
})

describe('parseExifMeta', () => {
  it('reads the date and the place of a photo', () => {
    const jpeg = buildJpeg({ date: '2026:05:03 07:30:00', gps: { latRef: 'N', lat: [50, 4, 48], lonRef: 'E', lon: [14, 25, 48] } })
    const meta = parseExifMeta(jpeg)
    expect(meta.takenAt).toBe(new Date(2026, 4, 3, 7, 30, 0).getTime())
    expect(meta.location?.lat).toBeCloseTo(50.08, 4)
    expect(meta.location?.lon).toBeCloseTo(14.43, 4)
  })

  it('uses the signs of the south and the west', () => {
    const meta = parseExifMeta(buildJpeg({ gps: { latRef: 'S', lat: [33, 0, 0], lonRef: 'W', lon: [70, 30, 0] } }))
    expect(meta.location).toEqual({ lat: -33, lon: -70.5 })
  })

  it('knows a photo without a place and ignores a position of 0, 0', () => {
    expect(parseExifMeta(buildJpeg({ date: '2026:05:03 07:30:00' })).location).toBeUndefined()
    expect(parseExifMeta(buildJpeg({ gps: { latRef: 'N', lat: [0, 0, 0], lonRef: 'E', lon: [0, 0, 0] } })).location).toBeUndefined()
  })

  it('gives nothing for a file that is not a JPEG, or is cut short, and never throws', () => {
    expect(parseExifMeta(new Uint8Array([1, 2, 3]))).toEqual({})
    expect(parseExifMeta(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0, 0, 0, 0]))).toEqual({})
    const jpeg = buildJpeg({ date: '2026:05:03 07:30:00', gps: { latRef: 'N', lat: [50, 4, 48], lonRef: 'E', lon: [14, 25, 48] } })
    expect(() => parseExifMeta(jpeg.slice(0, 60))).not.toThrow()
    expect(() => parseExifMeta(jpeg.slice(0, 20))).not.toThrow()
  })
})

describe('photoContext', () => {
  const now = new Date(2026, 9, 17, 12, 0, 0).getTime()
  const prague = { lat: 50.08, lon: 14.43 }

  it('uses the phone place and the present for a photo that says nothing', () => {
    expect(photoContext({}, now, prague)).toEqual({ at: now, location: prague, usePhoneLocation: true })
  })

  it('uses the phone place for a photo just taken', () => {
    const taken = now - 60_000
    expect(photoContext({ takenAt: taken }, now, prague)).toEqual({ at: taken, location: prague, usePhoneLocation: true })
  })

  it('does not give an old photo the place of the phone', () => {
    const taken = now - FRESH_PHOTO_MS - 1
    expect(photoContext({ takenAt: taken }, now, prague)).toEqual({ at: taken, location: undefined, usePhoneLocation: false })
  })

  it('keeps the place of the photo itself, also when it is old', () => {
    const brno = { lat: 49.19, lon: 16.61 }
    const taken = new Date(2025, 4, 1).getTime()
    expect(photoContext({ takenAt: taken, location: brno }, now, prague)).toEqual({ at: taken, location: brno, usePhoneLocation: false })
  })

  it('does not trust a date from the future', () => {
    expect(photoContext({ takenAt: now + 10 * 24 * 3600 * 1000 }, now, prague).at).toBe(now)
  })
})
