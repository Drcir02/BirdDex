import { useEffect, useState } from 'react'

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now())

/** The current time (performance.now() milliseconds), refreshed every `intervalMs` while `active`. For clocks on screen. */
export function useTicker(active: boolean, intervalMs = 250): number {
  const [time, setTime] = useState(now)
  useEffect(() => {
    if (!active) return undefined
    setTime(now())
    const timer = setInterval(() => setTime(now()), intervalMs)
    return () => clearInterval(timer)
  }, [active, intervalMs])
  return time
}
