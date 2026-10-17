import type { Rarity } from '../../domain/types'
import { t } from '../../i18n'
import { cx } from '../../ui/logic'
import { starsFor } from './format'
import './RarityStars.css'

// One star on a 12 x 12 grid. The five stars are one picture, which keeps the many cards of the Dex light.
const STAR = 'M6 .9l1.55 3.4 3.7.4-2.75 2.5.8 3.65L6 8.9 2.7 10.85l.8-3.65L.75 4.7l3.7-.4z'
const STAR_PITCH = 12.4

export interface RarityStarsProps {
  rarity: Rarity
  /** Pixel size of one star. Default 12. */
  size?: number
  className?: string
}

/** One filled star for a common bird up to five for a legendary one, in the colour of the rarity. */
export function RarityStars({ rarity, size = 12, className }: RarityStarsProps) {
  const filled = starsFor(rarity)
  const name = t(`common.rarity.${rarity}` as const)
  return (
    <svg
      className={cx('bd-stars', className)}
      data-rarity={rarity}
      viewBox="0 0 62 12"
      width={(size * 62) / 12}
      height={size}
      role="img"
      aria-label={t('dex.rarityAria', { rarity: name })}
      focusable="false"
    >
      {Array.from({ length: 5 }, (_, index) => (
        <path key={index} className={cx('bd-stars__star', index < filled && 'is-on')} transform={`translate(${index * STAR_PITCH} 0)`} d={STAR} />
      ))}
    </svg>
  )
}
