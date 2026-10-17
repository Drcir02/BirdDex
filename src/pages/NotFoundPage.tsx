import { ROUTES } from '../app/routes'
import { t } from '../i18n'
import { ButtonLink } from '../ui/Button'
import { EmptyState } from '../ui/EmptyState'
import { Page } from '../ui/Page'

export default function NotFoundPage() {
  return (
    <Page>
      <EmptyState
        headingLevel={1}
        title={t('common.notFound.title')}
        message={t('common.notFound.message')}
        action={<ButtonLink to={ROUTES.dex}>{t('common.notFound.home')}</ButtonLink>}
      />
    </Page>
  )
}
