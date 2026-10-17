import type { CSSProperties, ReactNode } from 'react'
import { t } from '../i18n'
import { cx, ringGeometry } from './logic'
import './ProgressRing.css'

export interface ProgressRingProps {
  /** 0 to 1. Leave it out together with `indeterminate` for work of unknown length. */
  value?: number
  indeterminate?: boolean
  /** Outer size in pixels. Default 88. */
  size?: number
  strokeWidth?: number
  /** Shown in the middle, for example "12/412". Keep it short. */
  label?: ReactNode
  /** Accessible name. Default "Průběh". */
  ariaLabel?: string
  /** Any CSS colour for the filled part. */
  color?: string
  className?: string
}

/** A circular progress indicator: the Dex completion, a model download. */
export function ProgressRing({ value = 0, indeterminate = false, size = 88, strokeWidth = 10, label, ariaLabel, color, className }: ProgressRingProps) {
  const { radius, dashOffset, percent } = ringGeometry(size, strokeWidth, value)
  const style = { width: size, height: size, ...(color ? { '--ring-color': color } : {}) } as CSSProperties
  return (
    <div
      className={cx('bd-ring', indeterminate && 'bd-ring--busy', className)}
      style={style}
      role="progressbar"
      aria-label={ariaLabel ?? t('common.a11y.progress')}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={indeterminate ? undefined : percent}
    >
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} aria-hidden="true" focusable="false">
        <circle className="bd-ring__track" cx={size / 2} cy={size / 2} r={radius} strokeWidth={strokeWidth} />
        <circle
          className="bd-ring__value"
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={strokeWidth}
          pathLength={100}
          strokeDasharray={indeterminate ? '25 75' : '100 100'}
          strokeDashoffset={indeterminate ? 0 : dashOffset}
        />
      </svg>
      {label !== undefined && label !== null && (
        <span className="bd-ring__label" style={{ fontSize: Math.max(8, Math.round(size * 0.125)) }}>
          {label}
        </span>
      )}
    </div>
  )
}
