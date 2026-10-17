import type { CSSProperties } from 'react'
import { formatPercent, t } from '../i18n'
import { clamp01, cx, litSegments, segmentTone } from './logic'
import './LevelMeter.css'

export interface LevelMeterProps {
  /** Input loudness from 0 to 1. */
  level: number
  /** Number of lights. Default 16. */
  segments?: number
  orientation?: 'horizontal' | 'vertical'
  /** Accessible name. Default "Hlasitost". */
  label?: string
  className?: string
}

/** A row of lights that fill up with the loudness of the microphone. */
export function LevelMeter({ level, segments = 16, orientation = 'horizontal', label, className }: LevelMeterProps) {
  const value = clamp01(level)
  const lit = litSegments(value, segments)
  return (
    <div
      className={cx('bd-meter', orientation === 'vertical' && 'bd-meter--vertical', className)}
      style={{ '--segments': segments } as CSSProperties}
      role="meter"
      aria-label={label ?? t('common.a11y.level')}
      aria-valuemin={0}
      aria-valuemax={1}
      aria-valuenow={Number(value.toFixed(2))}
      aria-valuetext={formatPercent(value)}
    >
      {Array.from({ length: segments }, (_, index) => (
        <i key={index} className={cx('bd-meter__seg', index < lit && 'is-lit')} data-tone={segmentTone(index, segments)} />
      ))}
    </div>
  )
}
