// Errors from the database that screens turn into calm Czech messages.
// Anything else that goes wrong is passed on unchanged: screens show a generic "could not save" for it.

export { isQuotaExceededError } from '../state/storage'

/** The phone has no room left to save this. The message to show: free some space, then try again. */
export class StorageFullError extends Error {
  constructor(message = 'The phone has no room left to save this.', options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'StorageFullError'
  }
}

/** The app's database could not be opened at all, for example in a private window that blocks storage. */
export class DatabaseUnavailableError extends Error {
  constructor(message = 'The database could not be opened.', options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'DatabaseUnavailableError'
  }
}
