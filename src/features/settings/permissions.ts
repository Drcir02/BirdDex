// The three permissions BirdDex asks for, requested from the welcome screens: the person reads why first, then taps "Povolit",
// and only then does the browser show its own question.

import { getCurrentLocation } from '../../state/location'

export type PermissionKind = 'microphone' | 'camera' | 'location'

/** What is known about a permission. 'unknown' means the browser cannot say (or the answer was not clear). */
export type PermissionResult = 'granted' | 'denied' | 'unavailable' | 'unknown'

const QUERY_NAME: Record<PermissionKind, string> = { microphone: 'microphone', camera: 'camera', location: 'geolocation' }

/** The state the browser reports, without asking the person anything. Safari cannot report the microphone or camera: 'unknown'. */
export async function queryPermission(kind: PermissionKind): Promise<PermissionResult> {
  try {
    const permissions = typeof navigator === 'undefined' ? undefined : navigator.permissions
    if (!permissions?.query) return 'unknown'
    const status = await permissions.query({ name: QUERY_NAME[kind] as PermissionName })
    if (status.state === 'granted') return 'granted'
    if (status.state === 'denied') return 'denied'
    return 'unknown'
  } catch {
    return 'unknown'
  }
}

function errorName(error: unknown): string {
  return typeof error === 'object' && error !== null && typeof (error as { name?: unknown }).name === 'string' ? (error as { name: string }).name : ''
}

async function askDevice(kind: 'microphone' | 'camera'): Promise<PermissionResult> {
  const devices = typeof navigator === 'undefined' ? undefined : navigator.mediaDevices
  if (!devices?.getUserMedia) return 'unavailable'
  try {
    const stream = await devices.getUserMedia(kind === 'microphone' ? { audio: true } : { video: { facingMode: 'environment' } })
    // Only the permission is wanted: switch the device off again at once.
    for (const track of stream.getTracks()) track.stop()
    return 'granted'
  } catch (error) {
    const name = errorName(error)
    if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') return 'denied'
    if (name === 'NotFoundError' || name === 'OverconstrainedError' || name === 'DevicesNotFoundError') return 'unavailable'
    return 'unknown'
  }
}

/** Asks the browser for a permission (it shows its own question). Never throws. */
export async function requestPermission(kind: PermissionKind): Promise<PermissionResult> {
  if (kind !== 'location') return askDevice(kind)
  if (typeof navigator === 'undefined' || !navigator.geolocation) return 'unavailable'
  const point = await getCurrentLocation({ timeoutMs: 15_000 })
  if (point) return 'granted'
  // No position: either the person said no, or the phone could not tell yet.
  const state = await queryPermission('location')
  return state === 'granted' ? 'granted' : state === 'denied' ? 'denied' : 'unknown'
}
