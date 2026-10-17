// Where the phone is, for the scan screens (the place that is saved with a catch, and the bird-sound location filter).
// src/state/location.ts does the work; these helpers say when to ask.
//
// The first call to the browser is what makes it show its "allow location?" question, so a scan asks when it begins: right
// after the microphone or the camera was allowed (so the two questions never compete), or when a photo is chosen.
// The answer is awaited only when the scan is over (locationForCatch), and only for a moment: a catch without a place is
// better than a screen that waits for a question nobody answers.

import type { GeoPoint } from '../../domain/types'
import { getCachedLocation, getCurrentLocation } from '../../state/location'

/** Starts asking for the position without waiting for the answer. Safe inside a tap: it returns at once. */
export function warmLocation(): void {
  void getCurrentLocation({ timeoutMs: 0 })
}

/**
 * When a scan screen opens: if the person has already allowed the location, fetch it quietly now (no question is shown), so
 * that the scan can use it from its first second. Without that permission nothing happens until the scan itself asks.
 */
export async function warmLocationIfAllowed(): Promise<void> {
  try {
    const permission = await navigator.permissions?.query({ name: 'geolocation' })
    if (permission?.state === 'granted') warmLocation()
  } catch {
    // A browser that cannot tell: the scan asks when it begins.
  }
}

/** The position known right now, if any, without asking. */
export function knownLocation(): GeoPoint | undefined {
  return getCachedLocation()
}

/** The position for the catch: the one already known, or whatever arrives within `timeoutMs`. Never throws. */
export async function locationForCatch(timeoutMs = 2500): Promise<GeoPoint | undefined> {
  return (await getCurrentLocation({ timeoutMs })) ?? undefined
}
