import { describe, expect, it } from 'vitest'
import type { ImageSource } from '../../src/domain/engines'
import { planDownscale, planSteps, sourceSize } from '../../src/ml/vision/frame'

describe('planDownscale', () => {
  it('scales a phone photo down to a shorter side of 512, keeping the shape', () => {
    expect(planDownscale(4032, 3024)).toEqual({ width: 683, height: 512 })
    expect(planDownscale(3024, 4032)).toEqual({ width: 512, height: 683 })
    expect(planDownscale(960, 640)).toEqual({ width: 768, height: 512 })
  })

  it('never makes a picture bigger', () => {
    expect(planDownscale(400, 300)).toEqual({ width: 400, height: 300 })
    expect(planDownscale(512, 512)).toEqual({ width: 512, height: 512 })
    expect(planDownscale(100, 80)).toEqual({ width: 100, height: 80 })
  })

  it('has a smaller target for the live camera frames', () => {
    expect(planDownscale(1280, 720, 320)).toEqual({ width: 569, height: 320 })
    expect(planDownscale(640, 480, 320)).toEqual({ width: 427, height: 320 })
  })

  it('holds very wide pictures to 1536 on the long side, but not below the 248 pixels the model needs', () => {
    expect(planDownscale(6000, 1200)).toEqual({ width: 1536, height: 307 })
    expect(planDownscale(1200, 4800)).toEqual({ width: 384, height: 1536 })
    // an extreme panorama: the short side wins over the long side cap
    const extreme = planDownscale(10000, 500)
    expect(Math.min(extreme.width, extreme.height)).toBeGreaterThanOrEqual(248)
  })

  it('keeps the shape of the picture to within a pixel', () => {
    for (const [w, h] of [
      [4000, 3000],
      [3840, 2160],
      [1920, 1080],
      [2592, 1944],
      [8000, 6000],
    ]) {
      const t = planDownscale(w, h)
      expect(Math.abs(t.width / t.height - w / h)).toBeLessThan(0.01)
    }
  })
})

describe('planSteps', () => {
  it('halves while there is more than double the target left, then draws the target size', () => {
    expect(planSteps({ width: 4032, height: 3024 }, { width: 683, height: 512 })).toEqual([
      { width: 2016, height: 1512 },
      { width: 1008, height: 756 },
      { width: 683, height: 512 },
    ])
  })

  it('is one step when the picture is less than twice the target, or the same size', () => {
    expect(planSteps({ width: 960, height: 640 }, { width: 768, height: 512 })).toEqual([{ width: 768, height: 512 }])
    expect(planSteps({ width: 640, height: 480 }, { width: 640, height: 480 })).toEqual([{ width: 640, height: 480 }])
  })

  it('ends exactly on the target when the halving lands on it', () => {
    expect(planSteps({ width: 2048, height: 1024 }, { width: 512, height: 256 })).toEqual([
      { width: 1024, height: 512 },
      { width: 512, height: 256 },
    ])
  })

  it('never goes below the target in either direction', () => {
    const target = { width: 1536, height: 307 }
    for (const step of planSteps({ width: 6000, height: 1200 }, target)) {
      expect(step.width).toBeGreaterThanOrEqual(target.width)
      expect(step.height).toBeGreaterThanOrEqual(target.height)
    }
  })
})

describe('sourceSize', () => {
  it('reads the size of a video, an image, a canvas or a bitmap', () => {
    expect(sourceSize({ videoWidth: 1280, videoHeight: 720, width: 300, height: 150 } as unknown as ImageSource)).toEqual({ width: 1280, height: 720 })
    expect(sourceSize({ naturalWidth: 4000, naturalHeight: 3000, width: 200, height: 150 } as unknown as ImageSource)).toEqual({ width: 4000, height: 3000 })
    expect(sourceSize({ width: 640, height: 480 } as unknown as ImageSource)).toEqual({ width: 640, height: 480 })
  })

  it('falls back to width and height for an image that has not loaded', () => {
    expect(sourceSize({ naturalWidth: 0, naturalHeight: 0, width: 30, height: 20 } as unknown as ImageSource)).toEqual({ width: 30, height: 20 })
  })

  it('gives a video that has no picture yet a size of zero', () => {
    expect(sourceSize({ videoWidth: 0, videoHeight: 0, width: 300, height: 150 } as unknown as ImageSource)).toEqual({ width: 0, height: 0 })
  })
})
