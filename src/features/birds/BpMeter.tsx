import type { CSSProperties } from 'react'
import type { BpRange } from '../../domain/birdPoints'
import { t } from '../../i18n'
import './birds.css'

export interface BpMeterProps {
  bp: number
  /** The least and the most BP of the species: the bar runs between them. */
  range: BpRange
  /** Where the quality alone put the bird, before luck. With it the line "Základ 619, štěstí +65" is shown. */
  base?: number
  /** Without the bar and the numbers around it: just the BP, for a small place. */
  compact?: boolean
}

const signed = (value: number): string => (value >= 0 ? `+${value}` : `−${Math.abs(value)}`)

/** The BP big, and a bar from the least to the most BP of the species with a marker where this bird landed. */
export function BpMeter({ bp, range, base, compact = false }: BpMeterProps) {
  const [min, max] = range
  const share = max > min ? Math.min(1, Math.max(0, (bp - min) / (max - min))) : 0
  return (
    <div className={compact ? 'bd-bp bd-bp--compact' : 'bd-bp'} data-testid="bp">
      <p className="bd-bp__number">
        <span className="bd-bp__label">{t('birds.bp.label')}</span> <strong data-testid="bp-value">{bp}</strong>
      </p>
      {compact ? null : (
        <>
          <div
            className="bd-bp__bar"
            role="meter"
            aria-label={t('birds.bp.meterLabel', { bp, min, max })}
            aria-valuemin={min}
            aria-valuemax={max}
            aria-valuenow={bp}
            data-testid="bp-bar"
          >
            <div className="bd-bp__fill" style={{ '--w': `${share * 100}%` } as CSSProperties} />
            <div className="bd-bp__marker" style={{ '--x': `${share * 100}%` } as CSSProperties} />
          </div>
          <div className="bd-bp__ends" aria-hidden="true">
            <span>{min}</span>
            <span>{max}</span>
          </div>
          {base !== undefined ? (
            <p className="bd-bp__detail" data-testid="bp-detail">
              {t('birds.bp.startLuck', { base, luck: signed(bp - base) })}
            </p>
          ) : null}
        </>
      )}
    </div>
  )
}
