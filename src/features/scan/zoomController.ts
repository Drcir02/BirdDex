// The zoom of the live camera. Holds the zoom factor and where the view sits, and makes it happen in one of two ways:
//   hardware: the camera has its own zoom (most Android phones, through MediaStreamTrack.applyConstraints), so the pictures
//             that arrive are already zoomed and nothing has to be cut out;
//   digital:  everything else (iPhones have no zoom for web pages): the picture is scaled and moved on the screen, and the
//             scanner is told which part of the camera picture that is (getView), so it analyses and saves what is seen.
// Plain TypeScript with no React, so it is unit-tested with a fake camera track. useLiveScan wires it to the camera and the
// screen, and zoomGestures.ts turns fingers into calls to it.

import type { FrameView } from '../../domain/engines'
import { clamp, clampPan, cssTransform, dragPan, MAX_DIGITAL_ZOOM, MIN_ZOOM, NO_PAN, viewOfFrame, type Pan, type Size } from './zoomMath'

export type ZoomMode = 'digital' | 'hardware'

export interface ZoomState {
  /** True once a camera is attached: before that the range is not known yet, so the screen shows no zoom buttons. */
  ready: boolean
  zoom: number
  /** The smallest and largest zoom this camera (or the picture) can do. */
  min: number
  max: number
  mode: ZoomMode
  pan: Pan
}

export interface ZoomEnvironment {
  /** Shows the view on the screen: the CSS transform of the video ('none' for no zoom). */
  applyTransform: (transform: string) => void
  /** The size of the box the picture is shown in. */
  boxSize: () => Size | undefined
  /** The size of the camera picture. */
  frameSize: () => Size | undefined
  /** The view changed (zoom or position), so what the scanner saw so far, and a lock on a bird, belong to something else. */
  onViewChange?: () => void
}

interface ZoomRange {
  min?: number
  max?: number
}

/** The parts of a camera track the zoom needs. Not every browser has them, and TypeScript's own types do not know zoom yet. */
interface ZoomTrack {
  getCapabilities?: () => { zoom?: ZoomRange }
  getSettings?: () => { zoom?: number }
  applyConstraints: (constraints: MediaTrackConstraints) => Promise<void>
}

const INITIAL: ZoomState = { ready: false, zoom: MIN_ZOOM, min: MIN_ZOOM, max: MAX_DIGITAL_ZOOM, mode: 'digital', pan: NO_PAN }

/** A camera whose zoom reaches only this much further than its minimum has nothing worth a slider. */
const MIN_HARDWARE_SPAN = 0.05

export class ZoomController {
  private state: ZoomState = INITIAL
  private readonly listeners = new Set<() => void>()
  private track: ZoomTrack | undefined
  private wanted: number | undefined
  private applying = false
  private notifyScheduled = false

  constructor(private readonly env: ZoomEnvironment) {}

  /** For useSyncExternalStore: the same object until something changes. */
  getState = (): ZoomState => this.state

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** A new camera is on: start at no zoom, and use the camera's own zoom when it has one. */
  attach(track?: MediaStreamTrack): void {
    this.track = track as unknown as ZoomTrack | undefined
    this.wanted = undefined
    let next: ZoomState = { ...INITIAL, ready: true }
    const range = this.hardwareRange()
    if (range) {
      const current = this.track?.getSettings?.().zoom
      next = { ready: true, zoom: clamp(Number.isFinite(current) ? (current as number) : Math.max(MIN_ZOOM, range.min), range.min, range.max), min: range.min, max: range.max, mode: 'hardware', pan: NO_PAN }
    }
    this.state = next
    this.env.applyTransform('none')
    this.notify()
  }

  /** The camera is off: back to no zoom. */
  detach(): void {
    this.track = undefined
    this.wanted = undefined
    this.state = INITIAL
    this.env.applyTransform('none')
    this.notify()
  }

  get canPan(): boolean {
    return this.state.mode === 'digital' && this.state.zoom > 1
  }

  setZoom(value: number): void {
    if (!Number.isFinite(value)) return
    const { min, max, mode, pan } = this.state
    const zoom = clamp(value, min, max)
    if (Math.abs(zoom - this.state.zoom) < 1e-4) return
    if (mode === 'hardware') {
      this.state = { ...this.state, zoom }
      this.wanted = zoom
      this.applyHardware()
    } else {
      const nextPan = clampPan(zoom, pan)
      this.state = { ...this.state, zoom, pan: nextPan }
      this.env.applyTransform(cssTransform(zoom, nextPan))
    }
    this.notify()
    this.env.onViewChange?.()
  }

  zoomBy(factor: number): void {
    this.setZoom(this.state.zoom * factor)
  }

  /** Moves the view by dragging the picture: `start` is where the view was when the finger went down. */
  dragFrom(start: Pan, dx: number, dy: number): void {
    if (!this.canPan) return
    const box = this.env.boxSize()
    if (!box) return
    const pan = dragPan(start, dx, dy, this.state.zoom, box)
    if (Math.abs(pan.x - this.state.pan.x) < 1e-5 && Math.abs(pan.y - this.state.pan.y) < 1e-5) return
    this.state = { ...this.state, pan }
    this.env.applyTransform(cssTransform(this.state.zoom, pan))
    this.notify()
    this.env.onViewChange?.()
  }

  /** The part of the camera picture on the screen, for the scanner. Undefined when the whole picture is shown. */
  getView = (): FrameView | undefined => {
    if (this.state.mode !== 'digital' || !(this.state.zoom > 1)) return undefined
    const frame = this.env.frameSize()
    const box = this.env.boxSize()
    if (!frame || !box) return undefined
    return viewOfFrame(this.state.zoom, this.state.pan, frame, box)
  }

  private hardwareRange(): { min: number; max: number } | undefined {
    try {
      const zoom = this.track?.getCapabilities?.().zoom
      if (!zoom || !Number.isFinite(zoom.min) || !Number.isFinite(zoom.max)) return undefined
      const min = zoom.min as number
      const max = zoom.max as number
      return max - Math.max(min, MIN_ZOOM) > MIN_HARDWARE_SPAN ? { min, max } : undefined
    } catch {
      return undefined
    }
  }

  /** Asks the camera for the wanted zoom, one request at a time, always the newest wish. */
  private applyHardware(): void {
    const track = this.track
    if (this.applying || !track || this.wanted === undefined) return
    const zoom = this.wanted
    this.wanted = undefined
    this.applying = true
    let request: Promise<void>
    try {
      // `zoom` is a standard camera setting that TypeScript's own types do not list yet.
      request = track.applyConstraints({ advanced: [{ zoom } as MediaTrackConstraintSet] })
    } catch (error) {
      request = Promise.reject(error)
    }
    void request
      .catch(() => {
        // The camera does not do it after all: zoom the picture instead.
        if (this.track === track) this.fallBackToDigital()
      })
      .finally(() => {
        this.applying = false
        if (this.track === track) this.applyHardware()
      })
  }

  private fallBackToDigital(): void {
    this.wanted = undefined
    this.state = { ...INITIAL, ready: true }
    this.env.applyTransform('none')
    this.notify()
    this.env.onViewChange?.()
  }

  /** Tells the screen at most once per frame, however fast the fingers move. */
  private notify(): void {
    if (this.notifyScheduled) return
    const schedule = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (callback: () => void) => queueMicrotask(callback)
    this.notifyScheduled = true
    schedule(() => {
      this.notifyScheduled = false
      for (const listener of [...this.listeners]) listener()
    })
  }
}
