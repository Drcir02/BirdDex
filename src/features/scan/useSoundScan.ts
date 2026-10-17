// Drives a sound scan with the sound engine: start (inside the tap), live updates, stop, the minute limit, and what to do
// when the page goes away or the microphone is taken. The states are in soundScan.ts; the screen only draws them.
//
//   const scan = useSoundScan()
//   <button onClick={scan.start}>   // the engine is started synchronously inside the click, which iOS needs for audio
//   scan.state.phase, scan.state.level, scan.state.candidates ...
//   scan.stop()                     // Done: collects the result and goes to the result screen
//   scan.showPartial()              // after a pause: go on to the result screen with what was heard so far

import { useCallback, useEffect, useReducer, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { ROUTES } from '../../app/routes'
import type { SoundResult, SoundSession } from '../../domain/engines'
import { getEngines } from '../../ml/engines'
import { setPending } from '../../state/pending'
import { classifyScanError } from './errors'
import { buildSoundPending } from './pendingBuilders'
import { knownLocation, locationForCatch, warmLocation, warmLocationIfAllowed } from './scanLocation'
import { INITIAL_SOUND_STATE, SOUND_LIMIT_MS, soundReducer, type PauseReason, type SoundScanState } from './soundScan'

export interface SoundScan {
  state: SoundScanState
  /** Call it straight from a click or tap: the microphone has to be opened inside the gesture. */
  start: () => void
  /** Done: stops listening, collects the result and opens the result screen. */
  stop: () => void
  /** After a pause: opens the result screen with what was heard before it. */
  showPartial: () => void
}

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now())

export function useSoundScan(): SoundScan {
  const navigate = useNavigate()
  const [state, dispatch] = useReducer(soundReducer, INITIAL_SOUND_STATE)

  const attempt = useRef(0)
  const busy = useRef(false)
  const finishing = useRef(false)
  const disposed = useRef(false)
  const session = useRef<SoundSession | undefined>(undefined)
  const startedAt = useRef<number | undefined>(undefined)
  const limitTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const earlyPause = useRef<PauseReason | undefined>(undefined)
  const partial = useRef<SoundResult | undefined>(undefined)
  // Done was tapped while the engine was still getting ready (the first level already showed the Stop button): stop as soon as it is.
  const stopWanted = useRef(false)

  const clearLimit = () => {
    if (limitTimer.current !== undefined) clearTimeout(limitTimer.current)
    limitTimer.current = undefined
  }

  /** The scan is over for good (the result screen opens) or has failed: allow a new start. */
  const release = () => {
    session.current = undefined
    startedAt.current = undefined
    finishing.current = false
    busy.current = false
    clearLimit()
  }

  const stop = useCallback(() => {
    const current = session.current
    if (!current && busy.current && !finishing.current) {
      stopWanted.current = true
      dispatch({ type: 'stopping' })
      return
    }
    if (!current || finishing.current) return
    finishing.current = true
    clearLimit()
    dispatch({ type: 'stopping' })
    void (async () => {
      try {
        const result = await current.stop()
        if (disposed.current) return
        const location = await locationForCatch()
        if (disposed.current) return
        setPending(buildSoundPending(result, location))
        release()
        navigate(ROUTES.result)
      } catch (error) {
        release()
        if (!disposed.current) dispatch({ type: 'failed', error: classifyScanError(error, 'microphone') })
      }
    })()
  }, [navigate])

  /** The scan stopped on its own (page hidden, microphone taken away): keep what was heard and let the person decide. */
  const interrupt = useCallback((reason: PauseReason) => {
    const current = session.current
    if (!current) {
      earlyPause.current = reason // the microphone has not opened yet; pause as soon as it does
      return
    }
    if (finishing.current) return
    finishing.current = true
    clearLimit()
    dispatch({ type: 'stopping' })
    void (async () => {
      try {
        const result = await current.stop()
        partial.current = result
        const hasResult = result.candidates.length > 0 || result.clip !== undefined
        release()
        if (!disposed.current) dispatch({ type: 'paused', reason, hasResult })
      } catch (error) {
        release()
        if (!disposed.current) dispatch({ type: 'failed', error: classifyScanError(error, 'microphone') })
      }
    })()
  }, [])

  const start = useCallback(() => {
    if (busy.current) return
    busy.current = true
    const mine = ++attempt.current
    const current = () => !disposed.current && attempt.current === mine
    partial.current = undefined
    earlyPause.current = undefined
    startedAt.current = undefined
    stopWanted.current = false
    dispatch({ type: 'start' })
    // Everything from here to the call of the engine runs inside the tap, which is what lets iOS open the microphone.
    let opening: Promise<SoundSession>
    try {
      opening = getEngines().sound.start({
        location: knownLocation(),
        date: new Date(),
        onUpdate: (update) => {
          if (!current()) return
          if (stopWanted.current) return
          if (startedAt.current === undefined) {
            startedAt.current = now()
            dispatch({ type: 'listening', startedAt: startedAt.current })
          }
          dispatch({ type: 'update', update })
        },
        onError: (error) => {
          if (!current()) return
          const kind = classifyScanError(error, 'microphone')
          if (kind === 'micMissing') {
            interrupt('microphone')
            return
          }
          // Analysing keeps failing (not the microphone): stop and tell.
          const open = session.current
          void open?.stop().catch(() => undefined)
          release()
          dispatch({ type: 'failed', error: kind })
        },
      })
    } catch (error) {
      release()
      dispatch({ type: 'failed', error: classifyScanError(error, 'microphone') })
      return
    }
    opening.then(
      (opened) => {
        if (!current()) {
          void opened.stop().catch(() => undefined) // the screen went away while the microphone was opening
          return
        }
        session.current = opened
        startedAt.current ??= now()
        if (stopWanted.current) {
          stopWanted.current = false
          stop()
          return
        }
        dispatch({ type: 'listening', startedAt: startedAt.current })
        limitTimer.current = setTimeout(stop, SOUND_LIMIT_MS)
        // The microphone question has been answered with yes: now is the time for the location question, so the two never compete.
        warmLocation()
        // An Android app that asks for the microphone is out of sight for a moment (the system's question covers it), so the page
        // only counts as gone if it still is when the microphone opens.
        if (earlyPause.current) interrupt(earlyPause.current)
        else if (typeof document !== 'undefined' && document.hidden) interrupt('hidden')
      },
      (error: unknown) => {
        if (!current()) return
        release()
        dispatch({ type: 'failed', error: classifyScanError(error, 'microphone') })
      },
    )
  }, [interrupt, stop])

  const showPartial = useCallback(() => {
    const result = partial.current
    if (!result) return
    partial.current = undefined
    void (async () => {
      const location = await locationForCatch()
      if (disposed.current) return
      setPending(buildSoundPending(result, location))
      navigate(ROUTES.result)
    })()
  }, [navigate])

  // When the page goes to the background the phone takes the microphone away; say so instead of pretending to listen.
  useEffect(() => {
    const onVisibility = () => {
      // Before the microphone is open there is nothing to stop (and the system's own question may hide the page for a moment).
      if (document.hidden && session.current) interrupt('hidden')
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [interrupt])

  // Leaving the screen ends the scan and releases the microphone.
  useEffect(() => {
    disposed.current = false
    void warmLocationIfAllowed()
    return () => {
      disposed.current = true
      attempt.current += 1
      clearLimit()
      const open = session.current
      session.current = undefined
      void open?.stop().catch(() => undefined)
    }
  }, [])

  return { state, start, stop, showPartial }
}
