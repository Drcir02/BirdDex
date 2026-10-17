import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, type ReactNode } from 'react'
import { t } from '../i18n'
import { Icon } from './icons'
import { IconButton } from './IconButton'
import { cx } from './logic'
import { defaultDuration, toastReducer, type ToastItem, type ToastTone } from './toastState'
import './Toast.css'

export interface ToastOptions {
  tone?: ToastTone
  /** Milliseconds on screen; 0 keeps the message until it is closed. */
  durationMs?: number
}

export interface ToastApi {
  /** Shows a message and returns its id. */
  show(message: string, options?: ToastOptions): number
  dismiss(id: number): void
}

const ApiContext = createContext<ToastApi | null>(null)
const ItemsContext = createContext<readonly ToastItem[]>([])

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, dispatch] = useReducer(toastReducer, [])
  const nextId = useRef(1)
  const timers = useRef(new Map<number, number>())

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id)
    if (timer !== undefined) window.clearTimeout(timer)
    timers.current.delete(id)
    dispatch({ type: 'dismiss', id })
  }, [])

  const show = useCallback(
    (message: string, options: ToastOptions = {}) => {
      const id = nextId.current++
      const tone = options.tone ?? 'info'
      const durationMs = options.durationMs ?? defaultDuration(tone)
      dispatch({ type: 'add', toast: { id, message, tone, durationMs } })
      if (durationMs > 0) timers.current.set(id, window.setTimeout(() => dismiss(id), durationMs))
      return id
    },
    [dismiss],
  )

  useEffect(() => {
    const pending = timers.current
    return () => {
      pending.forEach((timer) => window.clearTimeout(timer))
      pending.clear()
    }
  }, [])

  const api = useMemo<ToastApi>(() => ({ show, dismiss }), [show, dismiss])
  return (
    <ApiContext.Provider value={api}>
      <ItemsContext.Provider value={items}>{children}</ItemsContext.Provider>
    </ApiContext.Provider>
  )
}

/** `const toast = useToast(); toast.show('Máš ho!', { tone: 'success' })` */
export function useToast(): ToastApi {
  const api = useContext(ApiContext)
  if (!api) throw new Error('useToast needs a <ToastProvider> above it')
  return api
}

const TONE_ICON = { info: 'info', success: 'check', error: 'warning' } as const

/** Where the messages appear. The shell puts it inside the LCD, above the content. */
export function ToastViewport({ className }: { className?: string }) {
  const items = useContext(ItemsContext)
  const api = useContext(ApiContext)
  return (
    <div className={cx('bd-toasts', className)} aria-live="polite" aria-relevant="additions text">
      {items.map((item) => (
        <div key={item.id} className={cx('bd-toast', `bd-toast--${item.tone}`)} role={item.tone === 'error' ? 'alert' : undefined}>
          <Icon name={TONE_ICON[item.tone]} size={22} />
          <span className="bd-toast__text">{item.message}</span>
          <IconButton variant="ghost" icon="close" size={20} label={t('common.a11y.dismissMessage')} onClick={() => api?.dismiss(item.id)} />
        </div>
      ))}
    </div>
  )
}
