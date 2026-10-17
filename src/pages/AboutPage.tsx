// About: credits and licences in Czech, the non-commercial note, the no-tracking statement and an optional dedication.
import type { ReactNode } from 'react'
import { ROUTES } from '../app/routes'
import { DEDICATION } from '../features/settings/dedication'
import '../features/settings/settings.css'
import { t } from '../i18n'
import { LcdPanel, Page, PageHeader } from '../ui'

interface CreditProps {
  title: string
  name: string
  by?: string
  children: ReactNode
  testId: string
}

function Credit({ title, name, by, children, testId }: CreditProps) {
  return (
    <LcdPanel title={title} data-testid={testId}>
      <div className="bd-about-credit">
        <p className="bd-about-credit__name">{name}</p>
        {by ? <p className="bd-about-credit__by">{by}</p> : null}
        {children}
      </div>
    </LcdPanel>
  )
}

export default function AboutPage() {
  const dedication = DEDICATION.trim()
  return (
    <Page className="bd-set">
      <PageHeader title={t('about.title')} subtitle={t('about.version', { version: __APP_VERSION__ })} backTo={ROUTES.settings} />
      <p>{t('about.intro')}</p>

      {dedication ? (
        <LcdPanel title={t('about.dedication.title')} tone="dark" data-testid="dedication">
          <p className="bd-about-dedication">{dedication}</p>
        </LcdPanel>
      ) : null}

      <LcdPanel title={t('about.gift.title')} data-testid="about-gift">
        <p>{t('about.gift.text')}</p>
      </LcdPanel>

      <LcdPanel title={t('about.privacy.title')} data-testid="about-privacy">
        <p>{t('about.privacy.text')}</p>
      </LcdPanel>

      <Credit title={t('about.sound.title')} name={t('about.sound.name')} by={t('about.sound.by')} testId="credit-birdnet">
        <p>{t('about.sound.text')}</p>
      </Credit>

      <Credit title={t('about.photo.title')} name={t('about.photo.name')} by={t('about.photo.by')} testId="credit-wingclip">
        <p>{t('about.photo.text')}</p>
        <p>{t('about.photo.teacher')}</p>
      </Credit>

      <Credit title={t('about.taxonomy.title')} name={t('about.taxonomy.name')} by={t('about.taxonomy.by')} testId="credit-taxonomy">
        <p>{t('about.taxonomy.text')}</p>
      </Credit>

      <Credit title={t('about.images.title')} name={t('about.images.name')} testId="credit-wikimedia">
        <p>{t('about.images.text')}</p>
      </Credit>

      <Credit title={t('about.places.title')} name={t('about.places.name')} testId="credit-osm">
        <p>{t('about.places.text')}</p>
      </Credit>

      <LcdPanel title={t('about.libraries.title')} data-testid="credit-libraries">
        <div className="bd-about-credit">
          <p>{t('about.libraries.text')}</p>
          <ul className="bd-about-list">
            <li>{t('about.libraries.react')}</li>
            <li>{t('about.libraries.vite')}</li>
            <li>{t('about.libraries.router')}</li>
            <li>{t('about.libraries.dexie')}</li>
            <li>{t('about.libraries.litert')}</li>
            <li>{t('about.libraries.onnx')}</li>
            <li>{t('about.libraries.fflate')}</li>
            <li>{t('about.libraries.workbox')}</li>
            <li>{t('about.libraries.fonts')}</li>
          </ul>
        </div>
      </LcdPanel>
    </Page>
  )
}
