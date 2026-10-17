import type { CSSProperties } from 'react'
import type { Rarity } from '../../domain/types'
import { t } from '../../i18n'

export interface CatchCelebrationProps {
  rarity: Rarity
  /** A species that was not in the Dex before gets the bigger show. */
  isNew: boolean
}

const SPARKS = 14

/**
 * PLACEHOLDER for the celebration after a catch: a ring of pixel sparks flying out, tinted by the rarity of the bird.
 * The polish task (src/features/fun) replaces this component with the real animation; the result screen only passes
 * the rarity and whether the species is new, so nothing else has to change. Decorative: hidden from screen readers
 * (the success sentence next to it says what happened), and still when the person asked for less motion.
 */
export function CatchCelebration({ rarity, isNew }: CatchCelebrationProps) {
  return (
    <div className="bd-celebrate" data-rarity={rarity} data-new={isNew ? 'true' : 'false'} data-testid="celebration" aria-hidden="true" title={t('result.success.celebration')}>
      {Array.from({ length: SPARKS }, (_, index) => (
        <i key={index} style={{ '--a': `${(360 / SPARKS) * index}deg`, '--d': `${index % 2 === 0 ? 74 : 56}px` } as CSSProperties} />
      ))}
    </div>
  )
}
