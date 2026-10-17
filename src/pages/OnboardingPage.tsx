// The welcome screens, shown once on the first start: the idea, what is downloaded and what stays on the phone,
// why the phone will ask for permissions (before it asks), and how to put the app on the home screen.
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ROUTES } from '../app/routes'
import { markWelcomed } from '../app/welcome'
import { DeviceStep, IdeaStep, InstallStep, PermissionsStep } from '../features/settings/OnboardingSteps'
import '../features/settings/onboarding.css'
import { t } from '../i18n'
import { useModelStatus } from '../state/modelStatus'
import { Button, LcdPanel, Page, PageHeader } from '../ui'

const STEPS = ['idea', 'device', 'permissions', 'install'] as const
type StepId = (typeof STEPS)[number]

const TITLES: Record<StepId, 'onboarding.idea.title' | 'onboarding.device.title' | 'onboarding.permissions.title' | 'onboarding.install.title'> = {
  idea: 'onboarding.idea.title',
  device: 'onboarding.device.title',
  permissions: 'onboarding.permissions.title',
  install: 'onboarding.install.title',
}

export default function OnboardingPage() {
  const navigate = useNavigate()
  const status = useModelStatus()
  const [index, setIndex] = useState(0)
  const heading = useRef<HTMLHeadingElement>(null)
  const moved = useRef(false)

  const step = STEPS[index]
  const last = index === STEPS.length - 1

  // After "Dál" the new step's heading gets the focus, so screen readers read it and the keyboard continues from there.
  useEffect(() => {
    if (!moved.current) return
    heading.current?.focus()
  }, [index])

  const finish = () => {
    markWelcomed()
    navigate(ROUTES.dex, { replace: true })
  }

  const go = (next: number) => {
    moved.current = true
    setIndex(Math.min(STEPS.length - 1, Math.max(0, next)))
  }

  return (
    <Page className="bd-onb">
      <PageHeader title={t('onboarding.title')} subtitle={t('onboarding.subtitle')} />

      <LcdPanel className="bd-onb-panel" data-testid="onboarding-step" data-step={step} data-index={index + 1}>
        <h2 ref={heading} tabIndex={-1} className="bd-onb-heading bd-lcdpanel__title">
          {t(TITLES[step])}
        </h2>
        {step === 'idea' ? <IdeaStep /> : null}
        {step === 'device' ? <DeviceStep downloadBytes={status?.totalBytes ?? 0} /> : null}
        {step === 'permissions' ? <PermissionsStep /> : null}
        {step === 'install' ? <InstallStep /> : null}
      </LcdPanel>

      <div className="bd-onb-nav">
        <div className="bd-onb-progress">
          <ol className="bd-onb-dots" aria-label={t('onboarding.stepsLabel')}>
            {STEPS.map((id, position) => (
              <li key={id} className="bd-onb-dot" aria-current={position === index ? 'step' : undefined} aria-label={t('onboarding.stepLabel', { step: position + 1, total: STEPS.length })} />
            ))}
          </ol>
          {!last ? (
            <button type="button" className="bd-onb-skip" onClick={finish} data-testid="onboarding-skip">
              {t('onboarding.skip')}
            </button>
          ) : null}
        </div>
        <div className="bd-onb-actions">
          {index > 0 ? (
            <Button variant="secondary" size="lg" onClick={() => go(index - 1)} data-testid="onboarding-back">
              {t('onboarding.back')}
            </Button>
          ) : null}
          {last ? (
            <Button size="lg" onClick={finish} data-testid="onboarding-finish">
              {t('onboarding.install.finish')}
            </Button>
          ) : (
            <Button size="lg" onClick={() => go(index + 1)} data-testid="onboarding-next">
              {t('onboarding.next')}
            </Button>
          )}
        </div>
      </div>
    </Page>
  )
}
