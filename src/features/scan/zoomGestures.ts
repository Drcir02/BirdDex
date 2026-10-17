// Fingers on the camera picture: two fingers pinch to zoom, one finger drags the zoomed picture around, and the mouse wheel
// zooms on a computer. Returns the handlers for the transparent touch layer over the video (the buttons sit above that layer,
// so a tap on a button never reaches it). The arithmetic is in zoomMath.ts, the zoom itself in zoomController.ts.

import type { PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from 'react'
import type { ZoomController } from './zoomController'
import { pinchZoom, type Pan } from './zoomMath'

interface Point {
  x: number
  y: number
}

/** The mouse wheel: one notch of a typical wheel (about 100) changes the zoom by about 16 percent. */
const WHEEL_SPEED = 0.0015

export interface ZoomGestures {
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void
  onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void
  onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void
  onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void
  onWheel: (event: ReactWheelEvent<HTMLElement>) => void
}

export function createZoomGestures(controller: ZoomController): ZoomGestures {
  const pointers = new Map<number, Point>()
  let pinch: { startDistance: number; startZoom: number } | undefined
  let drag: { from: Point; pan: Pan } | undefined

  const distance = (): number => {
    const [a, b] = [...pointers.values()]
    return Math.hypot(a.x - b.x, a.y - b.y)
  }

  const release = (event: ReactPointerEvent<HTMLElement>) => {
    pointers.delete(event.pointerId)
    try {
      event.currentTarget.releasePointerCapture?.(event.pointerId)
    } catch {
      // The pointer is already gone.
    }
    // One finger left after a pinch does not start a drag by itself: it would jump. A new touch does.
    pinch = undefined
    if (pointers.size !== 1) drag = undefined
  }

  return {
    onPointerDown(event) {
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
      try {
        event.currentTarget.setPointerCapture?.(event.pointerId)
      } catch {
        // Some browsers refuse capture for synthetic pointers; the gesture still works while the finger stays on the layer.
      }
      if (pointers.size === 1) {
        drag = { from: { x: event.clientX, y: event.clientY }, pan: controller.getState().pan }
        pinch = undefined
      } else if (pointers.size === 2) {
        pinch = { startDistance: distance(), startZoom: controller.getState().zoom }
        drag = undefined
      } else {
        pinch = undefined
        drag = undefined
      }
    },

    onPointerMove(event) {
      if (!pointers.has(event.pointerId)) return
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
      if (pinch && pointers.size === 2) {
        const { min, max } = controller.getState()
        controller.setZoom(pinchZoom(pinch.startZoom, pinch.startDistance, distance(), min, max))
      } else if (drag && pointers.size === 1) {
        controller.dragFrom(drag.pan, event.clientX - drag.from.x, event.clientY - drag.from.y)
      }
    },

    onPointerUp: release,
    onPointerCancel: release,

    onWheel(event) {
      if (!Number.isFinite(event.deltaY) || event.deltaY === 0) return
      controller.zoomBy(Math.exp(-event.deltaY * WHEEL_SPEED))
    },
  }
}
