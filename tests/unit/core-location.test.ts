import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getCachedLocation, getCurrentLocation, LOCATION_CACHE_MS, resetLocationForTests } from '../../src/state/location'

type Success = (position: GeolocationPosition) => void
type Failure = (error: GeolocationPositionError) => void

const position = (latitude: number, longitude: number, accuracy = 18.4): GeolocationPosition =>
  ({ coords: { latitude, longitude, accuracy }, timestamp: Date.now() }) as GeolocationPosition
const failure = (code: number): GeolocationPositionError => ({ code, message: `code ${code}` }) as GeolocationPositionError

/** A pretend GPS that answers when the test says so. */
function pretendGps() {
  const requests: { success: Success; failure: Failure; options?: PositionOptions }[] = []
  const getCurrentPosition = vi.fn((success: Success, error: Failure, options?: PositionOptions) => {
    requests.push({ success, failure: error, options })
  })
  vi.stubGlobal('navigator', { geolocation: { getCurrentPosition } })
  return { requests, getCurrentPosition }
}

beforeEach(() => {
  vi.useFakeTimers()
  resetLocationForTests()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('getCurrentLocation', () => {
  it('returns the position with the accuracy in whole metres', async () => {
    const gps = pretendGps()
    const pending = getCurrentLocation({ timeoutMs: 3000 })
    gps.requests[0].success(position(50.0755, 14.4378))
    expect(await pending).toEqual({ lat: 50.0755, lon: 14.4378, accuracyM: 18 })
    expect(gps.requests[0].options).toMatchObject({ enableHighAccuracy: false })
  })

  it('leaves the accuracy out when the browser does not give one', async () => {
    const gps = pretendGps()
    const pending = getCurrentLocation()
    gps.requests[0].success(position(49.2, 16.6, Number.NaN))
    expect(await pending).toEqual({ lat: 49.2, lon: 16.6 })
  })

  it('remembers the fix for 5 minutes and then asks again', async () => {
    const gps = pretendGps()
    const first = getCurrentLocation()
    gps.requests[0].success(position(50, 14))
    await first

    vi.advanceTimersByTime(LOCATION_CACHE_MS - 1000)
    expect(await getCurrentLocation()).toEqual({ lat: 50, lon: 14, accuracyM: 18 })
    expect(gps.getCurrentPosition).toHaveBeenCalledTimes(1)
    expect(getCachedLocation()).toBeDefined()

    vi.advanceTimersByTime(2000)
    expect(getCachedLocation()).toBeUndefined()
    const later = getCurrentLocation()
    expect(gps.getCurrentPosition).toHaveBeenCalledTimes(2)
    gps.requests[1].success(position(51, 15))
    expect(await later).toMatchObject({ lat: 51, lon: 15 })
  })

  it('does not let callers change the remembered fix', async () => {
    const gps = pretendGps()
    const pending = getCurrentLocation()
    gps.requests[0].success(position(50, 14))
    const point = (await pending) as { lat: number }
    point.lat = 0
    expect((await getCurrentLocation())?.lat).toBe(50)
    expect(getCachedLocation()?.lat).toBe(50)
  })

  it('gives up after the time the caller allows, but keeps the fix that arrives later', async () => {
    const gps = pretendGps()
    const pending = getCurrentLocation({ timeoutMs: 2000 })
    vi.advanceTimersByTime(2000)
    expect(await pending).toBeUndefined()

    // The browser answers after the caller left: the next call gets it without asking again.
    gps.requests[0].success(position(50.1, 14.5))
    await vi.advanceTimersByTimeAsync(0)
    expect(await getCurrentLocation()).toMatchObject({ lat: 50.1, lon: 14.5 })
    expect(gps.getCurrentPosition).toHaveBeenCalledTimes(1)
  })

  it('does not wait at all with a timeout of 0, but still asks the browser', async () => {
    const gps = pretendGps()
    const pending = getCurrentLocation({ timeoutMs: 0 })
    await vi.advanceTimersByTimeAsync(0)
    expect(await pending).toBeUndefined()
    expect(gps.getCurrentPosition).toHaveBeenCalledTimes(1)
  })

  it('shares one request between callers who ask while the browser is still thinking', async () => {
    const gps = pretendGps()
    const a = getCurrentLocation({ timeoutMs: 5000 })
    const b = getCurrentLocation({ timeoutMs: 5000 })
    expect(gps.getCurrentPosition).toHaveBeenCalledTimes(1)
    gps.requests[0].success(position(50, 14))
    expect(await a).toMatchObject({ lat: 50 })
    expect(await b).toMatchObject({ lat: 50 })
  })

  it('returns undefined when the user says no, and does not ask again for 5 minutes', async () => {
    const gps = pretendGps()
    const first = getCurrentLocation()
    gps.requests[0].failure(failure(1))
    expect(await first).toBeUndefined()

    expect(await getCurrentLocation()).toBeUndefined()
    expect(gps.getCurrentPosition).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(5 * 60_000 + 1000)
    const again = getCurrentLocation()
    expect(gps.getCurrentPosition).toHaveBeenCalledTimes(2)
    gps.requests[1].success(position(50, 14))
    expect(await again).toMatchObject({ lat: 50 })
  })

  it.each([2, 3])('returns undefined for a failure with code %i, and tries again next time', async (code) => {
    const gps = pretendGps()
    const first = getCurrentLocation()
    gps.requests[0].failure(failure(code))
    expect(await first).toBeUndefined()
    const second = getCurrentLocation()
    expect(gps.getCurrentPosition).toHaveBeenCalledTimes(2)
    gps.requests[1].failure(failure(code))
    expect(await second).toBeUndefined()
  })

  it('answers at once when the browser calls back before returning', async () => {
    const getCurrentPosition = vi.fn((success: Success) => success(position(50.5, 14.5)))
    vi.stubGlobal('navigator', { geolocation: { getCurrentPosition } })
    expect(await getCurrentLocation()).toMatchObject({ lat: 50.5, lon: 14.5 })
    resetLocationForTests()
    expect(await getCurrentLocation()).toMatchObject({ lat: 50.5, lon: 14.5 })
    expect(getCurrentPosition).toHaveBeenCalledTimes(2)
  })

  it('ignores a position without usable numbers', async () => {
    const gps = pretendGps()
    const pending = getCurrentLocation()
    gps.requests[0].success(position(Number.NaN, 14))
    expect(await pending).toBeUndefined()
    expect(getCachedLocation()).toBeUndefined()
  })

  it('never throws: no geolocation, a throwing browser, or no navigator at all', async () => {
    vi.stubGlobal('navigator', {})
    expect(await getCurrentLocation()).toBeUndefined()

    vi.stubGlobal('navigator', {
      geolocation: {
        getCurrentPosition: () => {
          throw new Error('SecurityError')
        },
      },
    })
    expect(await getCurrentLocation()).toBeUndefined()

    vi.stubGlobal('navigator', undefined)
    expect(await getCurrentLocation()).toBeUndefined()
  })

  it('does not leave timers behind', async () => {
    const gps = pretendGps()
    const pending = getCurrentLocation({ timeoutMs: 10_000 })
    gps.requests[0].success(position(50, 14))
    await pending
    expect(vi.getTimerCount()).toBe(0)
  })
})
