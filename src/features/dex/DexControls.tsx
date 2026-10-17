import { plural, t } from '../../i18n'
import type { Region } from '../../data/species'
import { Chip } from '../../ui/Chip'
import { Icon } from '../../ui/icons'
import { SearchField } from '../../ui/SearchField'
import { REGIONS, SORTS, STATUSES, type DexSort, type StatusFilter } from './filters'

export interface DexControlsProps {
  /** How many birds the list shows now: it is read out when the list changes. */
  count: number
  search: string
  region: Region
  status: StatusFilter
  sort: DexSort
  onSearch: (value: string) => void
  onRegion: (region: Region) => void
  onStatus: (status: StatusFilter) => void
  onSort: (sort: DexSort) => void
}

const REGION_LABEL = { czechia: 'dex.filter.czechia', europe: 'dex.filter.europe' } as const satisfies Record<Region, string>
const STATUS_LABEL = { all: 'dex.filter.all', caught: 'dex.filter.caught', missing: 'dex.filter.missing' } as const satisfies Record<StatusFilter, string>
const SORT_LABEL = { number: 'dex.sort.number', name: 'dex.sort.name', rarity: 'dex.sort.rarity' } as const satisfies Record<DexSort, string>

/** Search box, region and status chips and the sort menu of the Dex. */
export function DexControls({ count, search, region, status, sort, onSearch, onRegion, onStatus, onSort }: DexControlsProps) {
  return (
    <div className="bd-dexctl">
      {/* The search key of the phone keyboard closes the keyboard, so the results are in view. */}
      <form
        onSubmit={(event) => {
          event.preventDefault()
          if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
        }}
      >
        <SearchField value={search} onChange={onSearch} label={t('dex.searchLabel')} placeholder={t('dex.searchPlaceholder')} />
      </form>
      <div className="bd-dexctl__chips" role="group" aria-label={t('dex.regionGroup')}>
        {REGIONS.map((option) => (
          <Chip key={option} selected={region === option} onClick={() => onRegion(option)}>
            {t(REGION_LABEL[option])}
          </Chip>
        ))}
      </div>
      <div className="bd-dexctl__chips" role="group" aria-label={t('dex.statusGroup')}>
        {STATUSES.map((option) => (
          <Chip key={option} selected={status === option} onClick={() => onStatus(option)}>
            {t(STATUS_LABEL[option])}
          </Chip>
        ))}
      </div>
      <div className="bd-dexctl__foot">
        <p className="bd-dexctl__count" role="status" data-testid="dex-count">
          {t('dex.listCount', { count, birds: plural(count, [t('dex.birds.one'), t('dex.birds.few'), t('dex.birds.many')]) })}
        </p>
        <label className="bd-dexsort">
          <span className="bd-sr-only">{t('dex.sortLabel')}</span>
          <svg className="bd-dexsort__icon" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
            <path d="M4 6h16M4 12h11M4 18h6" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
          </svg>
          <select className="bd-dexsort__select" value={sort} onChange={(event) => onSort(event.target.value as DexSort)}>
            {SORTS.map((option) => (
              <option key={option} value={option}>
                {t(SORT_LABEL[option])}
              </option>
            ))}
          </select>
          <Icon name="chevron" size={18} className="bd-dexsort__arrow" />
        </label>
      </div>
    </div>
  )
}
