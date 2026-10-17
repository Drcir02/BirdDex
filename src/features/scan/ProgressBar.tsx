import type { CSSProperties } from 'react'
import { formatPercent } from '../../i18n'
import { clamp01, cx } from '../../ui'

export interface ProgressBarProps {
  /** 0 to 1. Ignored when `busy`. */
  value: number
  /** Work of unknown length: the bar moves by itself. */
  busy?: boolean
  /** Accessible name. */
  label: string
  /** Show the percentage next to the bar. */
  showValue?: boolean
  className?: string
}

/** A pixel-block progress bar (the same blocks as the confidence bar), for downloads. */
export function ProgressBar({ value, busy = false, label, showValue = true, className }: ProgressBarProps) {
  const fraction = clamp01(value)
  return (
    <div className={cx('bd-scan-progress', busy && 'bd-scan-progress--busy', className)}>
      <div
        className="bd-scan-bar"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={busy ? undefined : Math.round(fraction * 100)}
        style={{ '--w': `${busy ? 100 : fraction * 100}%` } as CSSProperties}
      >
        <div className="bd-scan-bar__fill" />
      </div>
      {showValue && !busy ? <span className="bd-scan-progress__value">{formatPercent(fraction)}</span> : null}
    </div>
  )
}
