// The logic behind the backup section: how long a share sheet stays allowed after a tap, and which Czech text fits what happened.
// Pure functions (they only read the translations), so they can be tested without a browser.

import { BackupError, type ImportReport } from '../../db/backup'
import { formatNumber, plural, t } from '../../i18n'
import { commonErrorKey } from '../../state/failures'

/**
 * Browsers only open the share sheet for a fresh tap (iOS: about a second or so, other browsers a few seconds). If making the
 * backup took longer than this, the person gets a "ready" button and the share sheet opens from that second tap.
 */
export const FRESH_TAP_MS = 1500

/** True when the backup has to wait for a second tap before it can be handed to the phone. */
export function needsSecondTap(elapsedMs: number, canShareFiles: boolean): boolean {
  return canShareFiles && elapsedMs > FRESH_TAP_MS
}

/** Whether this browser can hand a .zip file to the phone's share sheet. */
export function canShareBackupFile(nav: Pick<Navigator, 'share' | 'canShare'> | undefined = typeof navigator === 'undefined' ? undefined : navigator): boolean {
  if (!nav || typeof nav.share !== 'function' || typeof nav.canShare !== 'function') return false
  try {
    return nav.canShare({ files: [new File([], 'birddex-backup.zip', { type: 'application/zip' })] })
  } catch {
    return false
  }
}

/** The lines that say what a restore did, most important first. */
export function importSummaryLines(report: ImportReport): string[] {
  if (report.added === 0) return [t('settings.backup.result.nothingNew')]
  const lines = [
    t('settings.backup.result.added', {
      count: report.added,
      forms: plural(report.added, ['nález', 'nálezy', 'nálezů']),
      total: report.total,
    }),
  ]
  if (report.skipped > 0) lines.push(t('settings.backup.result.skipped', { count: report.skipped }))
  if (report.mediaAdded > 0) lines.push(t('settings.backup.result.media', { count: report.mediaAdded }))
  if (report.mediaMissing > 0) lines.push(t('settings.backup.result.mediaMissing', { count: report.mediaMissing }))
  return lines
}

/** A calm Czech sentence for whatever went wrong while restoring a backup. */
export function importErrorText(error: unknown): string {
  if (error instanceof BackupError) {
    switch (error.code) {
      case 'not-a-zip':
      case 'not-a-backup':
        return t('settings.backup.errors.notBackup')
      case 'too-new':
        return t('settings.backup.errors.tooNew')
      case 'malformed':
        return t('settings.backup.errors.malformed')
      case 'storage-full':
        return error.report && error.report.added > 0
          ? t('settings.backup.errors.storageFullPartial', { count: error.report.added })
          : t('settings.backup.errors.storageFull')
    }
  }
  return t(`common.errors.${commonErrorKey(error)}` as const)
}

/** A calm Czech sentence for a backup that could not be made. */
export function exportErrorText(error: unknown): string {
  const key = commonErrorKey(error)
  return key === 'storageFull' ? t('common.errors.storageFull') : t('settings.backup.exportFailed')
}

/** "3 nálezy" style helper kept here so the page does not repeat the plural forms. */
export function catchesText(count: number): string {
  return `${formatNumber(count)} ${plural(count, ['nález', 'nálezy', 'nálezů'])}`
}
