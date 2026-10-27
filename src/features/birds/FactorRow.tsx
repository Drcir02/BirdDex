import type { BpFactors } from '../../domain/birdPoints'
import { formatPercent, t } from '../../i18n'
import './birds.css'

/** One of the five scores a BP is made of: its name, a meter, the percentage and a line on what it means. */
export function FactorRow({ factorKey, factors }: { factorKey: keyof BpFactors; factors: BpFactors }) {
  const value = factors[factorKey]
  return (
    <li className="bd-factor" data-testid={`factor-${factorKey}`}>
      <span className="bd-factor__name">{t(`birds.bp.factor.${factorKey}` as const)}</span>
      <div
        className="bd-factor__bar"
        role="meter"
        aria-label={t(`birds.bp.factor.${factorKey}` as const)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(value * 100)}
        aria-describedby={undefined}
      >
        <i style={{ width: `${Math.round(value * 100)}%` }} />
      </div>
      <span className="bd-factor__value">{formatPercent(value)}</span>
      <span className="bd-factor__hint">{t(`birds.bp.factorHint.${factorKey}` as const)}</span>
    </li>
  )
}
