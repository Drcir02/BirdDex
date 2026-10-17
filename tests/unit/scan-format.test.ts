import { describe, expect, it } from 'vitest'
import { approxMegabytes, describePlace, formatCoordinates, formatElapsed, wholeMegabytes } from '../../src/features/scan/format'
import { photoProblemKey, photoReducer, INITIAL_PHOTO_STATE, type PhotoScanState } from '../../src/features/scan/photoScan'
import { FULL_CROP } from '../../src/features/scan/cropMath'

describe('formatElapsed', () => {
  it('writes minutes and two-digit seconds', () => {
    expect(formatElapsed(0)).toBe('0:00')
    expect(formatElapsed(7300)).toBe('0:07')
    expect(formatElapsed(59_999)).toBe('0:59')
    expect(formatElapsed(60_000)).toBe('1:00')
    expect(formatElapsed(65_000)).toBe('1:05')
  })

  it('treats negative and broken values as zero', () => {
    expect(formatElapsed(-4000)).toBe('0:00')
    expect(formatElapsed(Number.NaN)).toBe('0:00')
    expect(formatElapsed(Number.POSITIVE_INFINITY)).toBe('0:00')
  })
})

describe('megabytes', () => {
  it('rounds to whole megabytes, 1 MB = 1 000 000 bytes', () => {
    expect(wholeMegabytes(88_749_000)).toBe(89)
    expect(wholeMegabytes(0)).toBe(0)
    expect(wholeMegabytes(Number.NaN)).toBe(0)
    expect(wholeMegabytes(-1)).toBe(0)
  })

  it('gives the friendly size of the whole download: about 90 MB, as the banner says', () => {
    // BirdNET 25.9 + 14.8 and WingCLIP 14.4 + 25.2 + 8.5 (BRIEF section 2).
    expect(approxMegabytes(25_932_528 + 14_770_468 + 14_386_564 + 25_165_824 + 8_488_140)).toBe(90)
    expect(approxMegabytes(25_932_528 + 14_770_468)).toBe(40)
    expect(approxMegabytes(14_386_564 + 25_165_824 + 8_488_140)).toBe(50)
  })

  it('never says 0 MB for something that is there, and 0 for nothing', () => {
    expect(approxMegabytes(100_000)).toBe(5)
    expect(approxMegabytes(0)).toBe(0)
    expect(approxMegabytes(Number.NaN)).toBe(0)
  })
})

describe('coordinates and places', () => {
  it('writes the position the Czech way: two decimals with a comma, S/J and V/Z', () => {
    expect(formatCoordinates({ lat: 50.0833, lon: 14.4333 })).toBe('50,08° S, 14,43° V')
    expect(formatCoordinates({ lat: -33.8688, lon: -70.6693 })).toBe('33,87° J, 70,67° Z')
  })

  it('prefers the name of the place, then the coordinates, then "unknown"', () => {
    const where = { lat: 50.08, lon: 14.43 }
    expect(describePlace(where, 'Praha')).toEqual({ kind: 'name', text: 'Praha' })
    expect(describePlace(where, '  ')).toEqual({ kind: 'coordinates', text: '50,08° S, 14,43° V' })
    expect(describePlace(where)).toEqual({ kind: 'coordinates', text: '50,08° S, 14,43° V' })
    expect(describePlace(undefined)).toEqual({ kind: 'unknown', text: 'Místo neznámé' })
    expect(describePlace({ lat: Number.NaN, lon: 1 })).toEqual({ kind: 'unknown', text: 'Místo neznámé' })
  })
})

describe('photoReducer', () => {
  const preview = { url: 'blob:x', width: 960, height: 640 }
  const open = (): PhotoScanState => photoReducer(photoReducer(INITIAL_PHOTO_STATE, { type: 'opening' }), { type: 'opened', preview })

  it('goes from the two buttons through opening to the preview, with the whole photo selected', () => {
    expect(INITIAL_PHOTO_STATE).toMatchObject({ phase: 'choose', crop: FULL_CROP })
    expect(photoReducer(INITIAL_PHOTO_STATE, { type: 'opening' }).phase).toBe('opening')
    expect(open()).toMatchObject({ phase: 'preview', preview, crop: FULL_CROP })
  })

  it('keeps the crop box while previewing, and forgets it for the next photo', () => {
    const cropped = photoReducer(open(), { type: 'crop', crop: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 } })
    expect(cropped.crop).toEqual({ x: 0.1, y: 0.1, w: 0.5, h: 0.5 })
    const next = photoReducer(photoReducer(cropped, { type: 'opening' }), { type: 'opened', preview })
    expect(next.crop).toEqual(FULL_CROP)
  })

  it('ignores a crop while no photo is shown', () => {
    expect(photoReducer(INITIAL_PHOTO_STATE, { type: 'crop', crop: { x: 0, y: 0, w: 0.5, h: 0.5 } })).toBe(INITIAL_PHOTO_STATE)
  })

  it('explains a bad file at the two buttons when there was no photo before', () => {
    const state = photoReducer(photoReducer(INITIAL_PHOTO_STATE, { type: 'opening' }), { type: 'problem', problem: 'heic' })
    expect(state).toMatchObject({ phase: 'choose', problem: 'heic' })
    expect(state.preview).toBeUndefined()
  })

  it('keeps the photo that is shown when the next file turns out to be unusable', () => {
    const state = photoReducer(open(), { type: 'problem', problem: 'notImage' })
    expect(state).toMatchObject({ phase: 'preview', problem: 'notImage', preview })
  })

  it('identifies, and comes back to the preview with the reason when that fails', () => {
    const working = photoReducer(open(), { type: 'identifying' })
    expect(working.phase).toBe('identifying')
    const failed = photoReducer(working, { type: 'failed', error: 'modelLoad' })
    expect(failed).toMatchObject({ phase: 'preview', failure: 'modelLoad', preview })
    expect(photoReducer(failed, { type: 'identifying' }).failure).toBeUndefined()
  })

  it('does not identify without a photo, and ignores a failure nobody waits for', () => {
    expect(photoReducer(INITIAL_PHOTO_STATE, { type: 'identifying' })).toBe(INITIAL_PHOTO_STATE)
    expect(photoReducer(open(), { type: 'failed', error: 'generic' })).toMatchObject({ phase: 'preview' })
    expect(photoReducer(open(), { type: 'failed', error: 'generic' }).failure).toBeUndefined()
  })

  it('goes back to the beginning', () => {
    expect(photoReducer(open(), { type: 'reset' })).toBe(INITIAL_PHOTO_STATE)
  })

  it('has a Czech message for every problem a file can have', () => {
    expect(photoProblemKey('heic')).toBe('scan.photo.errors.heic')
    expect(photoProblemKey('notImage')).toBe('scan.photo.errors.notImage')
    expect(photoProblemKey('unreadable')).toBe('scan.photo.errors.unreadable')
    expect(photoProblemKey('tooBig')).toBe('scan.photo.errors.tooBig')
    expect(photoProblemKey('empty')).toBe('scan.photo.errors.empty')
  })
})
