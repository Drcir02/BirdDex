import { describe, expect, it } from 'vitest'
import { BackupError, StorageFullError } from '../../src/db'
import { ModelChecksumError, ModelDownloadError, ModelStorageFullError, type ModelDownloadReason } from '../../src/ml/runtime/modelErrors'
import { commonErrorKey } from '../../src/state/failures'

describe('commonErrorKey', () => {
  it('says "storage full" for every kind of full phone', () => {
    expect(commonErrorKey(new StorageFullError())).toBe('storageFull')
    expect(commonErrorKey(new ModelStorageFullError('no room'))).toBe('storageFull')
    expect(commonErrorKey(new BackupError('storage-full', 'no room'))).toBe('storageFull')
  })

  it('says "no connection" when the phone is offline, and "model download failed" for other download problems', () => {
    const reasons: [ModelDownloadReason, string][] = [
      ['offline', 'network'],
      ['network', 'modelDownload'],
      ['http', 'modelDownload'],
      ['incomplete', 'modelDownload'],
      ['manifest', 'modelDownload'],
      ['unknown-file', 'modelDownload'],
    ]
    for (const [reason, key] of reasons) expect(commonErrorKey(new ModelDownloadError('x', { reason }))).toBe(key)
  })

  it('treats a damaged model file like a failed download (try again)', () => {
    expect(commonErrorKey(new ModelChecksumError('x', { expected: 'a', actual: 'b' }))).toBe('modelDownload')
  })

  it('falls back to the generic message for everything else', () => {
    expect(commonErrorKey(new Error('boom'))).toBe('generic')
    expect(commonErrorKey(new BackupError('malformed', 'bad file'))).toBe('generic')
    expect(commonErrorKey(undefined)).toBe('generic')
    expect(commonErrorKey('text')).toBe('generic')
  })
})
