// Which calm Czech message fits a failure of the sound scanner. The texts live in src/i18n/cs/common.ts under `errors`;
// this only picks the key, like commonErrorKey() in src/state/failures.ts does for the database and the model store:
//
//   t(`common.errors.${soundErrorKey(error)}` as const)

import { ModelChecksumError, ModelDownloadError, ModelStorageFullError } from '../runtime/modelErrors'
import { ModelLoadError } from '../runtime/litert'
import { SoundCaptureError } from '../audio/capture'

/** The keys of `common.errors` that sound failures can end in. */
export type SoundErrorKey = 'micDenied' | 'micMissing' | 'unsupported' | 'modelLoad' | 'modelDownload' | 'network' | 'storageFull' | 'generic'

export function soundErrorKey(error: unknown): SoundErrorKey {
  if (error instanceof SoundCaptureError) {
    switch (error.reason) {
      case 'denied':
        return 'micDenied'
      case 'no-device':
      case 'busy':
      case 'interrupted':
        return 'micMissing'
      case 'unsupported':
      case 'insecure':
        return 'unsupported'
      case 'failed':
      case 'timeout':
        return 'generic'
    }
  }
  if (error instanceof ModelStorageFullError) return 'storageFull'
  if (error instanceof ModelDownloadError) return error.reason === 'offline' ? 'network' : 'modelDownload'
  if (error instanceof ModelChecksumError) return 'modelDownload'
  if (error instanceof ModelLoadError) return 'modelLoad'
  return 'generic'
}
