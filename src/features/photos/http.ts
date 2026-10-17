// Asking a web service for JSON, patiently: a few tries with growing pauses for problems that usually pass by themselves
// (no connection for a moment, a busy server, "too many requests"), and no retry for answers that will not change (404).

import { PhotoLookupError } from './types'

/** The server answered, but not with success. */
export class HttpStatusError extends Error {
  readonly status: number
  constructor(status: number, url: string) {
    super(`${url} answered ${status}`)
    this.name = 'HttpStatusError'
    this.status = status
  }
}

export interface FetchJsonOptions {
  fetchImpl?: typeof fetch
  /** Tries after the first one. Default 2, so three attempts in all. */
  retries?: number
  /** Pause before the first retry; it doubles each time. Default 700 ms. */
  baseDelayMs?: number
  /** No pause is ever longer than this. Default 8 s. */
  maxDelayMs?: number
  /** A request that has not delivered its whole answer by then is given up (and tried again). Default 12 s. */
  timeoutMs?: number
  sleep?: (ms: number) => Promise<void>
  /** 0 to 1; makes the pauses a bit different from phone to phone. Default Math.random. */
  random?: () => number
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** 408 (timeout), 425, 429 (too many requests) and every 5xx may be fine a moment later. */
export function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500
}

/** The pause a server asks for with `Retry-After` (seconds, or a date), in milliseconds. */
export function retryAfterMs(header: string | null, now = Date.now()): number | undefined {
  if (!header) return undefined
  const seconds = Number(header)
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000
  const date = Date.parse(header)
  return Number.isFinite(date) ? Math.max(0, date - now) : undefined
}

/** Fetches `url` and returns the parsed JSON. Throws HttpStatusError for a final bad status, PhotoLookupError for a lost connection. */
export async function fetchJson(url: string, options: FetchJsonOptions = {}): Promise<unknown> {
  const fetchImpl = options.fetchImpl ?? fetch
  const retries = options.retries ?? 2
  const base = options.baseDelayMs ?? 700
  const cap = options.maxDelayMs ?? 8000
  const timeoutMs = options.timeoutMs ?? 12_000
  const sleep = options.sleep ?? defaultSleep
  const random = options.random ?? Math.random

  for (let attempt = 0; ; attempt += 1) {
    let pause: number | undefined
    let failure: Error
    // A phone on a bad connection can wait for ever; one stuck request must not keep one of the few places in the queue.
    const timeout = new AbortController()
    const timer = setTimeout(() => timeout.abort(), timeoutMs)
    try {
      const response = await fetchImpl(url, { signal: timeout.signal })
      if (response.ok) {
        let body: unknown
        try {
          body = (await response.json()) as unknown
        } catch (error) {
          if (timeout.signal.aborted) throw error
          throw new PhotoLookupError('bad-response', 'The answer was not JSON', { cause: error })
        }
        return body
      }
      if (!isRetryableStatus(response.status)) throw new HttpStatusError(response.status, url)
      failure = new HttpStatusError(response.status, url)
      pause = retryAfterMs(response.headers.get('Retry-After'))
    } catch (error) {
      if (error instanceof HttpStatusError || error instanceof PhotoLookupError) throw error
      // fetch() rejects with a TypeError when the connection fails, and with an AbortError after the timeout.
      failure = error instanceof Error ? error : new Error(String(error))
    } finally {
      clearTimeout(timer)
    }

    if (attempt >= retries) {
      if (failure instanceof HttpStatusError) throw failure
      throw new PhotoLookupError('network', 'The connection failed', { cause: failure })
    }
    const growing = base * 2 ** attempt * (0.75 + random() * 0.5)
    await sleep(Math.min(cap, pause ?? growing))
  }
}
