// Drives the photo screen: opens the chosen file, keeps the working picture, identifies the (cropped) picture with the
// photo engine and hands the result to the result screen. The states are in photoScan.ts; the screen only draws them.
//
//   const scan = usePhotoScan()
//   <input type="file" onChange={(e) => scan.open(e.target.files?.[0])}>
//   <CropBox rect={scan.state.crop} onChange={scan.setCrop}>
//   scan.identify()

import { useCallback, useEffect, useReducer, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { ROUTES } from '../../app/routes'
import { getEngines } from '../../ml/engines'
import { setPending } from '../../state/pending'
import { FULL_CROP, type CropRect } from './cropMath'
import { classifyScanError } from './errors'
import { canvasToJpeg, cropToCanvas, ImageFileError, openImageFile, releaseCanvas } from './imageFile'
import { checkImageFile } from './imageSizing'
import { buildPhotoPending } from './pendingBuilders'
import { INITIAL_PHOTO_STATE, photoReducer, type PhotoScanState } from './photoScan'
import { knownLocation, locationForCatch, warmLocation } from './scanLocation'

export interface PhotoScan {
  state: PhotoScanState
  /** A file from the camera or gallery picker. Anything that is not a usable photo is explained, not thrown. */
  open: (file: File | undefined | null) => void
  setCrop: (crop: CropRect) => void
  resetCrop: () => void
  identify: () => void
  /** Back to the two buttons. */
  discard: () => void
}

export function usePhotoScan(): PhotoScan {
  const navigate = useNavigate()
  const [state, dispatch] = useReducer(photoReducer, INITIAL_PHOTO_STATE)
  const working = useRef<HTMLCanvasElement | undefined>(undefined)
  const crop = useRef<CropRect>(FULL_CROP)
  const disposed = useRef(false)
  const opening = useRef(0)
  const identifying = useRef(false)

  const open = useCallback((file: File | undefined | null) => {
    if (!file || identifying.current) return
    const problem = checkImageFile(file)
    if (problem) {
      dispatch({ type: 'problem', problem })
      return
    }
    // The person is about to catch something: this is the moment the browser may ask about the location.
    warmLocation()
    const mine = ++opening.current
    dispatch({ type: 'opening' })
    void (async () => {
      let canvas: HTMLCanvasElement | undefined
      try {
        canvas = await openImageFile(file)
        const preview = await canvasToJpeg(canvas)
        if (disposed.current || opening.current !== mine) {
          releaseCanvas(canvas)
          return
        }
        releaseCanvas(working.current)
        working.current = canvas
        crop.current = FULL_CROP
        dispatch({ type: 'opened', preview: { url: URL.createObjectURL(preview), width: canvas.width, height: canvas.height } })
      } catch (error) {
        releaseCanvas(canvas)
        if (disposed.current || opening.current !== mine) return
        // Opening a new photo dropped the old preview, so its picture is not needed any more either.
        releaseCanvas(working.current)
        working.current = undefined
        dispatch({ type: 'problem', problem: error instanceof ImageFileError ? error.problem : 'unreadable' })
      }
    })()
  }, [])

  const setCrop = useCallback((next: CropRect) => {
    crop.current = next
    dispatch({ type: 'crop', crop: next })
  }, [])

  const resetCrop = useCallback(() => setCrop(FULL_CROP), [setCrop])

  const identify = useCallback(() => {
    const picture = working.current
    if (!picture || identifying.current) return
    identifying.current = true
    dispatch({ type: 'identifying' })
    void (async () => {
      let part: HTMLCanvasElement | undefined
      try {
        part = cropToCanvas(picture, crop.current)
        const result = await getEngines().photo.identify(part, { location: knownLocation(), date: new Date() })
        const jpeg = await canvasToJpeg(part)
        const location = await locationForCatch()
        if (disposed.current) return
        setPending(buildPhotoPending(result, jpeg, location))
        navigate(ROUTES.result)
      } catch (error) {
        if (!disposed.current) dispatch({ type: 'failed', error: classifyScanError(error) })
      } finally {
        releaseCanvas(part)
        identifying.current = false
      }
    })()
  }, [navigate])

  const discard = useCallback(() => {
    if (identifying.current) return
    opening.current += 1
    releaseCanvas(working.current)
    working.current = undefined
    crop.current = FULL_CROP
    dispatch({ type: 'reset' })
  }, [])

  // The address of the preview picture is released when it is replaced and when the screen goes away.
  const previewUrl = state.preview?.url
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl)
    }
  }, [previewUrl])

  useEffect(() => {
    disposed.current = false
    return () => {
      disposed.current = true
      opening.current += 1
      releaseCanvas(working.current)
      working.current = undefined
    }
  }, [])

  return { state, open, setCrop, resetCrop, identify, discard }
}
