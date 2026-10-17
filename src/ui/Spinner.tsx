import type { CSSProperties } from 'react'
import { t } from '../i18n'
import { cx } from './logic'
import './Spinner.css'

export interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg'
  /** Accessible text. Pass null when the spinner sits next to visible text and is only decoration. */
  label?: string | null
  className?: string
}

/** A ring of eight pixels that turns in steps. With reduced motion it stands still as a fading ring. */
export function Spinner({ size = 'md', label, className }: SpinnerProps) {
  const decorative = label === null
  return (
    <span
      className={cx('bd-spinner', `bd-spinner--${size}`, className)}
      role={decorative ? undefined : 'status'}
      aria-hidden={decorative ? true : undefined}
      aria-label={decorative ? undefined : (label ?? t('common.loading'))}
    >
      <span className="bd-spinner__ring">
        {Array.from({ length: 8 }, (_, index) => (
          <i key={index} style={{ '--i': index } as CSSProperties} />
        ))}
      </span>
    </span>
  )
}
