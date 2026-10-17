import { describe, expect, it } from 'vitest'
import { isTranslationKey, plural, t } from '../../src/i18n'
import { RARITIES } from '../../src/data/species'
import { SILHOUETTE_SHAPES } from '../../src/ui/silhouette'

// Some texts of the Dex are chosen by a computed key (the silhouette shape, the rarity, the progress stage). The compiler
// cannot check those one by one, so this does: every value that can come up has its Czech text.

describe('the Czech texts of the Dex that are chosen by a computed key', () => {
  it('has a tip for every silhouette shape', () => {
    for (const shape of SILHOUETTE_SHAPES) {
      expect(isTranslationKey(`dex.hint.${shape}`), shape).toBe(true)
      expect(t(`dex.hint.${shape}` as const).length).toBeGreaterThan(15)
    }
  })

  it('has a note and a name for every rarity', () => {
    for (const rarity of RARITIES) {
      expect(isTranslationKey(`dex.rarityNote.${rarity}`), rarity).toBe(true)
      expect(isTranslationKey(`common.rarity.${rarity}`), rarity).toBe(true)
    }
  })

  it('has a cheering line for every stage of progress', () => {
    for (const stage of ['none', 'start', 'growing', 'half', 'almost', 'complete']) expect(isTranslationKey(`dex.progressNote.${stage}`), stage).toBe(true)
  })

  it('has a name for every way of catching and every note of the demo catches', () => {
    for (const method of ['sound', 'photo', 'live']) expect(isTranslationKey(`common.methods.${method}`), method).toBe(true)
    for (const note of ['feeder', 'river', 'early', 'field']) expect(isTranslationKey(`dex.demo.notes.${note}`), note).toBe(true)
  })

  it('counts birds with the Czech word forms', () => {
    const forms = [t('dex.birds.one'), t('dex.birds.few'), t('dex.birds.many')] as const
    expect([0, 1, 2, 4, 5, 22, 276].map((count) => t('dex.listCount', { count, birds: plural(count, forms) }))).toEqual([
      '0 ptáků',
      '1 pták',
      '2 ptáci',
      '4 ptáci',
      '5 ptáků',
      '22 ptáků',
      '276 ptáků',
    ])
  })

  it('writes the progress and the position the Czech way', () => {
    expect(t('dex.progress', { caught: 22, total: 276 })).toBe('Chyceno 22 z 276')
    expect(t('dex.species.position', { position: 3, total: 423 })).toBe('3 z 423')
    expect(t('dex.card.aria', { name: 'Sýkora koňadra', number: 268, state: t('dex.card.caught'), rarity: t('common.rarity.common') })).toBe('Sýkora koňadra, číslo 268, chycený pták, Běžný')
  })

  it('keeps every text of the Dex free of the English words an unfinished translation would leave', () => {
    const english = /\b(the|and|caught|not caught|search|loading|retry|delete|photo|recording)\b/i
    const keys = ['dex.title', 'dex.subtitle', 'dex.searchLabel', 'dex.loading', 'dex.empty.title', 'dex.status.notCaughtTitle', 'dex.photo.reveal', 'dex.audio.play', 'dex.deleteDialog.title']
    for (const key of keys) expect(t(key as 'dex.title'), key).not.toMatch(english)
  })
})
