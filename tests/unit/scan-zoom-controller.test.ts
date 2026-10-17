import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ZoomController, type ZoomEnvironment } from '../../src/features/scan/zoomController'
import { createZoomGestures } from '../../src/features/scan/zoomGestures'
import { NO_PAN } from '../../src/features/scan/zoomMath'

const BOX = { width: 540, height: 960 }
const FRAME = { width: 1080, height: 1920 }

interface Fake {
  env: ZoomEnvironment
  transforms: string[]
  changes: { count: number }
}

function fake(): Fake {
  const transforms: string[] = []
  const changes = { count: 0 }
  const env: ZoomEnvironment = {
    applyTransform: (transform) => transforms.push(transform),
    boxSize: () => BOX,
    frameSize: () => FRAME,
    onViewChange: () => {
      changes.count += 1
    },
  }
  return { env, transforms, changes }
}

/** A camera track with its own zoom, as an Android phone has. */
function trackWithZoom(range: { min: number; max: number }, options: { failing?: boolean; current?: number } = {}) {
  const applied: number[] = []
  const track = {
    getCapabilities: () => ({ zoom: range }),
    getSettings: () => (options.current === undefined ? {} : { zoom: options.current }),
    applyConstraints: vi.fn(async (constraints: { advanced?: Array<{ zoom?: number }> }) => {
      if (options.failing) throw new Error('OverconstrainedError')
      applied.push(constraints.advanced![0].zoom!)
    }),
  }
  return { track: track as unknown as MediaStreamTrack, applied, applyConstraints: track.applyConstraints }
}

/** The screen is told once per frame; tests let that frame pass. */
const frame = () => new Promise((resolve) => setTimeout(resolve, 30))

describe('digital zoom (an iPhone: the camera has no zoom of its own)', () => {
  let f: Fake
  let controller: ZoomController
  beforeEach(() => {
    f = fake()
    controller = new ZoomController(f.env)
    controller.attach({ getCapabilities: () => ({}) } as unknown as MediaStreamTrack)
  })

  it('starts at 1x with the digital range 1 to 6 and the picture unmoved', () => {
    expect(controller.getState()).toMatchObject({ ready: true, zoom: 1, min: 1, max: 6, mode: 'digital', pan: NO_PAN })
    expect(f.transforms.at(-1)).toBe('none')
    expect(controller.getView()).toBeUndefined()
    expect(controller.canPan).toBe(false)
  })

  it('also works with a track that knows nothing about zoom, or with no track at all', () => {
    controller.attach(undefined)
    expect(controller.getState().mode).toBe('digital')
    controller.attach({} as MediaStreamTrack)
    expect(controller.getState().mode).toBe('digital')
  })

  it('zooms the picture, never beyond the range, and shows exactly the part it reports', () => {
    controller.setZoom(2)
    expect(controller.getState().zoom).toBe(2)
    expect(f.transforms.at(-1)).toBe('translate(0%, 0%) scale(2)')
    expect(controller.getView()).toEqual({ x: 0.25, y: 0.25, width: 0.5, height: 0.5 })
    controller.setZoom(50)
    expect(controller.getState().zoom).toBe(6)
    controller.setZoom(0.2)
    expect(controller.getState().zoom).toBe(1)
    expect(f.transforms.at(-1)).toBe('none')
    expect(controller.getView()).toBeUndefined()
  })

  it('says the view changed whenever the zoom or the position moves, and only then', () => {
    controller.setZoom(2)
    expect(f.changes.count).toBe(1)
    controller.setZoom(2)
    expect(f.changes.count).toBe(1)
    controller.dragFrom(NO_PAN, 50, 0)
    expect(f.changes.count).toBe(2)
    controller.dragFrom(NO_PAN, 50, 0)
    expect(f.changes.count).toBe(2)
  })

  it('moves the view by dragging, only while zoomed in, and keeps it on the picture', () => {
    controller.dragFrom(NO_PAN, 100, 100)
    expect(controller.getState().pan).toEqual(NO_PAN)
    controller.setZoom(2)
    expect(controller.canPan).toBe(true)
    controller.dragFrom(NO_PAN, -54, 0)
    // 54 px to the left at zoom 2 on a 540 px box is 5 percent of the box to the right.
    expect(controller.getState().pan.x).toBeCloseTo(0.05, 6)
    controller.dragFrom(NO_PAN, -100000, 100000)
    expect(controller.getState().pan).toEqual({ x: 0.25, y: -0.25 })
    expect(controller.getView()).toEqual({ x: 0.5, y: 0, width: 0.5, height: 0.5 })
  })

  it('pulls the position back when the zoom gets smaller', () => {
    controller.setZoom(4)
    controller.dragFrom(NO_PAN, -100000, 0)
    expect(controller.getState().pan.x).toBeCloseTo(0.375, 6)
    controller.setZoom(2)
    expect(controller.getState().pan.x).toBeCloseTo(0.25, 6)
    controller.setZoom(1)
    expect(controller.getState().pan).toEqual(NO_PAN)
  })

  it('zoomBy multiplies, and ignores broken numbers', () => {
    controller.zoomBy(1.5)
    expect(controller.getState().zoom).toBeCloseTo(1.5, 10)
    controller.zoomBy(2)
    expect(controller.getState().zoom).toBeCloseTo(3, 10)
    controller.setZoom(Number.NaN)
    controller.zoomBy(Number.POSITIVE_INFINITY)
    expect(controller.getState().zoom).toBeLessThanOrEqual(6)
    expect(Number.isFinite(controller.getState().zoom)).toBe(true)
  })

  it('goes back to 1x when the camera is switched off', () => {
    controller.setZoom(3)
    controller.dragFrom(NO_PAN, -100, -100)
    controller.detach()
    expect(controller.getState()).toMatchObject({ ready: false, zoom: 1, pan: NO_PAN })
    expect(f.transforms.at(-1)).toBe('none')
    expect(controller.getView()).toBeUndefined()
  })

  it('has no view while the sizes are not known yet', () => {
    const none = new ZoomController({ ...f.env, frameSize: () => undefined })
    none.attach(undefined)
    none.setZoom(2)
    expect(none.getView()).toBeUndefined()
  })

  it('tells listeners, once per frame however fast it moves', async () => {
    const listener = vi.fn()
    const stop = controller.subscribe(listener)
    controller.setZoom(2)
    controller.setZoom(2.5)
    controller.setZoom(3)
    await frame()
    expect(listener).toHaveBeenCalledTimes(1)
    stop()
    controller.setZoom(4)
    await frame()
    expect(listener).toHaveBeenCalledTimes(1)
  })
})

describe('hardware zoom (an Android phone: the camera zooms by itself)', () => {
  let f: Fake
  let controller: ZoomController
  beforeEach(() => {
    f = fake()
    controller = new ZoomController(f.env)
  })
  afterEach(() => vi.restoreAllMocks())

  it('takes the range of the camera, and leaves the picture alone', () => {
    controller.attach(trackWithZoom({ min: 1, max: 8 }).track)
    expect(controller.getState()).toMatchObject({ ready: true, zoom: 1, min: 1, max: 8, mode: 'hardware' })
    controller.setZoom(3)
    expect(f.transforms.every((transform) => transform === 'none')).toBe(true)
    expect(controller.getView()).toBeUndefined()
    expect(controller.canPan).toBe(false)
  })

  it('starts where the camera is, inside its range', () => {
    controller.attach(trackWithZoom({ min: 1, max: 8 }, { current: 2 }).track)
    expect(controller.getState().zoom).toBe(2)
    controller.attach(trackWithZoom({ min: 0.5, max: 8 }).track)
    expect(controller.getState().zoom).toBe(1)
  })

  it('asks the camera for the zoom, one request at a time and always the newest wish', async () => {
    const camera = trackWithZoom({ min: 1, max: 8 })
    controller.attach(camera.track)
    controller.setZoom(2)
    controller.setZoom(3)
    controller.setZoom(4)
    await frame()
    expect(camera.applied[0]).toBe(2)
    expect(camera.applied.at(-1)).toBe(4)
    expect(camera.applied.length).toBeLessThanOrEqual(3)
    expect(controller.getState().zoom).toBe(4)
  })

  it('ignores a camera whose zoom is not worth a slider', () => {
    controller.attach(trackWithZoom({ min: 1, max: 1 }).track)
    expect(controller.getState().mode).toBe('digital')
    controller.attach(trackWithZoom({ min: 1, max: 1.02 }).track)
    expect(controller.getState().mode).toBe('digital')
  })

  it('falls back to zooming the picture when the camera refuses', async () => {
    const camera = trackWithZoom({ min: 1, max: 8 }, { failing: true })
    controller.attach(camera.track)
    controller.setZoom(3)
    await frame()
    expect(controller.getState()).toMatchObject({ ready: true, mode: 'digital', zoom: 1, max: 6 })
    // And now the picture zooms.
    controller.setZoom(2)
    expect(controller.getView()).toBeDefined()
    expect(f.transforms.at(-1)).toBe('translate(0%, 0%) scale(2)')
  })

  it('does not touch a camera that has been switched off', async () => {
    const camera = trackWithZoom({ min: 1, max: 8 })
    controller.attach(camera.track)
    controller.detach()
    controller.setZoom(3)
    await frame()
    expect(camera.applyConstraints).not.toHaveBeenCalled()
  })
})

describe('gestures', () => {
  function setup() {
    const f = fake()
    const controller = new ZoomController(f.env)
    controller.attach(undefined)
    const gestures = createZoomGestures(controller)
    const target = { setPointerCapture: vi.fn(), releasePointerCapture: vi.fn() }
    const event = (pointerId: number, clientX: number, clientY: number) =>
      ({ pointerId, clientX, clientY, currentTarget: target }) as unknown as Parameters<typeof gestures.onPointerDown>[0]
    return { controller, gestures, event, target, f }
  }

  it('two fingers pinch: apart zooms in, together zooms out', () => {
    const { controller, gestures, event } = setup()
    gestures.onPointerDown(event(1, 200, 400))
    gestures.onPointerDown(event(2, 300, 400))
    gestures.onPointerMove(event(2, 500, 400))
    expect(controller.getState().zoom).toBeCloseTo(3, 6)
    gestures.onPointerMove(event(2, 400, 400))
    expect(controller.getState().zoom).toBeCloseTo(2, 6)
    gestures.onPointerUp(event(2, 400, 400))
    gestures.onPointerUp(event(1, 200, 400))
  })

  it('one finger drags the zoomed picture and does nothing without zoom', () => {
    const { controller, gestures, event } = setup()
    gestures.onPointerDown(event(1, 100, 100))
    gestures.onPointerMove(event(1, 200, 100))
    expect(controller.getState().pan).toEqual(NO_PAN)
    gestures.onPointerUp(event(1, 200, 100))

    controller.setZoom(2)
    gestures.onPointerDown(event(1, 100, 100))
    gestures.onPointerMove(event(1, 154, 100))
    expect(controller.getState().pan.x).toBeCloseTo(-0.05, 6)
    gestures.onPointerUp(event(1, 154, 100))
  })

  it('a finger left over after a pinch does not make the picture jump', () => {
    const { controller, gestures, event } = setup()
    controller.setZoom(2)
    gestures.onPointerDown(event(1, 100, 100))
    gestures.onPointerDown(event(2, 200, 100))
    gestures.onPointerUp(event(2, 200, 100))
    gestures.onPointerMove(event(1, 300, 300))
    expect(controller.getState().pan).toEqual(NO_PAN)
  })

  it('moves of fingers that are not down are ignored, and a third finger is too', () => {
    const { controller, gestures, event } = setup()
    gestures.onPointerMove(event(9, 100, 100))
    gestures.onPointerDown(event(1, 100, 100))
    gestures.onPointerDown(event(2, 200, 100))
    gestures.onPointerDown(event(3, 400, 100))
    gestures.onPointerMove(event(2, 400, 100))
    expect(controller.getState().zoom).toBe(1)
  })

  it('cancel works like lifting the finger, and capture is taken and given back', () => {
    const { gestures, event, target } = setup()
    gestures.onPointerDown(event(1, 100, 100))
    expect(target.setPointerCapture).toHaveBeenCalledWith(1)
    gestures.onPointerCancel(event(1, 100, 100))
    expect(target.releasePointerCapture).toHaveBeenCalledWith(1)
  })

  it('the mouse wheel zooms: forward zooms in, back zooms out', () => {
    const { controller, gestures } = setup()
    const wheel = (deltaY: number) => ({ deltaY }) as unknown as Parameters<typeof gestures.onWheel>[0]
    gestures.onWheel(wheel(-300))
    expect(controller.getState().zoom).toBeGreaterThan(1.5)
    const before = controller.getState().zoom
    gestures.onWheel(wheel(300))
    expect(controller.getState().zoom).toBeLessThan(before)
    gestures.onWheel(wheel(0))
    gestures.onWheel(wheel(Number.NaN))
  })
})
