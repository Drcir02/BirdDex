import { describe, expect, it } from 'vitest'
import {
  checkImageFile,
  fitWithin,
  looksLikeHeic,
  MAX_FILE_BYTES,
  planHalvingSteps,
  SAVED_JPEG_QUALITY,
  SAVED_SIDE,
  WORKING_SIDE,
} from '../../src/features/scan/imageSizing'

describe('the numbers of the photo screen', () => {
  it('saves at most 1280 pixels as JPEG quality 0.85, as the brief says', () => {
    expect(SAVED_SIDE).toBe(1280)
    expect(SAVED_JPEG_QUALITY).toBe(0.85)
    expect(WORKING_SIDE).toBeGreaterThan(SAVED_SIDE)
  })
})

describe('fitWithin', () => {
  it('scales a big photo down to the long side, keeping the shape', () => {
    expect(fitWithin(4032, 3024, 1280)).toEqual({ width: 1280, height: 960 })
    expect(fitWithin(3024, 4032, 1280)).toEqual({ width: 960, height: 1280 })
  })

  it('never enlarges a small picture', () => {
    expect(fitWithin(640, 480, 1280)).toEqual({ width: 640, height: 480 })
    expect(fitWithin(1280, 1280, 1280)).toEqual({ width: 1280, height: 1280 })
  })

  it('handles a huge panorama and a thin strip without a zero side', () => {
    expect(fitWithin(12000, 100, 1280)).toEqual({ width: 1280, height: 11 })
    expect(fitWithin(100000, 10, 1280)).toEqual({ width: 1280, height: 1 })
  })

  it('rounds to whole pixels and keeps at least one', () => {
    expect(fitWithin(0.4, 0.2, 1280)).toEqual({ width: 1, height: 1 })
    const out = fitWithin(1001, 777, 500)
    expect(Number.isInteger(out.width)).toBe(true)
    expect(Number.isInteger(out.height)).toBe(true)
    expect(Math.max(out.width, out.height)).toBe(500)
  })

  it('leaves a picture alone when the limit makes no sense', () => {
    expect(fitWithin(800, 600, 0)).toEqual({ width: 800, height: 600 })
  })
})

describe('planHalvingSteps', () => {
  it('uses one step when the picture is less than twice as big as the target', () => {
    expect(planHalvingSteps({ width: 3000, height: 2000 }, { width: 2048, height: 1365 })).toEqual([{ width: 2048, height: 1365 }])
  })

  it('halves again and again for a very big picture, and ends exactly on the target', () => {
    const steps = planHalvingSteps({ width: 8064, height: 6048 }, { width: 2048, height: 1536 })
    expect(steps[0]).toEqual({ width: 4032, height: 3024 })
    expect(steps[steps.length - 1]).toEqual({ width: 2048, height: 1536 })
    for (let i = 1; i < steps.length; i++) {
      expect(steps[i].width).toBeLessThan(steps[i - 1].width)
      expect(steps[i - 1].width / steps[i].width).toBeLessThanOrEqual(2.001)
    }
  })

  it('still makes one drawing when the picture already has the target size', () => {
    expect(planHalvingSteps({ width: 640, height: 480 }, { width: 640, height: 480 })).toEqual([{ width: 640, height: 480 }])
  })
})

describe('looksLikeHeic', () => {
  it('knows HEIC and HEIF by type and by file name', () => {
    expect(looksLikeHeic({ type: 'image/heic', name: 'a' })).toBe(true)
    expect(looksLikeHeic({ type: 'image/heif', name: 'a' })).toBe(true)
    expect(looksLikeHeic({ type: '', name: 'IMG_0001.HEIC' })).toBe(true)
    expect(looksLikeHeic({ type: '', name: 'photo.heif' })).toBe(true)
  })

  it('does not take other pictures for HEIC', () => {
    expect(looksLikeHeic({ type: 'image/jpeg', name: 'a.jpg' })).toBe(false)
    expect(looksLikeHeic({ type: 'image/png', name: 'heic.png' })).toBe(false)
  })
})

describe('checkImageFile', () => {
  const file = (type: string, name: string, size = 1000) => ({ type, name, size })

  it('accepts ordinary photos', () => {
    expect(checkImageFile(file('image/jpeg', 'a.jpg'))).toBeUndefined()
    expect(checkImageFile(file('image/png', 'a.png'))).toBeUndefined()
    expect(checkImageFile(file('image/webp', 'a.webp'))).toBeUndefined()
  })

  it('lets HEIC through, because Safari can open it (the decoder says when a browser cannot)', () => {
    expect(checkImageFile(file('image/heic', 'a.heic'))).toBeUndefined()
  })

  it('tries a file whose type is unknown when its name says picture', () => {
    expect(checkImageFile(file('', 'IMG_20261017.jpg'))).toBeUndefined()
    expect(checkImageFile(file('', 'notes.txt'))).toBe('notImage')
    expect(checkImageFile(file('', 'noextension'))).toBe('notImage')
  })

  it('refuses a document, a video and an empty file', () => {
    expect(checkImageFile(file('application/pdf', 'a.pdf'))).toBe('notImage')
    expect(checkImageFile(file('video/mp4', 'a.mp4'))).toBe('notImage')
    expect(checkImageFile(file('image/jpeg', 'a.jpg', 0))).toBe('empty')
  })

  it('refuses a file that is too big to open safely', () => {
    expect(checkImageFile(file('image/jpeg', 'a.jpg', MAX_FILE_BYTES))).toBeUndefined()
    expect(checkImageFile(file('image/jpeg', 'a.jpg', MAX_FILE_BYTES + 1))).toBe('tooBig')
  })
})
