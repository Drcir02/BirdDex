// Typed Czech texts for the whole app.
//
//   import { t, plural } from '../i18n'
//   t('dex.title')                                   // plain text
//   t('dex.progress', { caught: 12, total: 412 })    // {placeholders}; the compiler knows which ones a key needs
//   plural(n, ['pták', 'ptáci', 'ptáků'])            // Czech word forms for 1, 2 to 4, and 0 or 5 and more
//
// The texts live in src/i18n/cs/, one file per feature. The file name is the first part of the key.
// {appName} is always filled in automatically, so the app name stays in one constant (src/app/constants.ts).

import { APP_NAME } from '../app/constants'
import { cs } from './cs'

type Dictionary = typeof cs

type Join<Prefix extends string, Key extends string> = Prefix extends '' ? Key : `${Prefix}.${Key}`

/** Every text in the dictionary as a dotted path, for example 'common.nav.dex'. */
type LeafPaths<Tree, Prefix extends string = ''> = {
  [Key in keyof Tree & string]: Tree[Key] extends string ? Join<Prefix, Key> : LeafPaths<Tree[Key], Join<Prefix, Key>>
}[keyof Tree & string]

export type TranslationKey = LeafPaths<Dictionary>

type TextAt<Tree, Path extends string> = Path extends `${infer Head}.${infer Rest}`
  ? Head extends keyof Tree
    ? TextAt<Tree[Head], Rest>
    : never
  : Path extends keyof Tree
    ? Tree[Path]
    : never

type TextOf<Key extends TranslationKey> = TextAt<Dictionary, Key> extends infer Text extends string ? Text : never

type PlaceholderNames<Text extends string> = Text extends `${string}{${infer Name}}${infer Rest}`
  ? Name | PlaceholderNames<Rest>
  : never

export type TranslationParams = Record<string, string | number>

type RequiredNames<Key extends TranslationKey> = Exclude<PlaceholderNames<TextOf<Key>>, 'appName'>

/** No second argument when the text has no placeholders; an object with exactly the needed names when it has. */
type ParamsArgument<Key extends TranslationKey> = string extends TextOf<Key>
  ? [params?: TranslationParams]
  : [RequiredNames<Key>] extends [never]
    ? []
    : [params: Record<RequiredNames<Key>, string | number>]

export const LOCALE = 'cs-CZ'

// ---------- Numbers and dates, written the Czech way ----------

// No digit grouping, so "2026" and "6522" stay as they are. Decimals get a comma.
const plainNumber = new Intl.NumberFormat(LOCALE, { useGrouping: false, maximumFractionDigits: 2 })
const percentNumber = new Intl.NumberFormat(LOCALE, { style: 'percent', maximumFractionDigits: 0 })
const dateOnly = new Intl.DateTimeFormat(LOCALE, { day: 'numeric', month: 'numeric', year: 'numeric' })
const timeOnly = new Intl.DateTimeFormat(LOCALE, { hour: 'numeric', minute: '2-digit' })

export function formatNumber(value: number): string {
  return Number.isFinite(value) ? plainNumber.format(value) : '–'
}

/** 0.853 becomes "85 %" (with a non-breaking space, as Czech typography wants). */
export function formatPercent(fraction: number): string {
  return Number.isFinite(fraction) ? percentNumber.format(fraction) : '–'
}

/** "16. 10. 2026" */
export function formatDate(value: number | Date): string {
  return dateOnly.format(value)
}

/** "23:15" */
export function formatTime(value: number | Date): string {
  return timeOnly.format(value)
}

/** "16. 10. 2026 23:15" */
export function formatDateTime(value: number | Date): string {
  return `${formatDate(value)} ${formatTime(value)}`
}

// ---------- Texts ----------

const messages = new Map<string, string>()

function collect(tree: object, prefix: string): void {
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (typeof value === 'string') messages.set(path, value)
    else if (value !== null && typeof value === 'object') collect(value, path)
  }
}

collect(cs, '')

export function isTranslationKey(value: string): value is TranslationKey {
  return messages.has(value)
}

function interpolate(template: string, params: TranslationParams): string {
  return template.replace(/\{(\w+)\}/g, (placeholder: string, name: string) => {
    const value = params[name]
    if (value === undefined) return placeholder
    return typeof value === 'number' ? formatNumber(value) : value
  })
}

/** Looks up a Czech text. Placeholders like {count} are replaced from `params`. */
export function t<Key extends TranslationKey>(key: Key, ...args: ParamsArgument<Key>): string {
  const template = messages.get(key) ?? key
  const params = (args as [TranslationParams?])[0]
  return interpolate(template, { appName: APP_NAME, ...params })
}

// ---------- Plurals ----------

/** The Czech word forms: one (1), few (2 to 4) and other (0, 5 and more). A fourth form is for fractions. */
export type PluralForms = readonly [one: string, few: string, other: string, fraction?: string]

/**
 * Czech plural rule (CLDR): exactly 1 is "one", 2 to 4 is "few", every other whole number is "other"
 * (so 0, 5 to 20, 21, 22 and 100 all take the genitive plural), and fractions are "fraction".
 */
export function pluralIndex(n: number): 0 | 1 | 2 | 3 {
  const size = Math.abs(n)
  if (!Number.isInteger(size)) return 3
  if (size === 1) return 0
  if (size >= 2 && size <= 4) return 1
  return 2
}

/** Picks the right word form for a count: `plural(3, ['pták', 'ptáci', 'ptáků'])` is "ptáci". */
export function plural(n: number, forms: PluralForms): string {
  return forms[pluralIndex(n)] ?? forms[2]
}
