import { describe, expect, it } from 'vitest'
import { BackupError } from '../../src/db/backup'
import { StorageFullError } from '../../src/db/errors'
import { catchesText, FRESH_TAP_MS, canShareBackupFile, importErrorText, importSummaryLines, needsSecondTap, exportErrorText } from '../../src/features/settings/backupFlow'
import { REMINDER_AFTER_CATCHES, shouldRemindBackup } from '../../src/features/settings/backupReminder'
import { DEDICATION } from '../../src/features/settings/dedication'
import { formatBuildTime, formatBytes } from '../../src/features/settings/format'
import { detectPlatform } from '../../src/features/settings/install'
import { modelLabel, modelStateLabel, modelTotals } from '../../src/features/settings/models'
import { isSensitivity, SENSITIVITY_LEVELS, sensitivityNumbers } from '../../src/features/settings/sensitivity'
import { formatDateTime } from '../../src/i18n'
import { cs } from '../../src/i18n/cs'
import { catchRule } from '../../src/domain/thresholds'

describe('formatBytes', () => {
  it.each([
    [0, '0 kB'],
    [Number.NaN, '0 kB'],
    [-5, '0 kB'],
    [400, '1 kB'],
    [512_000, '512 kB'],
    [1_000_000, '1 MB'],
    [25_932_528, '25,9 MB'],
    [14_386_564, '14,4 MB'],
    [250_000_000, '250 MB'],
    [1_200_000_000, '1,2 GB'],
  ])('writes %s as %s', (bytes, text) => {
    expect(formatBytes(bytes)).toBe(text)
  })
})

describe('formatBuildTime', () => {
  it('formats an ISO time with the given formatter', () => {
    const text = formatBuildTime('2026-10-17T09:10:00.000Z', formatDateTime)
    expect(text).toMatch(/^17\. 10\. 2026 \d{1,2}:\d{2}$/)
  })

  it('gives nothing for text that is not a time', () => {
    expect(formatBuildTime('soon', formatDateTime)).toBeUndefined()
  })
})

describe('the backup reminder', () => {
  it('appears from 10 catches on, when there never was a backup', () => {
    expect(REMINDER_AFTER_CATCHES).toBe(10)
    expect(shouldRemindBackup(9, undefined)).toBe(false)
    expect(shouldRemindBackup(10, undefined)).toBe(true)
    expect(shouldRemindBackup(300, undefined)).toBe(true)
  })

  it('stays quiet once a backup was made', () => {
    expect(shouldRemindBackup(50, Date.now())).toBe(false)
  })
})

describe('the dedication', () => {
  it('is hidden by default', () => {
    expect(DEDICATION).toBe('')
  })
})

describe('sensitivity numbers', () => {
  it('come from the catch rules, so the text can never disagree with them', () => {
    for (const level of SENSITIVITY_LEVELS) {
      const numbers = sensitivityNumbers(level)
      expect(numbers.sound).toMatch(new RegExp(`^${Math.round(catchRule('sound', level).minConfidence * 100)}\\s%$`))
      expect(numbers.photo).toMatch(new RegExp(`^${Math.round(catchRule('photo', level).minConfidence * 100)}\\s%$`))
    }
  })

  it('get easier from strict to easy', () => {
    const percent = (text: string) => Number.parseInt(text, 10)
    expect(percent(sensitivityNumbers('strict').sound)).toBeGreaterThan(percent(sensitivityNumbers('normal').sound))
    expect(percent(sensitivityNumbers('normal').sound)).toBeGreaterThan(percent(sensitivityNumbers('easy').sound))
  })

  it('knows which values are sensitivities', () => {
    expect(isSensitivity('strict')).toBe(true)
    expect(isSensitivity('normal')).toBe(true)
    expect(isSensitivity('easy')).toBe(true)
    expect(isSensitivity('hard')).toBe(false)
    expect(isSensitivity(undefined)).toBe(false)
  })
})

describe('the backup flow', () => {
  it('asks for a second tap only when sharing is possible and the first tap is old', () => {
    expect(needsSecondTap(100, true)).toBe(false)
    expect(needsSecondTap(FRESH_TAP_MS, true)).toBe(false)
    expect(needsSecondTap(FRESH_TAP_MS + 1, true)).toBe(true)
    // A plain download needs no fresh tap.
    expect(needsSecondTap(60_000, false)).toBe(false)
  })

  it('knows whether files can be shared', () => {
    expect(canShareBackupFile(undefined)).toBe(false)
    expect(canShareBackupFile({} as Navigator)).toBe(false)
    expect(canShareBackupFile({ share: async () => undefined, canShare: () => true })).toBe(true)
    expect(canShareBackupFile({ share: async () => undefined, canShare: () => false })).toBe(false)
    expect(
      canShareBackupFile({
        share: async () => undefined,
        canShare: () => {
          throw new Error('nope')
        },
      }),
    ).toBe(false)
  })

  it('summarises a restore, most important line first', () => {
    const lines = importSummaryLines({ total: 30, added: 28, skipped: 2, mediaAdded: 26, mediaMissing: 2 })
    expect(lines).toEqual([
      'Přidáno 28 nálezů z 30.',
      '2 už v telefonu bylo a zůstalo, jak bylo.',
      'Fotek a nahrávek: 26.',
      '2 nálezů se obnovilo bez fotky nebo nahrávky, protože je záloha neobsahovala.',
    ])
  })

  it('uses the right Czech plural and leaves out lines that do not apply', () => {
    expect(importSummaryLines({ total: 1, added: 1, skipped: 0, mediaAdded: 0, mediaMissing: 0 })).toEqual(['Přidáno 1 nález z 1.'])
    expect(importSummaryLines({ total: 3, added: 3, skipped: 0, mediaAdded: 0, mediaMissing: 0 })).toEqual(['Přidáno 3 nálezy z 3.'])
  })

  it('says so when there was nothing new', () => {
    expect(importSummaryLines({ total: 30, added: 0, skipped: 30, mediaAdded: 0, mediaMissing: 0 })).toEqual([
      'Všechny nálezy z téhle zálohy už v telefonu jsou. Nic se nezměnilo.',
    ])
  })

  it('has a calm sentence for each way a restore can fail', () => {
    expect(importErrorText(new BackupError('not-a-zip', 'x'))).toContain('není záloha')
    expect(importErrorText(new BackupError('not-a-backup', 'x'))).toContain('není záloha')
    expect(importErrorText(new BackupError('too-new', 'x'))).toContain('novější verze')
    expect(importErrorText(new BackupError('malformed', 'x'))).toContain('poškozená')
    expect(importErrorText(new BackupError('storage-full', 'x'))).toContain('došlo místo')
    expect(importErrorText(new BackupError('storage-full', 'x', { report: { total: 9, added: 4, skipped: 0, mediaAdded: 4, mediaMissing: 0 } }))).toContain('Obnoveno bylo 4 nálezů')
    expect(importErrorText(new Error('boom'))).toContain('Zkus to prosím ještě jednou')
  })

  it('has a calm sentence for a backup that could not be made', () => {
    expect(exportErrorText(new StorageFullError('full'))).toContain('došlo místo')
    expect(exportErrorText(new Error('boom'))).toContain('Zálohu se nepodařilo vytvořit')
  })

  it('writes a count of catches with the right plural', () => {
    expect(catchesText(1)).toBe('1 nález')
    expect(catchesText(2)).toBe('2 nálezy')
    expect(catchesText(5)).toBe('5 nálezů')
  })
})

describe('the model list', () => {
  const file = (id: string, bytes: number, state: 'ready' | 'missing' | 'downloading' | 'failed') => ({ id, label: id, file: id, bytes, state, loadedBytes: state === 'ready' ? bytes : 0 })

  it('adds up what is downloaded and what is not', () => {
    const totals = modelTotals({ files: [file('a', 100, 'ready'), file('b', 50, 'missing'), file('c', 25, 'downloading'), file('d', 10, 'ready')] })
    expect(totals).toEqual({ files: 4, readyFiles: 2, totalBytes: 185, downloadedBytes: 110 })
  })

  it('handles an empty list', () => {
    expect(modelTotals({ files: [] })).toEqual({ files: 0, readyFiles: 0, totalBytes: 0, downloadedBytes: 0 })
  })

  it('has a Czech name for every file the model store knows, and a general one for any other file', () => {
    for (const id of ['birdnet-fp16', 'birdnet-geo-fp16', 'wingclip-onnx', 'wingclip-data', 'wingclip-text']) {
      expect(modelLabel(id)).not.toBe('Další soubor')
      expect(modelLabel(id)).not.toMatch(/[a-z]+-[a-z0-9]+$/)
    }
    expect(modelLabel('something-new')).toBe('Další soubor')
  })

  it('names every state in Czech', () => {
    expect(modelStateLabel('ready')).toBe('staženo')
    expect(modelStateLabel('missing')).toBe('chybí')
    expect(modelStateLabel('downloading')).toBe('stahuje se')
    expect(modelStateLabel('failed')).toBe('selhalo')
  })
})

describe('detectPlatform', () => {
  const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
  const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36'
  const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15'
  const WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

  it('recognises the phones', () => {
    expect(detectPlatform({ userAgent: IPHONE, standalone: false })).toBe('ios')
    expect(detectPlatform({ userAgent: ANDROID, standalone: false })).toBe('android')
  })

  it('recognises an iPad that says it is a Mac, but not a real Mac', () => {
    expect(detectPlatform({ userAgent: MAC, maxTouchPoints: 5, standalone: false })).toBe('ios')
    expect(detectPlatform({ userAgent: MAC, maxTouchPoints: 0, standalone: false })).toBe('desktop')
    expect(detectPlatform({ userAgent: WINDOWS, standalone: false })).toBe('desktop')
  })

  it('says installed when it runs from the home screen, whatever the phone', () => {
    expect(detectPlatform({ userAgent: IPHONE, standalone: true })).toBe('installed')
    expect(detectPlatform({ userAgent: ANDROID, standalone: true })).toBe('installed')
  })
})

describe('the texts of this area', () => {
  const entries: Array<[string, string]> = []
  const walk = (tree: object, prefix: string) => {
    for (const [key, value] of Object.entries(tree)) {
      if (typeof value === 'string') entries.push([`${prefix}${key}`, value])
      else if (typeof value === 'object' && value !== null) walk(value, `${prefix}${key}.`)
    }
  }
  walk({ settings: cs.settings, about: cs.about, fun: cs.fun, onboarding: cs.onboarding }, '')

  it('never mention a bird name inside a sentence (Czech declines names)', () => {
    for (const [path, text] of entries) expect(text, path).not.toMatch(/\{(name|species|bird)\}/)
  })

  it('use the informal "ty" and no gendered past forms', () => {
    const gendered = /\b(zálohoval|poslal|přišel|viděl|chytil|smazal|stáhl|zrušil)\b/
    for (const [path, text] of entries) expect(text, path).not.toMatch(gendered)
  })

  it('are written in Czech, with the licence names the authors use', () => {
    const joined = entries.map(([, text]) => text).join(' ')
    for (const licence of ['CC BY-NC-SA 4.0', 'CC BY-NC 4.0', 'MIT', 'Apache-2.0', 'SIL Open Font License', 'ODbL']) expect(joined).toContain(licence)
  })
})
