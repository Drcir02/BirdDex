import type { ReactNode } from 'react'
import { Icon, type IconName } from './icons'
import { cx } from './logic'
import './Notice.css'

export type NoticeTone = 'info' | 'success' | 'warning' | 'error'

export interface NoticeProps {
  tone?: NoticeTone
  /** A short headline, for example "Mikrofon je zablokovaný". */
  title?: string
  /** The calm explanation. */
  children?: ReactNode
  /** The next step, usually a Button ("Zkusit znovu", "Otevřít nastavení"). */
  action?: ReactNode
  className?: string
}

const TONE_ICON: Record<NoticeTone, IconName> = { info: 'info', success: 'check', warning: 'warning', error: 'warning' }

/** An inline message with a next step. Errors are announced at once, everything else politely. */
export function Notice({ tone = 'info', title, children, action, className }: NoticeProps) {
  return (
    <div className={cx('bd-notice', `bd-notice--${tone}`, className)} role={tone === 'error' ? 'alert' : 'status'}>
      <Icon name={TONE_ICON[tone]} size={26} className="bd-notice__icon" />
      <div className="bd-notice__body">
        {title ? <p className="bd-notice__title">{title}</p> : null}
        {children ? <div className="bd-notice__text">{children}</div> : null}
        {action ? <div className="bd-notice__action">{action}</div> : null}
      </div>
    </div>
  )
}
