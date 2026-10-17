// The states of the photo screen as a small pure state machine. The hook that drives it with files, canvases and the photo
// engine is usePhotoScan.ts.
//
//   choose -> opening (decoding the chosen photo) -> preview (optional crop) -> identifying -> (the result screen)
//        \__ a message about the file when it cannot be used                \__ back to preview with a message when it fails

import type { ScanErrorKind } from './errors'
import { FULL_CROP, type CropRect } from './cropMath'
import type { FileProblem } from './imageSizing'
import type { ImageFileProblem } from './imageFile'

export type PhotoProblem = FileProblem | ImageFileProblem

export interface PhotoPreview {
  /** An address for the <img>, made from the opened picture. */
  url: string
  /** The shape of the opened picture, so the box on top of it fits. */
  width: number
  height: number
}

export interface PhotoScanState {
  phase: 'choose' | 'opening' | 'preview' | 'identifying'
  /** Why the last chosen file could not be used (shown in the choose phase). */
  problem?: PhotoProblem
  /** Why identifying failed (shown in the preview phase, next to the button to try again). */
  failure?: ScanErrorKind
  preview?: PhotoPreview
  crop: CropRect
}

export const INITIAL_PHOTO_STATE: PhotoScanState = { phase: 'choose', crop: FULL_CROP }

export type PhotoAction =
  | { type: 'opening' }
  | { type: 'opened'; preview: PhotoPreview }
  | { type: 'problem'; problem: PhotoProblem }
  | { type: 'crop'; crop: CropRect }
  | { type: 'identifying' }
  | { type: 'failed'; error: ScanErrorKind }
  | { type: 'reset' }

export function photoReducer(state: PhotoScanState, action: PhotoAction): PhotoScanState {
  switch (action.type) {
    case 'opening':
      return { phase: 'opening', crop: FULL_CROP }
    case 'opened':
      return { phase: 'preview', preview: action.preview, crop: FULL_CROP }
    case 'problem':
      // A bad file leaves the previous photo (if any) as it was; with none, the person is back at the two buttons.
      return state.preview ? { ...state, phase: 'preview', problem: action.problem } : { phase: 'choose', problem: action.problem, crop: FULL_CROP }
    case 'crop':
      return state.phase === 'preview' ? { ...state, crop: action.crop } : state
    case 'identifying':
      return state.phase === 'preview' ? { ...state, phase: 'identifying', failure: undefined, problem: undefined } : state
    case 'failed':
      return state.phase === 'identifying' ? { ...state, phase: 'preview', failure: action.error } : state
    case 'reset':
      return INITIAL_PHOTO_STATE
  }
}

/** The Czech message for a file problem. */
export function photoProblemKey(
  problem: PhotoProblem,
): 'scan.photo.errors.heic' | 'scan.photo.errors.notImage' | 'scan.photo.errors.unreadable' | 'scan.photo.errors.tooBig' | 'scan.photo.errors.empty' {
  switch (problem) {
    case 'heic':
      return 'scan.photo.errors.heic'
    case 'notImage':
      return 'scan.photo.errors.notImage'
    case 'tooBig':
      return 'scan.photo.errors.tooBig'
    case 'empty':
      return 'scan.photo.errors.empty'
    case 'unreadable':
      return 'scan.photo.errors.unreadable'
  }
}
