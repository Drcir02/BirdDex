import { describe, expect, it } from 'vitest'
import { cropRect } from '../../src/ml/vision/frame'

const FRAME = { width: 1080, height: 1920 }

describe('cropRect', () => {
  it('is the whole picture without a view', () => {
    expect(cropRect(FRAME)).toEqual({ x: 0, y: 0, width: 1080, height: 1920 })
    expect(cropRect(FRAME, undefined)).toEqual({ x: 0, y: 0, width: 1080, height: 1920 })
  })

  it('turns fractions into whole pixels', () => {
    expect(cropRect(FRAME, { x: 0.25, y: 0.25, width: 0.5, height: 0.5 })).toEqual({ x: 270, y: 480, width: 540, height: 960 })
    expect(cropRect({ width: 1000, height: 500 }, { x: 0.1, y: 0.2, width: 0.25, height: 0.5 })).toEqual({ x: 100, y: 100, width: 250, height: 250 })
  })

  it('keeps a view that sticks out inside the picture', () => {
    const rect = cropRect(FRAME, { x: 0.9, y: 0.95, width: 0.5, height: 0.5 })
    expect(rect.x + rect.width).toBeLessThanOrEqual(FRAME.width)
    expect(rect.y + rect.height).toBeLessThanOrEqual(FRAME.height)
    expect(rect.width).toBe(540)
    expect(rect.x).toBe(540)
    const negative = cropRect(FRAME, { x: -0.3, y: -0.3, width: 0.5, height: 0.5 })
    expect(negative.x).toBe(0)
    expect(negative.y).toBe(0)
  })

  it('never gives less than 32 pixels, and never more than the picture', () => {
    expect(cropRect(FRAME, { x: 0.5, y: 0.5, width: 0.0001, height: 0.0001 })).toMatchObject({ width: 32, height: 32 })
    expect(cropRect(FRAME, { x: 0, y: 0, width: 4, height: 4 })).toEqual({ x: 0, y: 0, width: 1080, height: 1920 })
    expect(cropRect({ width: 20, height: 20 }, { x: 0, y: 0, width: 0.1, height: 0.1 })).toMatchObject({ width: 20, height: 20 })
  })

  it('gives the whole picture for a view with broken numbers or a picture with no size', () => {
    expect(cropRect(FRAME, { x: Number.NaN, y: 0, width: 0.5, height: 0.5 })).toEqual({ x: 0, y: 0, width: 1080, height: 1920 })
    expect(cropRect({ width: 0, height: 0 }, { x: 0, y: 0, width: 0.5, height: 0.5 })).toEqual({ x: 0, y: 0, width: 0, height: 0 })
  })
})
