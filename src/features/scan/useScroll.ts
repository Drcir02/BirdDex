// Small scrolling helpers for the screens, which live in a scrolling LCD (the shell's `.bd-lcd`), not in the window.

import { useEffect, useLayoutEffect, type RefObject } from 'react'

/** The nearest ancestor that scrolls (the LCD of the device), found by what it does and not by what it is called. */
function scrollParent(element: HTMLElement | null): HTMLElement | null {
  for (let node = element?.parentElement ?? null; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node)
    if (overflowY === 'auto' || overflowY === 'scroll') return node
  }
  return null
}

/**
 * A screen that changes its content without changing its address (the result screen turns into the success screen)
 * keeps the scroll position of the old content. This brings the scrolling area around `marker` back to the top, once,
 * when the component that owns `marker` appears. `marker` is any element inside the screen.
 */
export function useScrollToTopOnMount(marker: RefObject<HTMLElement | null>): void {
  useLayoutEffect(() => {
    const scroller = scrollParent(marker.current)
    if (scroller) scroller.scrollTop = 0
  }, [marker])
}

/**
 * Brings `target` into view whenever `when` turns on: a message that appears away from the thing the person just pressed
 * (the question was asked far down the screen, the message sits above it) would otherwise leave nothing to be seen.
 */
export function useScrollIntoViewWhen(target: RefObject<HTMLElement | null>, when: boolean): void {
  useEffect(() => {
    if (when) target.current?.scrollIntoView?.({ block: 'nearest' })
  }, [target, when])
}
