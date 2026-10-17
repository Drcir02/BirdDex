import type { CSSProperties } from 'react'
import { ROUTES } from '../../app/routes'
import { useSpecies } from '../../data/useSpecies'
import { getDb, useLiveQuery } from '../../db'
import type { CatchRecord, CatchMethod } from '../../domain/types'
import { formatDate, formatPercent, plural, t } from '../../i18n'
import { ButtonLink, Chip, Icon, LcdPanel, Spinner } from '../../ui'
import { computeTrainerStats, type RegionProgress } from './stats'
import './settings.css'

const METHODS: readonly CatchMethod[] = ['sound', 'photo', 'live']
const METHOD_ICON = { sound: 'microphone', photo: 'photo', live: 'live' } as const
const NO_CATCHES: CatchRecord[] = []

function Meter({ label, progress, testId }: { label: string; progress: RegionProgress; testId: string }) {
  return (
    <div data-testid={testId}>
      <div className="bd-set-meter__head">
        <span>{label}</span>
        <strong data-testid={`${testId}-percent`}>{formatPercent(progress.fraction)}</strong>
      </div>
      <div
        className="bd-set-meter__track"
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress.fraction * 100)}
        aria-valuetext={t('settings.trainer.ofTotal', { caught: progress.caught, total: progress.total })}
      >
        <div className="bd-set-meter__fill" style={{ '--w': `${progress.fraction * 100}%` } as CSSProperties} />
      </div>
      <div className="bd-set-meter__head">
        <span>{t('settings.trainer.ofTotal', { caught: progress.caught, total: progress.total })}</span>
      </div>
    </div>
  )
}

/** The trainer card: how far the Dex is filled, the rarest bird, the first catch, the streak and the catches per method. */
export function TrainerCard() {
  const { species } = useSpecies()
  const catches = useLiveQuery(() => getDb().catches.toArray(), [], NO_CATCHES)

  return (
    <LcdPanel title={t('settings.trainer.title')} tone="dark" data-testid="trainer-card">
      {!species || !catches.ready ? (
        <p role="status">
          <Spinner size="sm" label={null} /> {t('common.loading')}
        </p>
      ) : (
        <CardBody catches={catches.value} species={species} />
      )}
    </LcdPanel>
  )
}

function CardBody({ catches, species }: { catches: readonly CatchRecord[]; species: NonNullable<ReturnType<typeof useSpecies>['species']> }) {
  const stats = computeTrainerStats(catches, species)
  if (stats.totalCatches === 0) {
    return (
      <div className="bd-set-section" data-testid="trainer-empty">
        <p>{t('settings.trainer.empty')}</p>
        <ButtonLink to={ROUTES.scan} icon="scan">
          {t('settings.trainer.emptyAction')}
        </ButtonLink>
      </div>
    )
  }

  const rarestSpecies = stats.rarest ? species.find((entry) => entry.id === stats.rarest?.speciesId) : undefined
  const streakDays = (count: number) => plural(count, ['den', 'dny', 'dní'])

  return (
    <div className="bd-set-trainer">
      <div className="bd-set-trainer__top">
        <div className="bd-set-trainer__big">
          <span className="bd-set-trainer__number" data-testid="stat-species">
            {stats.speciesCaught}
          </span>
          <span className="bd-set-trainer__caption">{plural(stats.speciesCaught, ['druh', 'druhy', 'druhů'])}</span>
        </div>
        <div>
          <p>{t('settings.trainer.species')}</p>
          <p className="bd-set-trainer__sub" data-testid="stat-catches">
            {t('settings.trainer.speciesDetail', { catches: stats.totalCatches })}
          </p>
        </div>
      </div>

      <div className="bd-set-trainer__meters">
        <Meter label={t('settings.trainer.czechia')} progress={stats.czechia} testId="stat-czechia" />
        <Meter label={t('settings.trainer.europe')} progress={stats.europe} testId="stat-europe" />
      </div>

      <dl className="bd-set-facts">
        <div className="bd-set-fact bd-set-fact--wide" data-testid="stat-rarest">
          <dt>{t('settings.trainer.rarest')}</dt>
          <dd>
            {stats.rarest ? (
              <>
                {rarestSpecies ? (rarestSpecies.czechName ?? rarestSpecies.scientificName) : null}
                <span className="bd-set-fact__sub">
                  <Chip tone={stats.rarest.rarity}>{t(`common.rarity.${stats.rarest.rarity}` as const)}</Chip>
                </span>
              </>
            ) : (
              '–'
            )}
          </dd>
        </div>
        <div className="bd-set-fact" data-testid="stat-first">
          <dt>{t('settings.trainer.firstCatch')}</dt>
          <dd>{stats.firstCatchAt !== undefined ? formatDate(stats.firstCatchAt) : '–'}</dd>
        </div>
        <div className="bd-set-fact" data-testid="stat-streak">
          <dt>{t('settings.trainer.streak')}</dt>
          <dd>
            {stats.streak.current > 0
              ? t('settings.trainer.streakDays', { count: stats.streak.current, days: streakDays(stats.streak.current) })
              : t('settings.trainer.streakNone')}
            {stats.streak.best > 1 ? (
              <span className="bd-set-fact__sub">{t('settings.trainer.streakBest', { count: stats.streak.best, days: streakDays(stats.streak.best) })}</span>
            ) : null}
          </dd>
        </div>
      </dl>

      <div>
        <h3 className="bd-set-trainer__methods-title">{t('settings.trainer.methods')}</h3>
        <ul className="bd-set-methods">
          {METHODS.map((method) => (
            <li key={method} className="bd-set-method" data-testid={`stat-method-${method}`}>
              <Icon name={METHOD_ICON[method]} size={22} />
              <span className="bd-set-method__count">{stats.perMethod[method]}</span>
              <span className="bd-set-method__name">{t(`common.methods.${method}` as const)}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
