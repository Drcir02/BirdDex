// The hook behind the model banner and the scan screens' "wait until the engine is ready" step.
//
//   const readiness = useModelReadiness('sound')          // a scan screen: starts the engine by itself when the files are here
//   const hub = useModelReadiness('all', { autoPrepare: false })   // the hub: only says whether the files are here
//
//   readiness.view.phase      checking | needed | working | ready | error
//   readiness.start()         the button "Stáhnout ptačí mozek" and "Zkusit znovu"
//
// Downloading goes through the engines' own prepare() (so the runtimes are cached for offline use too, and the fakes
// can pretend), and the progress of other screens' downloads comes from the model store's status.

import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react'
import { getEngineMode, getEngines } from '../../ml/engines'
import { useModelStatus } from '../../state/modelStatus'
import { requestPersistentStorage } from '../../state/storage'
import { classifyScanError } from './errors'
import {
  fakeBytesFor,
  FAKE_BYTES,
  IDLE_RUN,
  isFakePrepared,
  isRealDownload,
  markPrepared,
  modelFilesFor,
  prepareKind,
  deriveReadiness,
  runReducer,
  summarizeStatus,
  type ReadinessKind,
  type ReadinessView,
} from './modelReadiness'

export interface ModelReadiness {
  view: ReadinessView
  /** Downloads and prepares (or tries again after a failure). Safe to call at any time. */
  start: () => void
}

export interface ModelReadinessOptions {
  /** Start the engine by itself as soon as its files are on the phone. Default: yes, except for the hub ('all'). */
  autoPrepare?: boolean
}

export function useModelReadiness(kind: ReadinessKind, options: ModelReadinessOptions = {}): ModelReadiness {
  const autoPrepare = options.autoPrepare ?? kind !== 'all'
  const status = useModelStatus()
  const [run, dispatch] = useReducer(runReducer, IDLE_RUN)
  const fake = getEngineMode() === 'fake'

  const summary = useMemo(() => summarizeStatus(status, modelFilesFor(kind)), [status, kind])
  const view = deriveReadiness({
    run,
    summary,
    fake,
    fakePrepared: isFakePrepared(kind),
    fakeBytes: fakeBytesFor(kind),
    autoPrepare,
  })

  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  // A newer start() makes the progress of an older one irrelevant.
  const runId = useRef(0)
  const statusRef = useRef(status)
  const viewRef = useRef(view)
  useEffect(() => {
    statusRef.current = status
    viewRef.current = view
  })

  const start = useCallback(() => {
    const id = ++runId.current
    const isCurrent = () => mounted.current && runId.current === id
    const sizeOf = (part: 'sound' | 'photo') => {
      const real = summarizeStatus(statusRef.current, modelFilesFor(part)).totalBytes
      return real > 0 ? real : FAKE_BYTES[part]
    }
    // Started by the person (the download button, "try again"): show the download at once. Started by the screen: only the engine starts.
    const asked = viewRef.current.phase === 'needed' || viewRef.current.phase === 'error'
    dispatch({ type: 'start', downloading: asked, totalBytes: asked ? viewRef.current.needBytes || viewRef.current.totalBytes : undefined })
    let downloaded = false
    void (async () => {
      try {
        await prepareKind(
          kind,
          getEngines(),
          (progress) => {
            if (isRealDownload(progress)) downloaded = true
            if (isCurrent()) dispatch({ type: 'progress', ...progress })
          },
          { sound: sizeOf('sound'), photo: sizeOf('photo') },
        )
        markPrepared(kind)
        // The phone may clear the cache of an app it considers unimportant. After the big download, ask it not to.
        if (downloaded) void requestPersistentStorage()
        if (isCurrent()) dispatch({ type: 'done' })
      } catch (error) {
        if (isCurrent()) dispatch({ type: 'failed', error: classifyScanError(error) })
      }
    })()
  }, [kind])

  useEffect(() => {
    if (view.startNow && run.run === 'idle') start()
  }, [view.startNow, run.run, start])

  return { view, start }
}
