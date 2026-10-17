// Drives the live camera scan: opens the camera, shows it in a <video>, starts the live scanner on it, notices a stalled
// camera, switches everything off when the page goes away, and turns the Catch button into a pending identification.
// The states are in liveScan.ts; the screen only draws them.
//
//   const video = useRef<HTMLVideoElement>(null)
//   const scan = useLiveScan(video)
//   <button onClick={scan.start}>      // open the camera from a tap: iPhones are happier that way
//   scan.state.phase, scan.state.update ...
//   scan.catchNow()                    // snapshot + pending identification + the result screen

import { useCallback, useEffect, useReducer, useRef, useState, useSyncExternalStore, type RefObject } from 'react'
import { useNavigate } from 'react-router-dom'
import { ROUTES } from '../../app/routes'
import type { LiveSession, LiveUpdate } from '../../domain/engines'
import { getEngines } from '../../ml/engines'
import { setPending } from '../../state/pending'
import { classifyScanError } from './errors'
import { canCatchLive, INITIAL_LIVE_STATE, liveReducer, StallWatch, withoutLock, type LiveScanState } from './liveScan'
import { buildLivePending } from './pendingBuilders'
import { knownLocation, locationForCatch, warmLocation, warmLocationIfAllowed } from './scanLocation'
import { ZoomController, type ZoomState } from './zoomController'
import { createZoomGestures, type ZoomGestures } from './zoomGestures'
import type { Size } from './zoomMath'

/** What the screen needs to let the person zoom: the state for the buttons, and the handlers for the touch layer. */
export interface LiveZoom {
  state: ZoomState
  setZoom: (zoom: number) => void
  gestures: ZoomGestures
}

export interface LiveScan {
  state: LiveScanState
  canCatch: boolean
  start: () => void
  /** Switches the camera off and goes back to the start button. */
  stop: () => void
  catchNow: () => void
  zoom: LiveZoom
}

type FrameVideo = HTMLVideoElement & { requestVideoFrameCallback?: (callback: () => void) => number; cancelVideoFrameCallback?: (handle: number) => void }

const POLL_MS = 250
const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now())

// Full HD, not 1280x720: zooming in digitally cuts a part out of the picture, and a bird that is far away needs the pixels.
export const CAMERA_CONSTRAINTS: MediaStreamConstraints = {
  video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
  audio: false,
}

function sizeOf(element: Element | null | undefined): Size | undefined {
  const rect = element?.getBoundingClientRect()
  return rect && rect.width > 0 && rect.height > 0 ? { width: rect.width, height: rect.height } : undefined
}

/** `boxRef` is the box the picture is shown in (the whole screen); without it the video element itself is measured. */
export function useLiveScan(videoRef: RefObject<HTMLVideoElement | null>, boxRef?: RefObject<HTMLElement | null>): LiveScan {
  const navigate = useNavigate()
  const [state, dispatch] = useReducer(liveReducer, INITIAL_LIVE_STATE)

  const attempt = useRef(0)
  const busy = useRef(false)
  const disposed = useRef(false)
  const catching = useRef(false)
  const stream = useRef<MediaStream | undefined>(undefined)
  const session = useRef<LiveSession | undefined>(undefined)
  const lastUpdate = useRef<LiveUpdate | undefined>(undefined)
  const poll = useRef<ReturnType<typeof setInterval> | undefined>(undefined)
  const frameLoop = useRef<{ stop: () => void } | undefined>(undefined)

  const [zoomController] = useState(
    () =>
      new ZoomController({
        applyTransform: (transform) => {
          const video = videoRef.current
          if (video) video.style.transform = transform === 'none' ? '' : transform
        },
        boxSize: () => sizeOf(boxRef?.current ?? videoRef.current),
        frameSize: () => {
          const video = videoRef.current
          return video && video.videoWidth > 0 && video.videoHeight > 0 ? { width: video.videoWidth, height: video.videoHeight } : undefined
        },
        onViewChange: () => {
          // A lock on a bird belongs to what was on the screen before: let go of it at once, also for the Catch button.
          if (lastUpdate.current?.lockedSpeciesId !== undefined) lastUpdate.current = withoutLock(lastUpdate.current)
          dispatch({ type: 'viewChanged' })
        },
      }),
  )
  const [gestures] = useState(() => createZoomGestures(zoomController))
  const zoomState = useSyncExternalStore(zoomController.subscribe, zoomController.getState)

  /** Switches the scanner, the camera and the video off. Safe to call at any time and many times. */
  const teardown = useCallback(() => {
    attempt.current += 1
    if (poll.current !== undefined) clearInterval(poll.current)
    poll.current = undefined
    frameLoop.current?.stop()
    frameLoop.current = undefined
    const open = session.current
    session.current = undefined
    try {
      open?.stop()
    } catch {
      // Already stopped.
    }
    stream.current?.getTracks().forEach((track) => track.stop())
    stream.current = undefined
    zoomController.detach()
    const video = videoRef.current
    if (video) {
      video.pause()
      video.srcObject = null
    }
    lastUpdate.current = undefined
    busy.current = false
    catching.current = false
  }, [videoRef, zoomController])

  const start = useCallback(() => {
    if (busy.current) return
    busy.current = true
    const mine = ++attempt.current
    const current = () => !disposed.current && attempt.current === mine
    dispatch({ type: 'start' })

    void (async () => {
      try {
        const video = videoRef.current as FrameVideo | null
        if (!video) throw new Error('There is no video element to show the camera in')
        if (!navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error('This browser has no camera API'), { name: 'NotSupportedError' })

        const opened = await navigator.mediaDevices.getUserMedia(CAMERA_CONSTRAINTS)
        if (!current()) {
          opened.getTracks().forEach((track) => track.stop())
          return
        }
        stream.current = opened
        zoomController.attach(opened.getVideoTracks?.()[0] ?? opened.getTracks()[0])
        // The camera question has been answered with yes: now is the time for the location question, so the two never compete.
        warmLocation()
        video.srcObject = opened
        video.muted = true
        video.playsInline = true
        // Not awaited: on some phones play() never answers when the camera is stuck (an iPhone home-screen app), and the
        // stall watch below must be running by then. It is the pictures that tell whether the camera works.
        void Promise.resolve(video.play()).catch(() => undefined)

        // Count the pictures that really arrive. Without requestVideoFrameCallback the playback time stands in.
        let frames = 0
        if (typeof video.requestVideoFrameCallback === 'function') {
          let handle = 0
          let alive = true
          const onFrame = () => {
            frames += 1
            if (alive) handle = video.requestVideoFrameCallback!(onFrame)
          }
          handle = video.requestVideoFrameCallback(onFrame)
          frameLoop.current = {
            stop: () => {
              alive = false
              video.cancelVideoFrameCallback?.(handle)
            },
          }
        }
        const watch = new StallWatch(now())
        poll.current = setInterval(() => {
          if (!current()) return
          const hasFrame = video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0
          const marker = frameLoop.current ? frames : video.currentTime
          const verdict = watch.check({ hasFrame, marker }, now())
          if (verdict === 'running') dispatch({ type: 'running' })
          else if (verdict === 'stalled') {
            teardown()
            dispatch({ type: 'stalled' })
          }
        }, POLL_MS)

        const scanner = await getEngines().live.start(video, {
          location: knownLocation(),
          date: new Date(),
          getView: zoomController.getView,
          onUpdate: (update) => {
            if (!current()) return
            lastUpdate.current = update
            dispatch({ type: 'update', update })
          },
          onError: (error) => {
            if (!current()) return
            teardown()
            dispatch({ type: 'failed', error: classifyScanError(error, 'camera') })
          },
        })
        if (!current()) {
          scanner.stop()
          return
        }
        session.current = scanner
      } catch (error) {
        if (!current()) return
        teardown()
        dispatch({ type: 'failed', error: classifyScanError(error, 'camera') })
      }
    })()
  }, [teardown, videoRef, zoomController])

  const stop = useCallback(() => {
    teardown()
    dispatch({ type: 'reset' })
  }, [teardown])

  const catchNow = useCallback(() => {
    const live = session.current
    const update = lastUpdate.current
    if (!live || !update?.lockedSpeciesId || catching.current) return
    catching.current = true
    dispatch({ type: 'catching' })
    void (async () => {
      try {
        const snapshot = await live.snapshot()
        const location = await locationForCatch()
        if (disposed.current) return
        setPending(buildLivePending(update, snapshot, location))
        teardown()
        navigate(ROUTES.result)
      } catch {
        catching.current = false
        if (!disposed.current) dispatch({ type: 'catchFailed' })
      }
    })()
  }, [navigate, teardown])

  // The phone switches the camera off when the page goes to the background; do not pretend it is still on.
  useEffect(() => {
    const onVisibility = () => {
      // Only a camera that is on is switched off. While the question "allow the camera?" is open the page may be hidden for a
      // moment (an Android app is covered by the system's question), and that must not cancel the start.
      if (document.hidden && stream.current) {
        teardown()
        dispatch({ type: 'paused' })
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [teardown])

  // Leaving the screen always switches the camera off.
  useEffect(() => {
    disposed.current = false
    void warmLocationIfAllowed()
    return () => {
      disposed.current = true
      teardown()
    }
  }, [teardown])

  const setZoom = useCallback((zoom: number) => zoomController.setZoom(zoom), [zoomController])

  return { state, canCatch: canCatchLive(state), start, stop, catchNow, zoom: { state: zoomState, setZoom, gestures } }
}
