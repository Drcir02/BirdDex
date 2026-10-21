// What the "when and where to find it" block of the detail screen says, worked out from a bird's `info`: the months as a
// sentence, the countries as a list. Plain functions of the data and the clock, so they are unit-tested without a screen.

import { isTranslationKey, t, type TranslationKey } from '../../i18n'
import type { Shyness, SpeciesInfo } from '../../domain/types'

export const MONTH_KEYS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'] as const
export type MonthKey = (typeof MONTH_KEYS)[number]

/** A text whose key is only known at run time and has no placeholders. */
const plain = (key: TranslationKey): string => t(key as 'dex.info.title')

/** How many countries the list names before it says "and more". */
export const COUNTRIES_SHOWN = 6

/** The twelve levels (0 to 3) of the months string; a malformed string gives twelve zeros. */
export function monthLevels(months: string): number[] {
  return Array.from({ length: 12 }, (_, index) => {
    const level = Number(months[index])
    return level >= 0 && level <= 3 ? level : 0
  })
}

export interface MonthRun {
  /** Index of the first month (0 is January) and of the last one. A run may cross the turn of the year (October to March). */
  from: number
  to: number
}

/**
 * The stretches of the year when the bird is likely there: months of level 2 or 3 (or, when no month is that sure, level 1).
 * Undefined for the whole year, an empty list for no month at all.
 */
export function seasonRuns(levels: readonly number[]): MonthRun[] | undefined {
  const threshold = levels.some((level) => level >= 2) ? 2 : 1
  const on = levels.map((level) => level >= threshold)
  if (on.every(Boolean)) return undefined
  const runs: MonthRun[] = []
  for (let month = 0; month < 12; month++) {
    if (!on[month] || on[(month + 11) % 12]) continue
    let end = month
    while (on[(end + 1) % 12]) end = (end + 1) % 12
    runs.push({ from: month, to: end })
  }
  return runs
}

/** "od října do března", "v dubnu", "celý rok", or two stretches joined with "a". */
export function seasonText(months: string): string {
  const runs = seasonRuns(monthLevels(months))
  if (!runs) return t('dex.info.season.allYear')
  const parts = runs.map(({ from, to }) =>
    from === to
      ? t('dex.info.season.inMonth', { month: t(`dex.info.monthIn.${MONTH_KEYS[from]}` as const) })
      : t('dex.info.season.fromTo', { from: t(`dex.info.monthFrom.${MONTH_KEYS[from]}` as const), to: t(`dex.info.monthFrom.${MONTH_KEYS[to]}` as const) }),
  )
  return parts.reduce((first, second) => t('dex.info.season.and', { first, second }))
}

/** Which of the three sentences about this month fits: 2 the right time, 1 only now and then, 0 not there. */
export function nowLevel(months: string, now: Date): 0 | 1 | 2 {
  const level = monthLevels(months)[now.getMonth()] ?? 0
  return level >= 2 ? 2 : level === 1 ? 1 : 0
}

export function shyLabel(shy: Shyness): string {
  return shy === 1 ? t('dex.info.shyLevel.close') : shy === 2 ? t('dex.info.shyLevel.wary') : t('dex.info.shyLevel.far')
}

/** Names of the first countries, then "a další" when there are more. Empty when the bird has no country list. */
export function countriesText(codes: readonly string[] | undefined): string {
  if (!codes || codes.length === 0) return ''
  const name = (code: string): string => {
    const key = `dex.info.country.${code}`
    return isTranslationKey(key) ? plain(key) : code
  }
  const list = codes.slice(0, COUNTRIES_SHOWN).map(name).join(', ')
  return codes.length > COUNTRIES_SHOWN ? t('dex.info.countriesMore', { list }) : list
}

/** The group text for a bird, or undefined when the tip of the data has no text (a Dex file newer than the app). */
export function tipText(info: SpeciesInfo): string | undefined {
  const key = `dex.info.tips.${info.tip}`
  return isTranslationKey(key) ? plain(key) : undefined
}
