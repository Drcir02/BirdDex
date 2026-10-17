import { describe, expect, it } from 'vitest'
import { classifyScanError, isPermissionError, scanErrorText, type ScanErrorKind } from '../../src/features/scan/errors'
import { ModelChecksumError, ModelDownloadError, ModelStorageFullError } from '../../src/ml/runtime/modelErrors'

/** The engine modules are loaded lazily, so the screens recognise their errors by name: build the same shapes. */
function named(name: string, extra: Record<string, unknown> = {}): Error {
  const error = new Error(`${name} for a test`)
  error.name = name
  return Object.assign(error, extra)
}

const domError = (name: string) => named(name)

describe('classifyScanError: the model store', () => {
  it('maps a download that failed to a calm message, and "offline" to the network message', () => {
    expect(classifyScanError(new ModelDownloadError('x', { reason: 'offline' }))).toBe('network')
    expect(classifyScanError(new ModelDownloadError('x', { reason: 'network' }))).toBe('modelDownload')
    expect(classifyScanError(new ModelDownloadError('x', { reason: 'http', status: 404 }))).toBe('modelDownload')
    expect(classifyScanError(new ModelChecksumError('x', { expected: 'a', actual: 'b' }))).toBe('modelDownload')
  })

  it('maps a full phone to the storage message, from the model store and from the database', () => {
    expect(classifyScanError(new ModelStorageFullError('x'))).toBe('storageFull')
    expect(classifyScanError(named('StorageFullError'))).toBe('storageFull')
    expect(classifyScanError(domError('QuotaExceededError'))).toBe('storageFull')
  })

  it('recognises the errors of the engines by name', () => {
    expect(classifyScanError(named('ModelLoadError'))).toBe('modelLoad')
    expect(classifyScanError(named('ModelDownloadError', { reason: 'offline' }))).toBe('network')
    expect(classifyScanError(named('ModelDownloadError', { reason: 'http' }))).toBe('modelDownload')
  })
})

describe('classifyScanError: the code of an engine that cannot be fetched', () => {
  const failedImport = () => new TypeError('Failed to fetch dynamically imported module: https://example.org/assets/engine-abc.js')

  it('says "no network" when the phone is offline and "part of the app" when it is not', () => {
    const online = Object.getOwnPropertyDescriptor(Navigator.prototype, 'onLine')
    try {
      Object.defineProperty(Navigator.prototype, 'onLine', { configurable: true, get: () => false })
      expect(classifyScanError(failedImport())).toBe('network')
      Object.defineProperty(Navigator.prototype, 'onLine', { configurable: true, get: () => true })
      expect(classifyScanError(failedImport())).toBe('chunk')
      expect(classifyScanError(new TypeError('error loading dynamically imported module'))).toBe('chunk')
      expect(classifyScanError(new TypeError('Importing a module script failed.'))).toBe('chunk')
    } finally {
      if (online) Object.defineProperty(Navigator.prototype, 'onLine', online)
    }
  })

  it('leaves other TypeErrors alone', () => {
    expect(classifyScanError(new TypeError('x is not a function'))).toBe('generic')
  })
})

describe('classifyScanError: the microphone', () => {
  const capture = (reason: string) => named('SoundCaptureError', { reason })

  it('maps what the capture code says', () => {
    expect(classifyScanError(capture('denied'), 'microphone')).toBe('micDenied')
    expect(classifyScanError(capture('no-device'), 'microphone')).toBe('micMissing')
    expect(classifyScanError(capture('busy'), 'microphone')).toBe('micMissing')
    expect(classifyScanError(capture('interrupted'), 'microphone')).toBe('micMissing')
    expect(classifyScanError(capture('unsupported'), 'microphone')).toBe('unsupported')
    expect(classifyScanError(capture('insecure'), 'microphone')).toBe('unsupported')
    expect(classifyScanError(capture('failed'), 'microphone')).toBe('generic')
    expect(classifyScanError(capture('timeout'), 'microphone')).toBe('generic')
  })

  it('maps what the browser says when it was asked for the microphone', () => {
    expect(classifyScanError(domError('NotAllowedError'), 'microphone')).toBe('micDenied')
    expect(classifyScanError(domError('NotFoundError'), 'microphone')).toBe('micMissing')
    expect(classifyScanError(domError('NotReadableError'), 'microphone')).toBe('micMissing')
  })
})

describe('classifyScanError: the camera', () => {
  it('maps a refusal, a missing camera and a busy camera', () => {
    expect(classifyScanError(domError('NotAllowedError'), 'camera')).toBe('cameraDenied')
    expect(classifyScanError(domError('SecurityError'), 'camera')).toBe('cameraDenied')
    expect(classifyScanError(domError('NotFoundError'), 'camera')).toBe('cameraMissing')
    expect(classifyScanError(domError('OverconstrainedError'), 'camera')).toBe('cameraMissing')
    expect(classifyScanError(domError('NotReadableError'), 'camera')).toBe('cameraBusy')
  })

  it('says "unsupported" when the browser has no camera interface at all', () => {
    expect(classifyScanError(named('NotSupportedError'), 'camera')).toBe('unsupported')
  })

  it('does not take a permission error for the camera when nobody said which device it was', () => {
    expect(classifyScanError(domError('NotAllowedError'))).toBe('generic')
  })
})

describe('classifyScanError: anything else', () => {
  it('falls back to the generic message and never throws', () => {
    expect(classifyScanError(new Error('boom'))).toBe('generic')
    expect(classifyScanError('a string')).toBe('generic')
    expect(classifyScanError(null)).toBe('generic')
    expect(classifyScanError(undefined)).toBe('generic')
  })
})

describe('scanErrorText', () => {
  const KINDS: ScanErrorKind[] = ['micDenied', 'micMissing', 'cameraDenied', 'cameraMissing', 'cameraBusy', 'cameraStalled', 'network', 'chunk', 'storageFull', 'modelDownload', 'modelLoad', 'unsupported', 'generic']

  it('has a Czech sentence for every kind, and none of them is the key itself', () => {
    const seen = new Set<string>()
    for (const kind of KINDS) {
      const text = scanErrorText(kind)
      expect(text.length, kind).toBeGreaterThan(10)
      expect(text, kind).not.toMatch(/^(common|scan)\./)
      expect(text, kind).toMatch(/[.]$/)
      seen.add(text)
    }
    expect(seen.size).toBe(KINDS.length)
  })

  it('names the next step in the texts that need one', () => {
    expect(scanErrorText('network')).toMatch(/Wi-Fi/)
    expect(scanErrorText('modelDownload')).toMatch(/zkus/i)
    expect(scanErrorText('micDenied')).toMatch(/Povol/)
    expect(scanErrorText('cameraDenied')).toMatch(/Povol/)
  })
})

describe('isPermissionError', () => {
  it('is true for a blocked microphone or camera, where the fix is in the settings', () => {
    expect(isPermissionError('micDenied')).toBe(true)
    expect(isPermissionError('cameraDenied')).toBe(true)
    expect(isPermissionError('micMissing')).toBe(false)
    expect(isPermissionError('generic')).toBe(false)
  })
})
