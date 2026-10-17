import { describe, expect, it } from 'vitest'
import { formatZoom } from '../../src/features/scan/format'
import { clamp, clampPan, cssTransform, dragPan, maxPan, MAX_DIGITAL_ZOOM, NO_PAN, pinchZoom, viewOfFrame, zoomSteps } from '../../src/features/scan/zoomMath'

const PHONE = { width: 390, height: 844 }

describe('maxPan and clampPan', () => {
  it('allows no movement without zoom, and half of what is hidden with zoom', () => {
    expect(maxPan(1)).toBe(0)
    expect(maxPan(0.5)).toBe(0)
    expect(maxPan(2)).toBeCloseTo(0.25, 10)
    expect(maxPan(4)).toBeCloseTo(0.375, 10)
  })

  it('keeps the view on the picture', () => {
    expect(clampPan(2, { x: 0.9, y: -0.9 })).toEqual({ x: 0.25, y: -0.25 })
    expect(clampPan(2, { x: 0.1, y: -0.2 })).toEqual({ x: 0.1, y: -0.2 })
    expect(clampPan(1, { x: 0.3, y: 0.3 })).toEqual({ x: 0, y: 0 })
  })
})

describe('cssTransform', () => {
  it('is nothing without zoom', () => {
    expect(cssTransform(1, NO_PAN)).toBe('none')
    expect(cssTransform(0.8, NO_PAN)).toBe('none')
  })

  it('scales about the middle and moves the picture the other way from the view', () => {
    expect(cssTransform(2, NO_PAN)).toBe('translate(0%, 0%) scale(2)')
    // The view sits a quarter of the box to the right and 10 percent down: the picture moves left and up, twice as far (zoom 2).
    expect(cssTransform(2, { x: 0.25, y: 0.1 })).toBe('translate(-50%, -20%) scale(2)')
  })

  it('puts the middle of the view in the middle of the box (the transform maps it there)', () => {
    // A point at the centre of the view is at box middle + pan (in box fractions); scale about the middle, then translate.
    const zoom = 3
    const pan = { x: 0.2, y: -0.15 }
    const mapped = (point: number, translatePercent: number) => 0.5 + zoom * (point - 0.5) + translatePercent / 100
    const text = cssTransform(zoom, pan)
    const [tx, ty] = [...text.matchAll(/(-?\d+(?:\.\d+)?)%/g)].map((match) => Number(match[1]))
    expect(mapped(0.5 + pan.x, tx)).toBeCloseTo(0.5, 6)
    expect(mapped(0.5 + pan.y, ty)).toBeCloseTo(0.5, 6)
  })
})

describe('pinchZoom', () => {
  it('follows the distance between the fingers', () => {
    expect(pinchZoom(1, 100, 200, 1, 6)).toBe(2)
    expect(pinchZoom(2, 100, 150, 1, 6)).toBe(3)
    expect(pinchZoom(3, 200, 100, 1, 6)).toBe(1.5)
  })

  it('stays between the smallest and the largest zoom', () => {
    expect(pinchZoom(1, 100, 10, 1, 6)).toBe(1)
    expect(pinchZoom(4, 100, 1000, 1, 6)).toBe(6)
    expect(pinchZoom(2, 100, 400, 0.5, 10)).toBe(8)
  })

  it('ignores broken distances', () => {
    expect(pinchZoom(3, 0, 100, 1, 6)).toBe(3)
    expect(pinchZoom(3, 100, 0, 1, 6)).toBe(3)
    expect(pinchZoom(9, Number.NaN, 100, 1, 6)).toBe(6)
  })
})

describe('dragPan', () => {
  it('moves the view the other way from the finger, slower when zoomed in more', () => {
    // Zoom 2 on a 390 x 844 box: 39 px to the right is 39 / (2 * 390) = 5 percent of the box to the left.
    const pan = dragPan(NO_PAN, 39, 0, 2, PHONE)
    expect(pan.x).toBeCloseTo(-0.05, 10)
    expect(pan.y).toBeCloseTo(0, 10)
    const down = dragPan(NO_PAN, 0, 84.4, 4, PHONE)
    expect(down.y).toBeCloseTo(-0.025, 10)
  })

  it('never leaves the picture, and does nothing without zoom or a box', () => {
    expect(dragPan(NO_PAN, -5000, 5000, 2, PHONE)).toEqual({ x: 0.25, y: -0.25 })
    expect(dragPan(NO_PAN, 100, 100, 1, PHONE)).toEqual({ x: 0, y: 0 })
    expect(dragPan({ x: 0.1, y: 0.1 }, 100, 100, 2, { width: 0, height: 0 })).toEqual({ x: 0.1, y: 0.1 })
  })
})

describe('viewOfFrame', () => {
  it('is nothing without zoom or without sizes', () => {
    expect(viewOfFrame(1, NO_PAN, { width: 1080, height: 1920 }, PHONE)).toBeUndefined()
    expect(viewOfFrame(2, NO_PAN, { width: 0, height: 1920 }, PHONE)).toBeUndefined()
    expect(viewOfFrame(2, NO_PAN, { width: 1080, height: 1920 }, { width: 0, height: 0 })).toBeUndefined()
  })

  it('cuts the middle of the picture, as large as the zoom says', () => {
    // A portrait frame in a portrait box with nearly the same shape: x2 shows about half the width and half the height.
    const view = viewOfFrame(2, NO_PAN, { width: 1080, height: 1920 }, { width: 540, height: 960 })!
    expect(view.width).toBeCloseTo(0.5, 10)
    expect(view.height).toBeCloseTo(0.5, 10)
    expect(view.x).toBeCloseTo(0.25, 10)
    expect(view.y).toBeCloseTo(0.25, 10)
  })

  it('accounts for the sides that "cover" cuts off', () => {
    // A landscape frame (1920 x 1080) shown in a portrait box (390 x 844): cover keeps only the middle 1080 x 2336/... of it.
    const frame = { width: 1920, height: 1080 }
    const scale = Math.max(PHONE.width / frame.width, PHONE.height / frame.height)
    const visibleWidth = PHONE.width / scale / frame.width
    const unzoomed = viewOfFrame(1.0001, NO_PAN, frame, PHONE)!
    expect(unzoomed.height).toBeCloseTo(1, 3)
    expect(unzoomed.width).toBeCloseTo(visibleWidth, 3)
    const zoomed = viewOfFrame(3, NO_PAN, frame, PHONE)!
    expect(zoomed.width).toBeCloseTo(visibleWidth / 3, 6)
    expect(zoomed.height).toBeCloseTo(1 / 3, 6)
    // Still centred.
    expect(zoomed.x + zoomed.width / 2).toBeCloseTo(0.5, 6)
    expect(zoomed.y + zoomed.height / 2).toBeCloseTo(0.5, 6)
  })

  it('moves with the pan, and never leaves the frame', () => {
    const frame = { width: 1080, height: 1920 }
    const box = { width: 540, height: 960 }
    const right = viewOfFrame(2, { x: 0.25, y: 0 }, frame, box)!
    expect(right.x).toBeCloseTo(0.5, 10)
    const far = viewOfFrame(2, { x: 5, y: -5 }, frame, box)!
    expect(far.x).toBeCloseTo(0.5, 10)
    expect(far.y).toBeCloseTo(0, 10)
    expect(far.x + far.width).toBeLessThanOrEqual(1 + 1e-9)
  })
})

describe('zoomSteps', () => {
  it('offers the usual steps the camera can reach', () => {
    expect(zoomSteps(1, MAX_DIGITAL_ZOOM)).toEqual([1, 2, 3, 5])
    expect(zoomSteps(1, 10)).toEqual([1, 2, 3, 5, 8])
    expect(zoomSteps(1, 3)).toEqual([1, 2, 3])
  })

  it('offers none when there is nothing to choose from', () => {
    expect(zoomSteps(1, 1.5)).toEqual([])
    expect(zoomSteps(1, 1)).toEqual([])
  })

  it('leaves out steps below a camera minimum (an ultra-wide lens at 0.6 still has 1 and up)', () => {
    expect(zoomSteps(0.6, 5)).toEqual([1, 2, 3, 5])
    expect(zoomSteps(2, 8)).toEqual([2, 3, 5, 8])
  })
})

describe('clamp and formatZoom', () => {
  it('clamps', () => {
    expect(clamp(5, 1, 3)).toBe(3)
    expect(clamp(-1, 1, 3)).toBe(1)
    expect(clamp(2, 1, 3)).toBe(2)
  })

  it('writes the zoom the Czech way', () => {
    expect(formatZoom(1)).toBe('1×')
    expect(formatZoom(2)).toBe('2×')
    expect(formatZoom(2.45)).toBe('2,5×')
    expect(formatZoom(3.04)).toBe('3×')
    expect(formatZoom(Number.NaN)).toBe('1×')
  })
})

describe('what the screen shows and what the scanner is told are the same part of the picture', () => {
  // Where a point of the camera picture ends up on the screen: first "cover" scales and centres the picture in the box, then
  // the CSS transform scales about the middle of the box and moves it (cssTransform). The corners of the part that viewOfFrame
  // reports must land exactly on the corners of the box, for every zoom and every position.
  function onScreen(point: { x: number; y: number }, zoom: number, pan: { x: number; y: number }, frame: { width: number; height: number }, box: { width: number; height: number }) {
    const scale = Math.max(box.width / frame.width, box.height / frame.height)
    const covered = {
      x: (point.x - frame.width / 2) * scale + box.width / 2,
      y: (point.y - frame.height / 2) * scale + box.height / 2,
    }
    const [tx, ty] = [...cssTransform(zoom, pan).matchAll(/(-?\d+(?:\.\d+)?)%/g)].map((match) => Number(match[1]) / 100)
    return {
      x: box.width / 2 + zoom * (covered.x - box.width / 2) + tx * box.width,
      y: box.height / 2 + zoom * (covered.y - box.height / 2) + ty * box.height,
    }
  }

  const frames = [
    { width: 1080, height: 1920 },
    { width: 1920, height: 1080 },
    { width: 720, height: 1280 },
  ]
  const boxes = [PHONE, { width: 844, height: 390 }, { width: 360, height: 800 }]

  it('maps the corners of the reported part to the corners of the screen', () => {
    for (const frame of frames) {
      for (const box of boxes) {
        for (const zoom of [1.5, 2, 3.7, 6]) {
          for (const pan of [NO_PAN, { x: 0.1, y: -0.05 }, { x: -1, y: 1 }, { x: 0.3, y: 0.3 }]) {
            const limited = clampPan(zoom, pan)
            const view = viewOfFrame(zoom, limited, frame, box)!
            const topLeft = onScreen({ x: view.x * frame.width, y: view.y * frame.height }, zoom, limited, frame, box)
            const bottomRight = onScreen({ x: (view.x + view.width) * frame.width, y: (view.y + view.height) * frame.height }, zoom, limited, frame, box)
            // A frame that is wider than the screen shows only its middle: the part reported is the part on the screen, so the
            // corners land on the corners unless the clamp inside the frame had to move the part (not with a valid pan).
            expect(topLeft.x).toBeCloseTo(0, 4)
            expect(topLeft.y).toBeCloseTo(0, 4)
            expect(bottomRight.x).toBeCloseTo(box.width, 4)
            expect(bottomRight.y).toBeCloseTo(box.height, 4)
          }
        }
      }
    }
  })
})
