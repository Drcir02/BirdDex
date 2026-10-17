// Small pure helpers behind the UI components, kept apart so they are easy to test.

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}

// ---------- ProgressRing ----------

export interface RingGeometry {
  /** Radius of the circle, so the stroke stays inside the square. */
  radius: number
  /** The circle is drawn with pathLength 100, so this is how much of the 100 stays empty. */
  dashOffset: number
  /** Whole percent, 0 to 100. */
  percent: number
}

export function ringGeometry(size: number, strokeWidth: number, value: number): RingGeometry {
  const clamped = clamp01(value)
  return {
    radius: Math.max(0, (size - strokeWidth) / 2),
    dashOffset: 100 - clamped * 100,
    percent: Math.round(clamped * 100),
  }
}

// ---------- LevelMeter ----------

/** How many of `count` segments are lit for a level from 0 to 1. Any sound at all lights the first one. */
export function litSegments(level: number, count: number): number {
  const clamped = clamp01(level)
  if (clamped === 0) return 0
  return Math.max(1, Math.round(clamped * count))
}

export type SegmentTone = 'low' | 'mid' | 'high'

/** Green for the first 60 percent of the meter, yellow up to 85 percent, red above. */
export function segmentTone(index: number, count: number): SegmentTone {
  const position = (index + 1) / count
  if (position <= 0.6) return 'low'
  if (position <= 0.85) return 'mid'
  return 'high'
}

// ---------- ConfidenceBar ----------

export type ConfidenceState = 'neutral' | 'below' | 'met'

/** Without a threshold the bar is neutral. With one it says whether the guess is sure enough to catch. */
export function confidenceState(value: number, threshold?: number): ConfidenceState {
  if (threshold === undefined) return 'neutral'
  return clamp01(value) >= threshold ? 'met' : 'below'
}

// ---------- Focus trap ----------

/**
 * Where Tab (or Shift+Tab) should move inside a dialog, wrapping around at both ends.
 * `current` is the index of the focused element, or -1 when focus is outside the list.
 */
export function nextFocusIndex(count: number, current: number, backwards: boolean): number {
  if (count <= 0) return -1
  if (current < 0 || current >= count) return backwards ? count - 1 : 0
  if (backwards) return current === 0 ? count - 1 : current - 1
  return current === count - 1 ? 0 : current + 1
}

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** Elements inside `root` that the keyboard can reach, in DOM order. */
export function focusableWithin(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((element) => !element.hasAttribute('hidden') && element.getAttribute('aria-hidden') !== 'true')
}

// ---------- SegmentedControl ----------

/**
 * Which option an arrow key selects in a radio group (the ARIA pattern): right and down go on, left and up go back,
 * both wrapping around; Home and End jump to the ends. Returns null for any other key.
 */
export function nextOptionIndex(count: number, current: number, key: string): number | null {
  if (count <= 0) return null
  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown':
      return (current + 1) % count
    case 'ArrowLeft':
    case 'ArrowUp':
      return (current - 1 + count) % count
    case 'Home':
      return 0
    case 'End':
      return count - 1
    default:
      return null
  }
}
