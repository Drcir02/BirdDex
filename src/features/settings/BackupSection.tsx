import { useRef } from 'react'
import { useCaughtSummary } from '../../db'
import { formatDate, t } from '../../i18n'
import { Button, LcdPanel, Notice } from '../../ui'
import { lastBackupAt } from './backupReminder'
import type { BackupController } from './useBackup'
import './settings.css'

export interface BackupSectionProps {
  backup: BackupController
  /** Changes whenever a backup was made, so the "last backup" line is read again. */
  version: number
}

export function BackupSection({ backup, version }: BackupSectionProps) {
  const { catchCount, ready } = useCaughtSummary()
  const input = useRef<HTMLInputElement>(null)
  const last = lastBackupAt()
  void version
  const { phase, progress, message } = backup

  const exportLabel =
    phase === 'building' ? (progress ? t('settings.backup.exportingProgress', { done: progress.done, total: progress.total }) : t('settings.backup.exporting')) : t('settings.backup.export')
  const importLabel =
    phase === 'importing' ? (progress ? t('settings.backup.importingProgress', { done: progress.done, total: progress.total }) : t('settings.backup.importing')) : t('settings.backup.import')

  return (
    <LcdPanel title={t('settings.backup.title')} data-testid="backup-section">
      <div className="bd-set-section">
        <p className="bd-set-hint">{t('settings.backup.hint')}</p>
        <p data-testid="backup-last">{last !== undefined ? t('settings.backup.last', { date: formatDate(last) }) : t('settings.backup.never')}</p>

        {phase === 'ready' ? (
          <Button size="lg" icon="download" fullWidth onClick={backup.saveReady} data-testid="backup-save">
            {t('settings.backup.save')}
          </Button>
        ) : (
          <Button
            icon="download"
            fullWidth
            busy={phase === 'building' || phase === 'saving'}
            disabled={backup.busy || (ready && catchCount === 0)}
            onClick={backup.startExport}
            data-testid="backup-export"
          >
            {exportLabel}
          </Button>
        )}
        {ready && catchCount === 0 ? <p className="bd-set-hint">{t('settings.backup.nothingToBackUp')}</p> : null}

        <p className="bd-set-hint">{t('settings.backup.importHint')}</p>
        <input
          ref={input}
          className="bd-set-file"
          type="file"
          accept=".zip,application/zip,application/x-zip-compressed"
          aria-label={t('settings.backup.importChoose')}
          tabIndex={-1}
          data-testid="backup-file"
          onChange={(event) => {
            const file = event.currentTarget.files?.[0]
            // The same file can be chosen again next time.
            event.currentTarget.value = ''
            if (file) backup.restore(file)
          }}
        />
        <Button variant="secondary" icon="upload" fullWidth busy={phase === 'importing'} disabled={backup.busy} onClick={() => input.current?.click()} data-testid="backup-import">
          {importLabel}
        </Button>

        {message ? (
          <div data-testid="backup-message" data-tone={message.tone}>
            <Notice tone={message.tone} title={message.title}>
              <div className="bd-set-notice-lines">
                {message.lines.map((line, index) => (
                  <p key={index}>{line}</p>
                ))}
              </div>
            </Notice>
          </div>
        ) : null}
      </div>
    </LcdPanel>
  )
}
