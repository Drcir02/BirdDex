// Everything screens need from the database. Import from 'src/db', not from the files inside.

export { BirdDexDatabase, closeDb, DB_NAME, getDb, SCHEMA_VERSIONS } from './database'
export type { PhotoCacheRecord, SchemaVersion } from './database'
export { DatabaseUnavailableError, StorageFullError } from './errors'
export { newId } from './ids'
export {
  addCatch,
  addCatches,
  catchesBySpecies,
  clearPhotoCache,
  countCatches,
  deleteAllCatches,
  deleteCatch,
  getCachedPhoto,
  getCatch,
  getMedia,
  listCatches,
  putCachedPhoto,
  updateCatchNote,
} from './repository'
export type { NewCatch, NewMedia } from './repository'
export { summarizeCatches, useCaughtSummary, useRecentCatches, useSpeciesCatches } from './summary'
export type { CaughtSummary, SpeciesCaughtSummary } from './summary'
export { useMediaUrl } from './hooks'
export type { MediaUrl } from './hooks'
export { createLiveStore, useLiveQuery } from './live'
export type { LiveSnapshot, LiveStore } from './live'
export { backupFileName, BackupError, exportBackup, importBackup, BACKUP_FORMAT, BACKUP_FORMAT_VERSION } from './backup'
export type { BackupErrorCode, ImportReport } from './backup'
export { saveBackupFile } from './backupFile'
export type { BackupSaveResult } from './backupFile'
