// Turns whatever went wrong in a scan (a refused microphone, a camera that is gone, a model that did not download) into
// one of a few kinds, and each kind into a calm Czech message. The screens show the message next to a next step.
//
// The engine modules are loaded lazily on purpose (src/ml/engines.ts), so this file does not import their error classes:
// it recognises them by `name` (and `reason`), which every one of those classes sets itself.

import { ModelChecksumError, ModelDownloadError, ModelStorageFullError } from '../../ml/runtime/modelErrors'
import { isQuotaExceededError } from '../../state/storage'
import { t } from '../../i18n'

export type ScanErrorKind =
  | 'micDenied'
  | 'micMissing'
  | 'cameraDenied'
  | 'cameraMissing'
  | 'cameraBusy'
  | 'cameraStalled'
  | 'network'
  | 'storageFull'
  | 'modelDownload'
  | 'modelLoad'
  | 'unsupported'
  | 'generic'

/** What the person was using when it went wrong. A refused permission means a different thing for each. */
export type ScanDevice = 'microphone' | 'camera'

const nameOf = (error: unknown): string =>
  typeof error === 'object' && error !== null && 'name' in error ? String((error as { name: unknown }).name) : ''

const reasonOf = (error: unknown): string =>
  typeof error === 'object' && error !== null && 'reason' in error ? String((error as { reason: unknown }).reason) : ''

function fromSoundCapture(reason: string): ScanErrorKind {
  switch (reason) {
    case 'denied':
      return 'micDenied'
    case 'no-device':
    case 'busy':
    case 'interrupted':
      return 'micMissing'
    case 'unsupported':
    case 'insecure':
      return 'unsupported'
    default:
      return 'generic'
  }
}

function fromMediaDevices(name: string, device: ScanDevice): ScanErrorKind | undefined {
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
    case 'SecurityError':
      return device === 'camera' ? 'cameraDenied' : 'micDenied'
    case 'NotFoundError':
    case 'DevicesNotFoundError':
    case 'OverconstrainedError':
      return device === 'camera' ? 'cameraMissing' : 'micMissing'
    case 'NotReadableError':
    case 'TrackStartError':
    case 'AbortError':
      return device === 'camera' ? 'cameraBusy' : 'micMissing'
    default:
      return undefined
  }
}

export function classifyScanError(error: unknown, device?: ScanDevice): ScanErrorKind {
  if (error instanceof ModelStorageFullError || nameOf(error) === 'StorageFullError') return 'storageFull'
  if (error instanceof ModelDownloadError) return error.reason === 'offline' ? 'network' : 'modelDownload'
  if (error instanceof ModelChecksumError) return 'modelDownload'
  if (isQuotaExceededError(error)) return 'storageFull'

  const name = nameOf(error)
  if (name === 'SoundCaptureError') return fromSoundCapture(reasonOf(error))
  if (name === 'ModelLoadError') return 'modelLoad'
  if (name === 'ModelStorageFullError') return 'storageFull'
  if (name === 'ModelDownloadError') return reasonOf(error) === 'offline' ? 'network' : 'modelDownload'
  if (name === 'ModelChecksumError') return 'modelDownload'
  if (name === 'NotSupportedError') return 'unsupported'
  if (device) {
    const fromDevice = fromMediaDevices(name, device)
    if (fromDevice) return fromDevice
  }
  return 'generic'
}

/** The calm Czech sentence for an error kind. */
export function scanErrorText(kind: ScanErrorKind): string {
  switch (kind) {
    case 'micDenied':
      return t('common.errors.micDenied')
    case 'micMissing':
      return t('common.errors.micMissing')
    case 'cameraDenied':
      return t('common.errors.cameraDenied')
    case 'cameraMissing':
      return t('scan.errors.cameraMissing')
    case 'cameraBusy':
      return t('scan.errors.cameraBusy')
    case 'cameraStalled':
      return t('common.errors.cameraStalled')
    case 'network':
      return t('common.errors.network')
    case 'storageFull':
      return t('common.errors.storageFull')
    case 'modelDownload':
      return t('common.errors.modelDownload')
    case 'modelLoad':
      return t('common.errors.modelLoad')
    case 'unsupported':
      return t('common.errors.unsupported')
    case 'generic':
      return t('common.errors.generic')
  }
}

/** True when the fix is in the settings of the phone or the browser: the screens then show the steps. */
export const isPermissionError = (kind: ScanErrorKind): boolean => kind === 'micDenied' || kind === 'cameraDenied'
