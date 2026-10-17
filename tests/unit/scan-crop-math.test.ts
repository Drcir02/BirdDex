import { describe, expect, it } from 'vitest'
import {
  clampCrop,
  cropToPixels,
  dragCrop,
  FULL_CROP,
  isFullCrop,
  isNudgeKey,
  minimumCropSize,
  nudgeCrop,
  pointToFraction,
  type CropRect,
} from '../../src/features/scan/cropMath'

const LIMITS = { minW: 0.1, minH: 0.1 }
const BOX: CropRect = { x: 0.2, y: 0.3, w: 0.4, h: 0.4 }

describe('minimumCropSize', () => {
  it('turns a minimum in pixels into a fraction of the preview, per direction', () => {
    expect(minimumCropSize(360, 240, 72)).toEqual({ minW: 0.2, minH: 0.3 })
  })

  it('never asks for more than half of the picture, so a tiny preview can still be grabbed', () => {
    expect(minimumCropSize(100, 100, 72)).toEqual({ minW: 0.5, minH: 0.5 })
  })

  it('never asks for less than 5 percent, however big the preview is', () => {
    expect(minimumCropSize(5000, 5000, 72).minW).toBe(0.05)
  })

  it('copes with a preview that has no size yet', () => {
    expect(minimumCropSize(0, 0)).toEqual({ minW: 0.5, minH: 0.5 })
  })
})

describe('clampCrop', () => {
  it('leaves a box that is fine alone', () => {
    expect(clampCrop(BOX, LIMITS)).toEqual(BOX)
  })

  it('pushes a box that sticks out back inside, keeping its size', () => {
    const out = clampCrop({ x: 0.8, y: -0.2, w: 0.4, h: 0.4 }, LIMITS)
    expect(out.x).toBeCloseTo(0.6)
    expect(out.y).toBe(0)
    expect(out.w).toBe(0.4)
  })

  it('makes a box that is too small as big as the limits', () => {
    expect(clampCrop({ x: 0.5, y: 0.5, w: 0.01, h: 0.01 }, LIMITS)).toEqual({ x: 0.5, y: 0.5, w: 0.1, h: 0.1 })
  })

  it('shrinks a box that is bigger than the picture', () => {
    expect(clampCrop({ x: 0.3, y: 0.3, w: 3, h: 2 }, LIMITS)).toEqual({ x: 0, y: 0, w: 1, h: 1 })
  })

  it('replaces numbers that are not numbers with the whole picture', () => {
    expect(clampCrop({ x: Number.NaN, y: Number.NaN, w: Number.NaN, h: Number.NaN }, LIMITS)).toEqual(FULL_CROP)
  })
})

describe('dragCrop: moving the whole box', () => {
  it('slides the box by the drag', () => {
    const out = dragCrop(BOX, 'move', 0.1, -0.1, LIMITS)
    expect(out.x).toBeCloseTo(0.3)
    expect(out.y).toBeCloseTo(0.2)
    expect(out.w).toBe(0.4)
    expect(out.h).toBe(0.4)
  })

  it('stops at every border without changing the size', () => {
    expect(dragCrop(BOX, 'move', 5, 5, LIMITS)).toEqual({ x: 0.6, y: 0.6, w: 0.4, h: 0.4 })
    expect(dragCrop(BOX, 'move', -5, -5, LIMITS)).toEqual({ x: 0, y: 0, w: 0.4, h: 0.4 })
  })

  it('does not change the box it was given (the drag always starts from where it began)', () => {
    const start = { ...BOX }
    dragCrop(start, 'move', 0.2, 0.2, LIMITS)
    expect(start).toEqual(BOX)
  })
})

describe('dragCrop: resizing by a corner', () => {
  it('moves only the two edges of the corner and keeps the opposite corner where it is', () => {
    const out = dragCrop(BOX, 'se', 0.1, 0.2, LIMITS)
    expect(out.x).toBeCloseTo(0.2)
    expect(out.y).toBeCloseTo(0.3)
    expect(out.w).toBeCloseTo(0.5)
    expect(out.h).toBeCloseTo(0.6)

    const nw = dragCrop(BOX, 'nw', 0.05, 0.1, LIMITS)
    expect(nw.x + nw.w).toBeCloseTo(0.6)
    expect(nw.y + nw.h).toBeCloseTo(0.7)
    expect(nw.x).toBeCloseTo(0.25)
    expect(nw.y).toBeCloseTo(0.4)

    const ne = dragCrop(BOX, 'ne', 0.1, -0.1, LIMITS)
    expect(ne.x).toBeCloseTo(0.2)
    expect(ne.y + ne.h).toBeCloseTo(0.7)
    expect(ne.x + ne.w).toBeCloseTo(0.7)
    expect(ne.y).toBeCloseTo(0.2)

    const sw = dragCrop(BOX, 'sw', -0.1, 0.1, LIMITS)
    expect(sw.x + sw.w).toBeCloseTo(0.6)
    expect(sw.y).toBeCloseTo(0.3)
    expect(sw.x).toBeCloseTo(0.1)
    expect(sw.y + sw.h).toBeCloseTo(0.8)
  })

  it('cannot be dragged past the border of the picture', () => {
    const out = dragCrop(BOX, 'se', 5, 5, LIMITS)
    expect(out.x + out.w).toBe(1)
    expect(out.y + out.h).toBe(1)
    const back = dragCrop(BOX, 'nw', -5, -5, LIMITS)
    expect(back.x).toBe(0)
    expect(back.y).toBe(0)
  })

  it('stops at the smallest size instead of turning inside out', () => {
    const out = dragCrop(BOX, 'se', -5, -5, LIMITS)
    expect(out.x).toBe(0.2)
    expect(out.y).toBe(0.3)
    expect(out.w).toBeCloseTo(0.1)
    expect(out.h).toBeCloseTo(0.1)
    const nw = dragCrop(BOX, 'nw', 5, 5, LIMITS)
    expect(nw.w).toBeCloseTo(0.1)
    expect(nw.h).toBeCloseTo(0.1)
    expect(nw.x + nw.w).toBeCloseTo(0.6)
    expect(nw.y + nw.h).toBeCloseTo(0.7)
  })

  it('resizes by one edge only when an edge is dragged', () => {
    const out = dragCrop(BOX, 'e', 0.1, 0.5, LIMITS)
    expect(out.w).toBeCloseTo(0.5)
    expect(out.h).toBeCloseTo(0.4)
    expect(out.y).toBe(0.3)
    const north = dragCrop(BOX, 'n', 0.5, -0.1, LIMITS)
    expect(north.x).toBe(0.2)
    expect(north.w).toBeCloseTo(0.4)
    expect(north.y).toBeCloseTo(0.2)
    expect(north.h).toBeCloseTo(0.5)
  })
})

describe('isFullCrop', () => {
  it('is true for the whole picture and for a box that misses it by a hair', () => {
    expect(isFullCrop(FULL_CROP)).toBe(true)
    expect(isFullCrop({ x: 0.004, y: 0.003, w: 0.99, h: 0.995 })).toBe(true)
  })

  it('is false once any edge moved noticeably', () => {
    expect(isFullCrop({ x: 0.05, y: 0, w: 0.95, h: 1 })).toBe(false)
    expect(isFullCrop({ x: 0, y: 0, w: 0.9, h: 1 })).toBe(false)
    expect(isFullCrop(BOX)).toBe(false)
  })
})

describe('cropToPixels', () => {
  it('gives the whole picture for the whole box', () => {
    expect(cropToPixels(FULL_CROP, 2048, 1536)).toEqual({ sx: 0, sy: 0, sw: 2048, sh: 1536 })
  })

  it('gives whole pixels of the box', () => {
    expect(cropToPixels({ x: 0.25, y: 0.5, w: 0.5, h: 0.25 }, 2000, 1000)).toEqual({ sx: 500, sy: 500, sw: 1000, sh: 250 })
  })

  it('never leaves the picture, whatever rounding does', () => {
    const out = cropToPixels({ x: 0.9999, y: 0.9999, w: 0.5, h: 0.5 }, 101, 77)
    expect(out.sx + out.sw).toBeLessThanOrEqual(101)
    expect(out.sy + out.sh).toBeLessThanOrEqual(77)
    expect(out.sw).toBeGreaterThanOrEqual(1)
    expect(out.sh).toBeGreaterThanOrEqual(1)
  })

  it('keeps at least one pixel for a very thin box', () => {
    const out = cropToPixels({ x: 0.5, y: 0.5, w: 0.0001, h: 0.0001 }, 800, 600)
    expect(out.sw).toBe(1)
    expect(out.sh).toBe(1)
  })
})

describe('pointToFraction', () => {
  const box = { left: 100, top: 50, width: 200, height: 100 }

  it('maps a point on the picture to fractions', () => {
    expect(pointToFraction(200, 100, box)).toEqual({ x: 0.5, y: 0.5 })
  })

  it('holds points outside the picture at its border', () => {
    expect(pointToFraction(0, 0, box)).toEqual({ x: 0, y: 0 })
    expect(pointToFraction(999, 999, box)).toEqual({ x: 1, y: 1 })
  })

  it('does not divide by zero for a picture with no size', () => {
    expect(pointToFraction(10, 10, { left: 0, top: 0, width: 0, height: 0 })).toEqual({ x: 0, y: 0 })
  })
})

describe('keyboard nudging', () => {
  it('recognises the arrow keys and nothing else', () => {
    expect(isNudgeKey('ArrowLeft')).toBe(true)
    expect(isNudgeKey('ArrowDown')).toBe(true)
    expect(isNudgeKey('Enter')).toBe(false)
    expect(isNudgeKey('a')).toBe(false)
  })

  it('moves the box with an arrow key on the box and resizes it on a corner', () => {
    const moved = nudgeCrop(BOX, 'move', 'ArrowRight', 0.05, LIMITS)
    expect(moved.x).toBeCloseTo(0.25)
    expect(moved.w).toBe(0.4)
    const grown = nudgeCrop(BOX, 'se', 'ArrowDown', 0.05, LIMITS)
    expect(grown.h).toBeCloseTo(0.45)
    expect(grown.y).toBe(0.3)
  })
})
