import { useId, type HTMLAttributes, type ReactNode } from 'react'
import { cx } from './logic'
import './LcdPanel.css'

export interface LcdPanelProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  /** A heading bar across the top of the panel. */
  title?: ReactNode
  /** Heading level of the title, so the page outline stays right. Default 2. */
  titleLevel?: 2 | 3
  /** light is a pale window on the screen, dark is the inverted display. */
  tone?: 'light' | 'dark'
}

/** A window on the LCD: a framed panel for a group of related content. */
export function LcdPanel({ title, titleLevel = 2, tone = 'light', className, children, ...rest }: LcdPanelProps) {
  const titleId = useId()
  const Heading = titleLevel === 2 ? 'h2' : 'h3'
  return (
    <section className={cx('bd-lcdpanel', tone === 'dark' && 'bd-lcdpanel--dark', className)} aria-labelledby={title ? titleId : undefined} {...rest}>
      {title ? (
        <Heading id={titleId} className="bd-lcdpanel__title">
          {title}
        </Heading>
      ) : null}
      {children}
    </section>
  )
}
