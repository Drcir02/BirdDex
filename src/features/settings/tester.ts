// The phone test page (/field-check) is for the people who test the app, not for the person who receives it, so its
// link in the settings is hidden until the version line is tapped seven times. The choice is remembered on the phone.

export const TESTER_KEY = 'birddex:tester'
export const TESTER_TAPS = 7

export function isTesterMode(): boolean {
  try {
    return window.localStorage.getItem(TESTER_KEY) === '1'
  } catch {
    return false
  }
}

export function enableTesterMode(): void {
  try {
    window.localStorage.setItem(TESTER_KEY, '1')
  } catch {
    // The link then only shows until the screen is closed.
  }
}

/** Counts a tap on the version line. Returns the new count, and true when that was the seventh tap. */
export function countVersionTap(taps: number): { taps: number; unlocked: boolean } {
  const next = taps + 1
  return next >= TESTER_TAPS ? { taps: 0, unlocked: true } : { taps: next, unlocked: false }
}
