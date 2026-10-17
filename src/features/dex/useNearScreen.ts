// "Is this element close to the part of the screen that is visible?" The Dex has hundreds of cards, and only the ones near
// the screen should fetch pictures. One IntersectionObserver is shared by all cards. The screen of the app scrolls inside
// the green LCD (not the window), so the observer watches that scroll box and its margin reaches beyond it.

import { useEffect, useState, type RefObject } from 'react'

type Listener = () => void

interface SharedObserver {
  observe(element: Element, listener: Listener): () => void
}

const observers = new Map<Element | null, Map<string, SharedObserver>>()

function sharedObserver(root: Element | null, margin: string): SharedObserver {
  let byMargin = observers.get(root)
  if (!byMargin) {
    byMargin = new Map()
    observers.set(root, byMargin)
  }
  let shared = byMargin.get(margin)
  if (!shared) {
    const listeners = new Map<Element, Listener>()
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          const listener = listeners.get(entry.target)
          observer.unobserve(entry.target)
          listeners.delete(entry.target)
          listener?.()
        }
      },
      { root, rootMargin: margin },
    )
    shared = {
      observe(element, listener) {
        listeners.set(element, listener)
        observer.observe(element)
        return () => {
          listeners.delete(element)
          observer.unobserve(element)
        }
      },
    }
    byMargin.set(margin, shared)
  }
  return shared
}

/** The scrolling box around an element: the LCD of the device, or the page itself when there is none. */
export function scrollRootOf(element: Element): Element | null {
  return element.closest('.bd-lcd')
}

/**
 * True once the element has come within `margin` of the visible part of its scroll box, and stays true after that.
 * Where IntersectionObserver does not exist (old browsers, unit tests) every element counts as near, so nothing is held back.
 */
export function useNearScreen(ref: RefObject<Element | null>, margin = '500px 0px'): boolean {
  const [near, setNear] = useState(() => typeof IntersectionObserver === 'undefined')

  useEffect(() => {
    if (near) return undefined
    const element = ref.current
    if (!element) return undefined
    return sharedObserver(scrollRootOf(element), margin).observe(element, () => setNear(true))
  }, [near, ref, margin])

  return near
}
