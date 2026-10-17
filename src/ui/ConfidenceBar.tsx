import type { CSSProperties } from 'react'
import { formatPercent, t } from '../i18n'
import { clamp01, confidenceState, cx } from './logic'
import './ConfidenceBar.css'

export interface ConfidenceBarProps {
  /** Confidence from 0 to 1. */
  value: number
  /** The catch threshold from 0 to 1. A notch marks it, and the bar changes colour once the value reaches it. */
  threshold?: number
  /** Show the percentage next to the bar. Default true. */
  showValue?: boolean
  /** Accessible name. Default "Jistota 85 %". */
  label?: string
  className?: string
}

/** A segmented bar for how sure the guess is, with an optional catch threshold. */
export function ConfidenceBar({ value, threshold, showValue = true, label, className }: ConfidenceBarProps) {
  const fraction = clamp01(value)
  const state = confidenceState(fraction, threshold)
  const style = { '--w': `${fraction * 100}%`, ...(threshold !== undefined ? { '--t': clamp01(threshold) } : {}) } as CSSProperties
  return (
    <div
      className={cx('bd-conf', `bd-conf--${state}`, className)}
      style={style}
      role="meter"
      aria-label={label ?? t('common.a11y.confidence', { value: formatPercent(fraction) })}
      aria-valuemin={0}
      aria-valuemax={1}
      aria-valuenow={Number(fraction.toFixed(2))}
      aria-valuetext={formatPercent(fraction)}
    >
      <div className="bd-conf__track">
        <div className="bd-conf__fill" />
        {threshold !== undefined && <span className="bd-conf__mark" aria-hidden="true" />}
      </div>
      {showValue && <span className="bd-conf__value">{formatPercent(fraction)}</span>}
    </div>
  )
}
