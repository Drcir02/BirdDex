// Errors from the model store. Screens catch these and show a calm Czech message with a next step:
//   ModelDownloadError     could not get the file (no network, server problem, connection dropped): "try again on Wi-Fi"
//   ModelChecksumError     the file arrived but is not the right one (damaged, or an old version on the server)
//   ModelStorageFullError  the phone has no room to keep the models: "free some space"
// The messages here are for developers and logs, not for the user.

export class ModelStoreError extends Error {
  /** The model file the problem is about, when there is one. */
  readonly fileId?: string

  constructor(message: string, options: { fileId?: string; cause?: unknown } = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'ModelStoreError'
    this.fileId = options.fileId
  }
}

export type ModelDownloadReason =
  /** The phone says it has no network. */
  | 'offline'
  /** The request failed on the way: no connection, a dropped Wi-Fi, a stalled download. */
  | 'network'
  /** The server answered with an error code (see `status`). */
  | 'http'
  /** The connection ended before the whole file had arrived, even after retries. */
  | 'incomplete'
  /** The list of models (manifest.json) is missing or unreadable, for example because this build has no models. */
  | 'manifest'
  /** Somebody asked for a model file that the list does not have. A bug, not a user problem. */
  | 'unknown-file'

export class ModelDownloadError extends ModelStoreError {
  readonly reason: ModelDownloadReason
  /** HTTP status, for reason 'http'. */
  readonly status?: number

  constructor(message: string, options: { reason: ModelDownloadReason; fileId?: string; status?: number; cause?: unknown }) {
    super(message, options)
    this.name = 'ModelDownloadError'
    this.reason = options.reason
    this.status = options.status
  }
}

export class ModelChecksumError extends ModelStoreError {
  readonly expected: string
  /** The checksum of what arrived, or a short description when the file had the wrong size. */
  readonly actual: string

  constructor(message: string, options: { expected: string; actual: string; fileId?: string }) {
    super(message, options)
    this.name = 'ModelChecksumError'
    this.expected = options.expected
    this.actual = options.actual
  }
}

export class ModelStorageFullError extends ModelStoreError {
  /** How much room was needed, in bytes, when known. */
  readonly neededBytes?: number
  /** How much room the browser says is left, in bytes, when known. */
  readonly availableBytes?: number

  constructor(message: string, options: { fileId?: string; neededBytes?: number; availableBytes?: number; cause?: unknown } = {}) {
    super(message, options)
    this.name = 'ModelStorageFullError'
    this.neededBytes = options.neededBytes
    this.availableBytes = options.availableBytes
  }
}
