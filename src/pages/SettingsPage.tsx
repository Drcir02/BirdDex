// Settings: the trainer card, sensitivity, sound effects, storage, backup and restore, erase everything, links and version.
import { useCallback, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { resetWelcomed } from '../app/welcome'
import { ROUTES } from '../app/routes'
import { useCaughtSummary } from '../db'
import { BackupSection } from '../features/settings/BackupSection'
import { lastBackupAt, shouldRemindBackup } from '../features/settings/backupReminder'
import { EraseSection } from '../features/settings/EraseSection'
import { formatBuildTime } from '../features/settings/format'
import { SensitivitySection } from '../features/settings/SensitivitySection'
import { SoundSection } from '../features/settings/SoundSection'
import { StorageSection } from '../features/settings/StorageSection'
import { TrainerCard } from '../features/settings/TrainerCard'
import { useBackup } from '../features/settings/useBackup'
import '../features/settings/settings.css'
import { formatDateTime, t } from '../i18n'
import { Button, ButtonLink, LcdPanel, Notice, Page, PageHeader } from '../ui'

export default function SettingsPage() {
  const navigate = useNavigate()
  const { catchCount } = useCaughtSummary()
  // Bumped when a backup was made or the data was erased, so the "last backup" line and the reminder are read again.
  const [version, setVersion] = useState(0)
  const changed = useCallback(() => setVersion((value) => value + 1), [])
  const backup = useBackup(changed)

  const remind = shouldRemindBackup(catchCount, lastBackupAt())
  const built = formatBuildTime(__BUILD_TIME__, formatDateTime)

  const replayWelcome = () => {
    resetWelcomed()
    navigate(ROUTES.welcome)
  }

  return (
    <Page className="bd-set">
      <PageHeader title={t('settings.title')} />

      {remind ? (
        <Notice
          tone="warning"
          title={t('settings.backup.reminderTitle')}
          action={
            <Button icon="download" disabled={backup.busy} onClick={backup.startExport} data-testid="backup-reminder-action">
              {t('settings.backup.reminderAction')}
            </Button>
          }
          className="bd-set-reminder"
        >
          <span data-testid="backup-reminder">{t('settings.backup.reminderText', { count: catchCount })}</span>
        </Notice>
      ) : null}

      <TrainerCard />
      <SensitivitySection />
      <SoundSection />
      <StorageSection />
      <BackupSection backup={backup} version={version} />
      <EraseSection onErased={changed} />

      <LcdPanel title={t('settings.more.title')}>
        <div className="bd-set-section">
          <ButtonLink to={ROUTES.about} variant="secondary" icon="info" fullWidth data-testid="link-about">
            {t('settings.about')}
          </ButtonLink>
          <p className="bd-set-hint">{t('settings.aboutHint')}</p>
          <ButtonLink to={ROUTES.fieldCheck} variant="secondary" icon="settings" fullWidth data-testid="link-field-check">
            {t('settings.diagnostics')}
          </ButtonLink>
          <p className="bd-set-hint">{t('settings.diagnosticsHint')}</p>
          <Button variant="secondary" icon="refresh" fullWidth onClick={replayWelcome} data-testid="replay-welcome">
            {t('settings.replayWelcome')}
          </Button>
        </div>
      </LcdPanel>

      <p className="bd-set-version" data-testid="app-version">
        {t('settings.version', { version: __APP_VERSION__ })}
        {built ? ` · ${t('settings.built', { when: built })}` : ''}
      </p>
    </Page>
  )
}
