import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react'
import { useLocation, useNavigationType } from 'react-router-dom'
import { t } from '../i18n'
import { APP_NAME } from './constants'
import { isSettingsPath, sectionOf } from './routes'

/** "Dex · BirdDex" in the tab title and the app switcher. */
export function useDocumentTitle(): void {
  const { pathname } = useLocation()
  useEffect(() => {
    const section = sectionOf(pathname) ?? (isSettingsPath(pathname) ? 'settings' : null)
    document.title = section ? `${t(`common.nav.${section}` as const)} · ${APP_NAME}` : APP_NAME
  }, [pathname])
}

/**
 * The screen scrolls inside the LCD, not the window, so the browser cannot restore the scroll position by itself.
 * A new screen starts at the top; going back (the browser's back button) returns to where the list was left.
 */
export function useScrollMemory(scroller: RefObject<HTMLElement | null>): void {
  const { key, pathname } = useLocation()
  const navigationType = useNavigationType()
  const positions = useRef(new Map<string, number>())
  const currentKey = useRef(key)
  const previousPath = useRef<string | null>(null)

  useEffect(() => {
    const element = scroller.current
    if (!element) return undefined
    const remember = () => positions.current.set(currentKey.current, element.scrollTop)
    element.addEventListener('scroll', remember, { passive: true })
    return () => element.removeEventListener('scroll', remember)
  }, [scroller])

  useLayoutEffect(() => {
    currentKey.current = key
    const element = scroller.current
    const samePath = previousPath.current === pathname
    previousPath.current = pathname
    if (!element) return undefined
    // Only the query part changed (a filter, a search): keep the place.
    if (samePath && navigationType !== 'POP') return undefined
    const target = navigationType === 'POP' ? (positions.current.get(key) ?? 0) : 0
    element.scrollTop = target
    if (target === 0) return undefined
    // The screen may still be filling with content, so try again for a moment.
    let frames = 0
    let handle = 0
    const retry = () => {
      element.scrollTop = target
      if (Math.abs(element.scrollTop - target) > 1 && frames++ < 90) handle = requestAnimationFrame(retry)
    }
    handle = requestAnimationFrame(retry)
    return () => cancelAnimationFrame(handle)
  }, [key, pathname, navigationType, scroller])
}
