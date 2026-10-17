import { useEffect, useMemo, useRef, type CSSProperties } from 'react'
import type { Rarity } from '../../domain/types'
import { planCelebration } from './confetti'
import { NewBadge } from './NewBadge'
import { playSound as defaultPlaySound, type PlaySound } from './sounds'
import { usePrefersReducedMotion } from './useReducedMotion'
import './fun.css'

export interface CatchCelebrationProps {
  rarity: Rarity
  /** The species was not in the Dex before: a bigger burst and the NOVÝ stamp. */
  isNew?: boolean
  /** Plays the jingle. Defaults to the app's own player, which respects the "Zvukové efekty" setting. */
  playSound?: PlaySound
}

const FOUR_POINT_STAR = 'M12 0 C12.8 8 16 11.2 24 12 C16 12.8 12.8 16 12 24 C11.2 16 8 12.8 0 12 C8 11.2 11.2 8 12 0Z'

/**
 * The show after a catch: confetti and sparkles in the colour of the bird's rarity (more of them for rarer birds, a golden
 * flash for a legendary one), the catch jingle, and a NOVÝ stamp for a new species. It sits at the middle of its parent
 * (a box with `position: relative`) and does not catch taps. With reduced motion there is no flying confetti, only the stamp.
 * Decorative: hidden from screen readers, because the success sentence next to it says what happened.
 */
export function CatchCelebration({ rarity, isNew = false, playSound = defaultPlaySound }: CatchCelebrationProps) {
  const reduced = usePrefersReducedMotion()
  const plan = useMemo(() => planCelebration(rarity, isNew), [rarity, isNew])

  // One jingle per celebration, even when React runs the effect twice in development.
  const played = useRef(false)
  const playRef = useRef(playSound)
  playRef.current = playSound
  useEffect(() => {
    if (played.current) return
    played.current = true
    playRef.current('catch', rarity)
  }, [rarity])

  return (
    <div
      className="bd-fun-celebrate"
      data-testid="celebration"
      data-rarity={rarity}
      data-new={isNew ? 'true' : 'false'}
      data-motion={reduced ? 'reduced' : 'full'}
      aria-hidden="true"
    >
      {!reduced ? (
        <>
          {plan.flash ? (
            <>
              <span className="bd-fun-flash" data-testid="celebration-flash" />
              <svg className="bd-fun-rays" viewBox="-100 -100 200 200" focusable="false">
                {Array.from({ length: 12 }, (_, index) => (
                  <path key={index} d="M-5 -30 L0 -98 L5 -30Z" transform={`rotate(${index * 30})`} />
                ))}
              </svg>
            </>
          ) : null}
          {plan.ring ? <span className="bd-fun-ring" /> : null}
          {plan.pieces.map((piece, index) => (
            <i
              key={index}
              className={`bd-fun-piece bd-fun-piece--${piece.shape}`}
              style={
                {
                  '--a': `${piece.angle}deg`,
                  '--d': `${piece.distance}px`,
                  '--s': `${piece.size}px`,
                  '--delay': `${piece.delay}s`,
                  '--dur': `${piece.duration}s`,
                  '--spin': `${piece.spin}deg`,
                  '--c': plan.palette[piece.colour],
                } as CSSProperties
              }
            />
          ))}
          {plan.sparkles.map((sparkle, index) => (
            <svg
              key={index}
              className="bd-fun-sparkle"
              viewBox="0 0 24 24"
              focusable="false"
              style={{ '--x': `${sparkle.x}px`, '--y': `${sparkle.y}px`, '--s': `${sparkle.size}px`, '--delay': `${sparkle.delay}s` } as CSSProperties}
            >
              <path d={FOUR_POINT_STAR} />
            </svg>
          ))}
        </>
      ) : null}
      {isNew ? <NewBadge /> : null}
    </div>
  )
}
