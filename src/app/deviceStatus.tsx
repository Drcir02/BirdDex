import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

// What the lights on top of the device say. Screens do not touch the lights directly, they declare what they are doing:
//
//   useDeviceActivity('listening')   // while this component is mounted
//   const { flash } = useDeviceStatus(); flash('success')   // a short celebration, then back to normal
//
// If two screens claim a status at once, the one that claimed last wins.

export type DeviceStatus = 'idle' | 'listening' | 'busy' | 'success' | 'error'

export const DEVICE_STATUSES: readonly DeviceStatus[] = ['idle', 'listening', 'busy', 'success', 'error']

interface Claim {
  id: number
  status: DeviceStatus
}

/** The status to show: a flash beats everything, then the newest claim, then idle. Pure, so it is easy to test. */
export function resolveStatus(claims: readonly Claim[], flashing: DeviceStatus | null): DeviceStatus {
  if (flashing) return flashing
  return claims.at(-1)?.status ?? 'idle'
}

export interface DeviceStatusApi {
  status: DeviceStatus
  /** Shows a status for a moment (default 2.4 s) and then goes back to what it was. A new claim ends it early. */
  flash(status: DeviceStatus, durationMs?: number): void
  /** Used by useDeviceActivity. Returns the function that withdraws the claim. */
  claim(status: DeviceStatus): () => void
}

const IDLE_API: DeviceStatusApi = { status: 'idle', flash: () => undefined, claim: () => () => undefined }

const DeviceStatusContext = createContext<DeviceStatusApi>(IDLE_API)

export function DeviceStatusProvider({ children }: { children: ReactNode }) {
  const [claims, setClaims] = useState<Claim[]>([])
  const [flashing, setFlashing] = useState<DeviceStatus | null>(null)
  const nextId = useRef(1)
  const flashTimer = useRef<number | undefined>(undefined)

  const claim = useCallback((status: DeviceStatus) => {
    const id = nextId.current++
    // Starting something new ends a celebration early, so the lights never show stale news.
    window.clearTimeout(flashTimer.current)
    setFlashing(null)
    setClaims((current) => [...current, { id, status }])
    return () => setClaims((current) => current.filter((item) => item.id !== id))
  }, [])

  const flash = useCallback((status: DeviceStatus, durationMs = 2400) => {
    window.clearTimeout(flashTimer.current)
    setFlashing(status)
    flashTimer.current = window.setTimeout(() => setFlashing(null), durationMs)
  }, [])

  useEffect(() => () => window.clearTimeout(flashTimer.current), [])

  const status = resolveStatus(claims, flashing)
  const api = useMemo<DeviceStatusApi>(() => ({ status, flash, claim }), [status, flash, claim])
  return <DeviceStatusContext.Provider value={api}>{children}</DeviceStatusContext.Provider>
}

/** The current status and `flash`. Works without a provider too (then nothing happens), which keeps screen tests simple. */
export function useDeviceStatus(): DeviceStatusApi {
  return useContext(DeviceStatusContext)
}

/** Declares what the screen is doing for as long as it is mounted. Pass null to say nothing. */
export function useDeviceActivity(status: DeviceStatus | null): void {
  const { claim } = useContext(DeviceStatusContext)
  useEffect(() => {
    if (status === null) return undefined
    return claim(status)
  }, [status, claim])
}
