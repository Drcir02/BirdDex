import { useId, useState } from 'react'
import type { Species } from '../../domain/types'
import { t } from '../../i18n'
import { Icon } from '../../ui/icons'
import { MONTH_KEYS, countriesText, monthLevels, nowLevel, seasonText, shyLabel, tipText } from './findingInfo'
import './finding.css'

export interface FindingInfoProps {
  species: Species
  /** The bird is already caught: the heading then speaks of meeting it again, and the block starts folded (the heading unfolds it). */
  caught: boolean
  /** Today, so the strip can mark this month. A test passes a fixed day. */
  now?: Date
}

/**
 * "When and where to find it": the months of the year as a strip, the place, how shy the bird is, the time of day, and for a
 * bird that does not live in Czechia the countries where it does. The group tip comes last. Nothing when the Dex file has no
 * `info` for the bird (an old copy kept for offline use). For a bird that is caught it starts folded, so it does not take up
 * the screen; a bird that is not caught shows it open, because finding it is the point there.
 */
export function FindingInfo({ species, caught, now = new Date() }: FindingInfoProps) {
  const [open, setOpen] = useState(!caught)
  const bodyId = useId()
  const info = species.info
  if (!info) return null
  const levels = monthLevels(info.months)
  const season = seasonText(info.months)
  const today = now.getMonth()
  const nowSentence = (['nowNone', 'nowFew', 'nowBest'] as const)[nowLevel(info.months, now)]
  const countries = species.inCzechia ? '' : countriesText(info.countries)
  const tip = tipText(info)
  return (
    <section className="bd-find" data-testid="finding-info" aria-label={t(caught ? 'dex.info.titleCaught' : 'dex.info.title')}>
      {caught ? (
        <h3 className="bd-find__title bd-find__title--toggle">
          <button type="button" className="bd-find__toggle" aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen((was) => !was)} data-testid="finding-toggle">
            <span>{t('dex.info.titleCaught')}</span>
            <Icon name="chevron" size={18} className="bd-find__chevron" />
          </button>
        </h3>
      ) : (
        <h3 className="bd-find__title">{t('dex.info.title')}</h3>
      )}

      <div id={bodyId} className="bd-find__body" hidden={!open}>
        <div className="bd-find__row">
          <span className="bd-find__label">{t(species.inCzechia ? 'dex.info.when' : 'dex.info.whenEurope')}</span>
          <div className="bd-find__value">
            <div className="bd-find__months" role="img" aria-label={t('dex.info.monthsLabel', { season })} data-testid="finding-months">
              {levels.map((level, index) => (
                <span key={MONTH_KEYS[index]} className="bd-find__month" data-level={level} data-now={index === today ? 'true' : undefined} aria-hidden="true">
                  <span className="bd-find__bar" />
                  <span className="bd-find__letter">{t(`dex.info.monthLetter.${MONTH_KEYS[index]}` as const)}</span>
                </span>
              ))}
            </div>
            <p className="bd-find__season" data-testid="finding-season">
              <strong>{season.charAt(0).toUpperCase() + season.slice(1)}</strong>. {t(`dex.info.${nowSentence}` as const)}
            </p>
          </div>
        </div>

        <div className="bd-find__row">
          <span className="bd-find__label">{t('dex.info.where')}</span>
          <p className="bd-find__value" data-testid="finding-place">
            {t(`dex.info.place.${info.place}` as const)}
          </p>
        </div>

        <div className="bd-find__row">
          <span className="bd-find__label">{t('dex.info.shy')}</span>
          <p className="bd-find__value" data-testid="finding-shy" data-level={info.shy}>
            <span className="bd-find__dots" aria-hidden="true">
              {[1, 2, 3].map((dot) => (
                <span key={dot} className="bd-find__dot" data-on={dot <= info.shy ? 'true' : undefined} />
              ))}
            </span>
            {shyLabel(info.shy)}
          </p>
        </div>

        <div className="bd-find__row">
          <span className="bd-find__label">{t('dex.info.day')}</span>
          <p className="bd-find__value" data-testid="finding-day">
            {t(`dex.info.dayPart.${info.day}` as const)}
          </p>
        </div>

        {countries ? (
          <div className="bd-find__row">
            <span className="bd-find__label">{t('dex.info.countries')}</span>
            <p className="bd-find__value" data-testid="finding-countries">
              <strong>{t('dex.info.notHere')}</strong> {countries}
            </p>
          </div>
        ) : null}

        {tip ? (
          <p className="bd-find__tip" data-testid="finding-tip">
            {tip}
          </p>
        ) : null}
        <p className="bd-find__estimate">{t('dex.info.estimate')}</p>
      </div>
    </section>
  )
}
