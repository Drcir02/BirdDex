import { describe, expect, it } from 'vitest'
import { APP_NAME } from '../../src/app/constants'
import {
  formatDate,
  formatDateTime,
  formatNumber,
  formatPercent,
  formatTime,
  isTranslationKey,
  plural,
  pluralIndex,
  t,
  type PluralForms,
} from '../../src/i18n'
import { cs } from '../../src/i18n/cs'

const BIRDS: PluralForms = ['pták', 'ptáci', 'ptáků']

describe('t()', () => {
  it('returns Czech text with correct diacritics for the generic buttons', () => {
    expect(t('common.ok')).toBe('OK')
    expect(t('common.cancel')).toBe('Zrušit')
    expect(t('common.back')).toBe('Zpět')
    expect(t('common.retry')).toBe('Zkusit znovu')
    expect(t('common.close')).toBe('Zavřít')
    expect(t('common.nav.settings')).toBe('Nastavení')
  })

  it('fills {placeholders} from the params', () => {
    expect(t('dex.progress', { caught: 12, total: 412 })).toBe('Chyceno 12 z 412')
    expect(t('result.caught', { name: 'Sýkora koňadra' })).toBe('Máš ho! Sýkora koňadra je v Dexu.')
  })

  it('always knows {appName} without being told', () => {
    expect(t('onboarding.title')).toBe(`Vítej v ${APP_NAME}`)
  })

  it('writes decimal numbers with a comma and leaves whole numbers alone', () => {
    expect(t('common.a11y.confidence', { value: 0.5 })).toBe('Jistota 0,5')
    expect(t('common.a11y.confidence', { value: 2026 })).toBe('Jistota 2026')
    expect(t('common.a11y.confidence', { value: 6522 })).toBe('Jistota 6522')
  })

  it('keeps a placeholder visible when its value is missing at run time', () => {
    const loose = t as (key: string, params?: Record<string, string | number>) => string
    expect(loose('dex.progress', { caught: 3 })).toBe('Chyceno 3 z {total}')
  })

  it('returns the key itself for an unknown key instead of crashing', () => {
    const loose = t as (key: string) => string
    expect(loose('nope.missing')).toBe('nope.missing')
  })

  it('checks keys and placeholders at compile time', () => {
    // These lines are only type-checked (tsc), they must never run.
    const typeChecks = () => {
      // @ts-expect-error unknown key
      t('nope.missing')
      // @ts-expect-error this text needs { caught, total }
      t('dex.progress')
      // @ts-expect-error total is missing
      t('dex.progress', { caught: 1 })
      // @ts-expect-error this text has no placeholders
      t('common.ok', { value: 1 })
    }
    expect(typeof typeChecks).toBe('function')
  })

  it('tells which strings are keys', () => {
    expect(isTranslationKey('common.ok')).toBe(true)
    expect(isTranslationKey('common.nav')).toBe(false)
    expect(isTranslationKey('hello')).toBe(false)
  })
})

describe('plural()', () => {
  it.each([
    [0, 'ptáků'],
    [1, 'pták'],
    [2, 'ptáci'],
    [3, 'ptáci'],
    [4, 'ptáci'],
    [5, 'ptáků'],
    [10, 'ptáků'],
    [11, 'ptáků'],
    [12, 'ptáků'],
    [13, 'ptáků'],
    [14, 'ptáků'],
    [21, 'ptáků'],
    [22, 'ptáků'],
    [100, 'ptáků'],
    [412, 'ptáků'],
  ])('uses the right form for %i', (count, expected) => {
    expect(plural(count, BIRDS)).toBe(expected)
  })

  it('treats a negative count like its absolute value', () => {
    expect(plural(-1, BIRDS)).toBe('pták')
    expect(plural(-3, BIRDS)).toBe('ptáci')
  })

  it('uses the fraction form when given, otherwise the last form', () => {
    expect(pluralIndex(1.5)).toBe(3)
    expect(plural(1.5, ['pták', 'ptáci', 'ptáků', 'ptáka'])).toBe('ptáka')
    expect(plural(1.5, BIRDS)).toBe('ptáků')
  })
})

describe('number and date formats', () => {
  it('formats numbers the Czech way', () => {
    expect(formatNumber(0.5)).toBe('0,5')
    expect(formatNumber(2026)).toBe('2026')
    expect(formatNumber(Number.NaN)).toBe('–')
  })

  it('formats a fraction as a percentage with a space before the sign', () => {
    expect(formatPercent(0.853)).toMatch(/^85\s%$/)
    expect(formatPercent(1)).toMatch(/^100\s%$/)
    expect(formatPercent(Number.POSITIVE_INFINITY)).toBe('–')
  })

  it('formats dates and times', () => {
    const moment = new Date(2026, 9, 16, 23, 5)
    expect(formatDate(moment)).toBe('16. 10. 2026')
    expect(formatTime(moment)).toBe('23:05')
    expect(formatDateTime(moment)).toBe('16. 10. 2026 23:05')
  })
})

describe('the Czech dictionary', () => {
  const entries: Array<[string, string]> = []
  const walk = (tree: object, prefix: string) => {
    for (const [key, value] of Object.entries(tree)) {
      const path = `${prefix}${key}`
      if (typeof value === 'string') entries.push([path, value])
      else walk(value as object, `${path}.`)
    }
  }
  walk(cs, '')

  it('has one file per feature, in the agreed order of prefixes', () => {
    expect(Object.keys(cs).sort()).toEqual(['about', 'common', 'dex', 'fun', 'onboarding', 'result', 'scan', 'settings'])
  })

  it('has a first set of texts in every file', () => {
    for (const prefix of Object.keys(cs)) {
      expect(entries.filter(([path]) => path.startsWith(`${prefix}.`)).length, prefix).toBeGreaterThan(2)
    }
  })

  it('has no empty or padded texts', () => {
    for (const [path, text] of entries) {
      expect(text.trim(), path).toBe(text)
      expect(text.length, path).toBeGreaterThan(0)
    }
  })

  it('uses well-formed placeholders and the single ellipsis character', () => {
    for (const [path, text] of entries) {
      expect(text, path).not.toMatch(/\{[^}\w]|\{\w*$|[^{\w]\w*\}/)
      expect(text, path).not.toContain('...')
    }
  })

  it('does not contain Czech words written without diacritics', () => {
    const asciiCzech = /\b(Zrusit|Zpet|Zavrit|Nastaveni|Ptaci|ptaku|Pokracovat|Nactu|nactu|Vitej|Chyceno ptaku|Hotovo!?\s?Ptak)\b/
    for (const [path, text] of entries) expect(text, path).not.toMatch(asciiCzech)
  })

  it('has no emoji', () => {
    for (const [path, text] of entries) expect(text, path).not.toMatch(/\p{Extended_Pictographic}/u)
  })
})
