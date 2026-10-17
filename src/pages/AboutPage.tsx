// Stub: the polish task replaces this screen. Keep the default export.
import { ROUTES } from '../app/routes'
import { StubPage } from '../app/StubPage'
import { t } from '../i18n'

export default function AboutPage() {
  return <StubPage title={t('about.title')} backTo={ROUTES.settings} />
}
