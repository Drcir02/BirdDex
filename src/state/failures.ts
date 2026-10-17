// Which calm Czech message fits a failure from the database, the backup or the model store.
// The texts live in src/i18n/cs/common.ts under `errors`; this only picks the key:
//
//   t(`common.errors.${commonErrorKey(error)}` as const)

import { BackupError } from '../db/backup'
import { StorageFullError } from '../db/errors'
import { ModelChecksumError, ModelDownloadError, ModelStorageFullError } from '../ml/runtime/modelErrors'

/** The keys of `common.errors` that these failures can end in. */
export type CommonErrorKey = 'generic' | 'network' | 'storageFull' | 'modelDownload'

export function commonErrorKey(error: unknown): CommonErrorKey {
  if (error instanceof StorageFullError || error instanceof ModelStorageFullError) return 'storageFull'
  if (error instanceof BackupError) return error.code === 'storage-full' ? 'storageFull' : 'generic'
  if (error instanceof ModelDownloadError) return error.reason === 'offline' ? 'network' : 'modelDownload'
  if (error instanceof ModelChecksumError) return 'modelDownload'
  return 'generic'
}
