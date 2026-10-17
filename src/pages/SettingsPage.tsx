// Stub: the polish task replaces this screen. Keep the default export.
// Please keep a link to /field-check (the phone test) somewhere in the real settings screen.
import { ROUTES } from '../app/routes'
import { StubPage } from '../app/StubPage'
import { t } from '../i18n'
import { ButtonLink } from '../ui/Button'

export default function SettingsPage() {
  return (
    <StubPage title={t('settings.title')}>
      <ButtonLink to={ROUTES.about} variant="secondary" icon="info">
        {t('settings.about')}
      </ButtonLink>
      <ButtonLink to={ROUTES.fieldCheck} variant="secondary">
        {t('settings.diagnostics')}
      </ButtonLink>
    </StubPage>
  )
}
