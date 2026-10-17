import type { Status } from '../types'

/** Asks for the current position once. Coordinates are rounded to about 1 km before they are shown. */
export function runLocationCheck(log: (line: string) => void): Promise<Status> {
  return new Promise((resolve) => {
    if (!('geolocation' in navigator)) {
      log('Geolocation is not available in this browser.')
      resolve('fail')
      return
    }
    const started = performance.now()
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude, accuracy } = position.coords
        log(
          `Position found in ${Math.round(performance.now() - started)} ms: ${latitude.toFixed(2)}, ${longitude.toFixed(2)} ` +
            `(rounded to about 1 km), accuracy ${Math.round(accuracy)} m`,
        )
        resolve(accuracy > 500 ? 'warn' : 'pass')
      },
      (error) => {
        log(`No position: ${error.message} (code ${error.code}: 1 = permission denied, 2 = unavailable, 3 = timeout)`)
        // The app still works without a location, but catches would have no place saved.
        resolve(error.code === 1 ? 'warn' : 'fail')
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    )
  })
}
