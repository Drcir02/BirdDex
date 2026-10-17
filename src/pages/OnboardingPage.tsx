// Stub: the polish task replaces this screen. Keep the default export.
// The real screen must call markWelcomed() when it is finished or skipped, then go to the Dex (replace the history entry).
import { useNavigate } from 'react-router-dom'
import { ROUTES } from '../app/routes'
import { StubPage } from '../app/StubPage'
import { markWelcomed } from '../app/welcome'
import { t } from '../i18n'
import { Button } from '../ui/Button'

export default function OnboardingPage() {
  const navigate = useNavigate()
  const start = () => {
    markWelcomed()
    navigate(ROUTES.dex, { replace: true })
  }
  return (
    <StubPage title={t('onboarding.title')}>
      <Button size="lg" onClick={start}>
        {t('onboarding.start')}
      </Button>
    </StubPage>
  )
}
