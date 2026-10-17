// The live camera scanner: looks at the camera picture a few times a second and tells which bird it sees. Implements
// LiveScanner (src/domain/engines.ts); src/ml/engines.ts loads this module the first time a screen needs it.
//
//   const session = await getEngines().live.start(videoElement, { location, onUpdate })
//   ...                                       // onUpdate: top 3, pBird, lockedSpeciesId once a bird is steady, fps
//   const jpeg = await session.snapshot()     // the picture to save with the catch
//   session.stop()
//
// How it works: one frame is taken from the <video> element at most every 700 ms, and never while the model is still busy
// with the one before (so a slow phone simply gets fewer frames, and the pause grows so that the model uses at most 80 percent
// of the time). The model is the one of the photo engine (runtime.ts); call getEngines().photo.prepare() first to get a
// progress bar for the download, otherwise start() loads the model itself and takes its time. The guesses of the last
// five frames are averaged, and a bird is locked when the same one has led for three frames in a row (liveLogic.ts).

import type { FrameView, ImageSource, LiveScanner, LiveSession, LiveUpdate } from '../../domain/engines'
import type { Candidate } from '../../domain/types'
import type { VisionFrame } from './core'
import { LIVE } from './constants'
import { canvasToJpeg, copyToCanvas, grabLiveFrame, snapshotJpeg } from './frame'
import { Average, LiveTracker, nextDelayMs, sameView } from './liveLogic'
import { resolveLogWeights } from './prior'
import { getVisionRuntime, type VisionRuntime } from './runtime'

/** The start options of LiveScanner (src/domain/engines.ts), including the optional onError. */
export type LiveStartOptions = Parameters<LiveScanner['start']>[1]

export interface LiveScannerDeps {
  runtime?: VisionRuntime
  /** Reads a frame of the video as pixels (only the zoomed part of it when there is a view). Default: grabLiveFrame. */
  grab?: (video: HTMLVideoElement, view?: FrameView) => VisionFrame
  /** A JPEG of a picture (only the zoomed part of it when there is a view). Default: snapshotJpeg. */
  snapshot?: (source: ImageSource, view?: FrameView) => Promise<Blob>
  /** Copies the picture for later (after stop). Default: copyToCanvas; the result is turned into a JPEG by `encode`. */
  keep?: (source: ImageSource, view?: FrameView) => unknown
  encode?: (kept: unknown) => Promise<Blob>
  now?: () => number
  setTimer?: (callback: () => void, ms: number) => unknown
  clearTimer?: (handle: unknown) => void
  /** True while the page is in the background: no frames are analysed then. */
  isHidden?: () => boolean
}

/** After this many failed analyses in a row the scanner gives up. */
const MAX_FAILURES = 3

/** A pause between looking again when the camera has no new picture yet or the page is hidden. */
const WAIT_MS = 200

function videoHasPicture(video: HTMLVideoElement): boolean {
  return video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0
}

export function createLiveScanner(deps: LiveScannerDeps = {}): LiveScanner {
  const now = deps.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()))
  const setTimer = deps.setTimer ?? ((callback, ms) => setTimeout(callback, ms))
  const clearTimer = deps.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>))
  const grab = deps.grab ?? grabLiveFrame
  const takeSnapshot = deps.snapshot ?? ((source: ImageSource, view?: FrameView) => snapshotJpeg(source, view ? { view } : {}))
  const keep = deps.keep ?? ((source: ImageSource, view?: FrameView) => copyToCanvas(source, undefined, view))
  const encode = deps.encode ?? ((kept: unknown) => canvasToJpeg(kept as HTMLCanvasElement))
  const isHidden = deps.isHidden ?? (() => typeof document !== 'undefined' && document.hidden)

  return {
    async start(video, options): Promise<LiveSession> {
      const runtime = deps.runtime ?? getVisionRuntime()
      const release = runtime.hold()
      let tracker: LiveTracker
      let speciesIds: string[]
      let logPrior: Float32Array | undefined
      try {
        await runtime.prepare()
        const dex = runtime.dex
        speciesIds = dex.map((species) => species.id)
        logPrior = await resolveLogWeights(dex, { location: options.location, date: options.date })
        tracker = new LiveTracker(dex.length)
      } catch (error) {
        release()
        throw error
      }

      let stopped = false
      let timer: unknown
      let failures = 0
      let lastTime = Number.NaN
      let kept: unknown
      // The zoomed part of the picture, as the screen asks for it. When it changes, what was seen before belongs to another
      // scene: the average and the lock start again, and an analysis that was already running is dropped when it comes back.
      let lastView: FrameView | undefined
      const readView = (): FrameView | undefined => {
        try {
          return options.getView?.()
        } catch {
          return undefined
        }
      }
      const duration = new Average(0.4)
      const period = new Average(0.4)
      let lastDone: number | undefined

      const finish = () => {
        if (stopped) return
        stopped = true
        if (timer !== undefined) clearTimer(timer)
        timer = undefined
        // Keep the last picture so snapshot() still works after the screen has switched the camera off.
        if (kept === undefined && videoHasPicture(video)) {
          try {
            kept = keep(video, readView())
          } catch {
            // No picture to keep: snapshot() will say so.
          }
        }
        tracker.reset()
        release()
      }

      const emit = (scores: Awaited<ReturnType<VisionRuntime['analyse']>>, startedAt: number, doneAt: number) => {
        const length = scores.probs.length
        const confidences = new Float32Array(length)
        const pBird = scores.blank || !Number.isFinite(scores.pBird) ? 0 : scores.pBird
        for (let i = 0; i < length; i++) confidences[i] = pBird * scores.probs[i]
        const state = tracker.update({ confidences, pBird, outsideDexTop: scores.outsideTop })
        const took = duration.add(doneAt - startedAt)
        // Between two results; for the first one there is no earlier result, so the pace the loop is set to stands in.
        const gap = lastDone === undefined ? Math.max(doneAt - startedAt, LIVE.minIntervalMs) : doneAt - lastDone
        lastDone = doneAt
        const averageGap = period.add(gap)
        const candidates: Candidate[] = state.guesses.map((guess) => ({ speciesId: speciesIds[guess.index], confidence: guess.confidence }))
        const update: LiveUpdate = {
          candidates,
          pBird: state.pBird,
          outsideDexTop: state.outsideDexTop,
          framesPerSecond: averageGap > 0 ? 1000 / averageGap : 0,
          ...(state.lockedIndex !== undefined ? { lockedSpeciesId: speciesIds[state.lockedIndex] } : {}),
        }
        try {
          options.onUpdate(update)
        } catch (error) {
          // A screen that throws must not stop the camera.
          console.error('onUpdate of the live scanner failed', error)
        }
        return took
      }

      const schedule = (delayMs: number) => {
        if (stopped) return
        timer = setTimer(tick, Math.max(0, delayMs))
      }

      const tick = () => {
        timer = undefined
        if (stopped) return
        if (isHidden() || !videoHasPicture(video) || video.paused || video.ended) {
          schedule(WAIT_MS)
          return
        }
        // A camera that delivers no new picture is not analysed again (the same frame would only repeat itself).
        const time = video.currentTime
        if (time === lastTime) {
          schedule(WAIT_MS)
          return
        }
        lastTime = time

        const view = readView()
        if (!sameView(view, lastView)) {
          lastView = view
          tracker.reset()
        }

        let frame: VisionFrame
        try {
          frame = grab(video, view)
        } catch {
          schedule(WAIT_MS)
          return
        }
        const startedAt = now()
        const fail = (error: unknown) => {
          failures++
          if (failures >= MAX_FAILURES) {
            finish()
            try {
              options.onError?.(error)
            } catch (callbackError) {
              console.error('onError of the live scanner failed', callbackError)
            }
            return
          }
          // Try again after a normal pause (a worker that died is started again by the next analyse).
          schedule(nextDelayMs(startedAt, now(), duration.current ?? 0))
        }
        runtime.analyse(frame, { logPrior }).then(
          (scores) => {
            if (stopped) return
            const doneAt = now()
            if (!sameView(readView(), view)) {
              // The view changed while this frame was being analysed: its answer is about something else now.
              failures = 0
              schedule(nextDelayMs(startedAt, doneAt, duration.add(doneAt - startedAt)))
              return
            }
            let took: number
            try {
              took = emit(scores, startedAt, doneAt)
            } catch (error) {
              fail(error)
              return
            }
            failures = 0
            schedule(nextDelayMs(startedAt, doneAt, took))
          },
          (error: unknown) => {
            if (!stopped) fail(error)
          },
        )
      }

      schedule(0)

      return {
        stop: finish,
        async snapshot() {
          if (!stopped && videoHasPicture(video)) return takeSnapshot(video, readView())
          if (kept !== undefined) return encode(kept)
          throw new Error('The camera has no picture to save yet')
        },
      }
    },
  }
}
