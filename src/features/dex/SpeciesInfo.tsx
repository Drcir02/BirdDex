import { displayName, secondaryName } from '../../data/species'
import { familyNameCs } from '../../data/families'
import type { SpeciesCaughtSummary } from '../../db'
import type { Species } from '../../domain/types'
import { formatDate, t } from '../../i18n'
import { ROUTES } from '../../app/routes'
import { ButtonLink } from '../../ui/Button'
import { Chip } from '../../ui/Chip'
import { Icon } from '../../ui/icons'
import { LcdPanel } from '../../ui/LcdPanel'
import { silhouetteShapeFor } from '../../ui/silhouette'
import { FindingInfo } from './FindingInfo'
import { RarityStars } from './RarityStars'

/** The name block: the Czech name, the Latin name in italics, the family, the rarity and where the bird lives. */
export function NameBlock({ species }: { species: Species }) {
  const scientific = secondaryName(species)
  const family = species.family
  const czechFamily = familyNameCs(family)
  return (
    <LcdPanel className="bd-spname">
      <h1 className="bd-spname__title" data-testid="species-name">
        {displayName(species)}
      </h1>
      {scientific ? (
        <p className="bd-spname__latin" lang="la">
          <i>{scientific}</i>
        </p>
      ) : null}
      {family ? (
        <p className="bd-spname__family">
          <span className="bd-spname__label">{t('dex.species.family')}</span> {czechFamily ?? family}
          {czechFamily ? <span className="bd-spname__latinfamily"> ({family})</span> : null}
        </p>
      ) : null}
      <div className="bd-spname__chips">
        <Chip tone={species.rarity}>
          <RarityStars rarity={species.rarity} size={12} />
          {t(`common.rarity.${species.rarity}` as const)}
        </Chip>
      </div>
      <div className="bd-spname__flags" role="group" aria-label={t('dex.species.regions')}>
        <span className="bd-spname__flagslabel" aria-hidden="true">
          {t('dex.species.regions')}
        </span>
        <Flag label={t('dex.filter.czechia')} on={species.inCzechia} />
        <Flag label={t('dex.filter.europe')} on={species.inEurope} />
      </div>
    </LcdPanel>
  )
}

/** "Česko" with a tick when the bird lives there, with a cross when it does not. A screen reader hears "Česko: ano". */
function Flag({ label, on }: { label: string; on: boolean }) {
  return (
    <Chip tone={on ? 'success' : 'neutral'} icon={on ? 'check' : 'close'} className={on ? undefined : 'is-off'}>
      {label}
      <span className="bd-sr-only">: {t(on ? 'dex.species.yes' : 'dex.species.no')}</span>
    </Chip>
  )
}

/**
 * For a bird that is not caught: when and where to find it, and the button that starts a scan. For a caught one: a short
 * summary, and the same finding info below it. A Dex file without `info` falls back to one general tip.
 */
export function StatusBlock({ species, summary }: { species: Species; summary: SpeciesCaughtSummary | undefined }) {
  if (summary) {
    return (
      <LcdPanel className="bd-spstatus bd-spstatus--caught" data-testid="status-caught">
        <h2 className="bd-spstatus__title">
          <Icon name="check" size={22} />
          {t('dex.status.caughtTitle')}
        </h2>
        <p>{t('dex.status.firstCaught', { date: formatDate(summary.firstCaughtAt) })}</p>
        <p className="bd-spstatus__count">{t('dex.status.catchCount', { count: summary.count })}</p>
        <FindingInfo species={species} caught />
      </LcdPanel>
    )
  }
  const shape = silhouetteShapeFor(species.family)
  return (
    <LcdPanel className="bd-spstatus" data-testid="status-missing">
      <h2 className="bd-spstatus__title">{t('dex.status.notCaughtTitle')}</h2>
      {species.info ? <FindingInfo species={species} caught={false} /> : <p>{t(`dex.hint.${shape}` as const)}</p>}
      <p className="bd-spstatus__rarity">{t(`dex.rarityNote.${species.rarity}` as const)}</p>
      <ButtonLink to={ROUTES.scan} icon="scan" fullWidth>
        {t('dex.status.scan')}
      </ButtonLink>
    </LcdPanel>
  )
}
