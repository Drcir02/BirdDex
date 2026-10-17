// The list of messages on screen, as a plain reducer so the rules are easy to test.

export type ToastTone = 'info' | 'success' | 'error'

export interface ToastItem {
  id: number
  message: string
  tone: ToastTone
  /** How long it stays in milliseconds. 0 keeps it until the user closes it. */
  durationMs: number
}

export type ToastAction = { type: 'add'; toast: ToastItem } | { type: 'dismiss'; id: number } | { type: 'clear' }

/** At most this many messages at once; the oldest goes first. */
export const MAX_TOASTS = 3

export function defaultDuration(tone: ToastTone): number {
  return tone === 'error' ? 6500 : tone === 'success' ? 3500 : 4500
}

export function toastReducer(state: readonly ToastItem[], action: ToastAction): ToastItem[] {
  switch (action.type) {
    case 'add': {
      // The same message twice in a row is shown once, as the newest.
      const others = state.filter((item) => !(item.message === action.toast.message && item.tone === action.toast.tone))
      return [...others, action.toast].slice(-MAX_TOASTS)
    }
    case 'dismiss':
      return state.filter((item) => item.id !== action.id)
    case 'clear':
      return []
  }
}
